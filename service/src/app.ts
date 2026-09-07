// The Registry Service HTTP API (docs/api-contract.md), as a Hono app over D1. Reads derive the
// queue and radar with core; writes go through judgments.ts (validation + covenant) and writes.ts
// (persistence); the archive endpoints hand back the file the Drive writer would emit.

import type { Change, Task } from '@ftb/core';
import { buildQueue, buildRadar, chunkQueue, countRows, cycleMonday, nextFreeId, reservedIds, sofiaToday } from '@ftb/core';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { buildPendingDelta, flush, NothingPending, StampCollision } from './archive.ts';
import { getMeta, META_KEYS, readAllTasks, readTask, type Env } from './db.ts';
import { BadRequest, checkCovenant, CovenantError, judgmentToChange, parseSendResults, type Judgment, type JudgmentBatch, type Rejection } from './judgments.ts';
import { recordChanges, systemClock, type Clock } from './writes.ts';

export interface AppOptions {
  clock?: Clock;
}

type Vars = { clock: Clock; machineActor: string | null };
type App = Hono<{ Bindings: Env; Variables: Vars }>;
type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Machine auth. Browsers reach the API through Cloudflare Access (ADR-1) and carry no bearer; a
 * relay (the Google Tasks Apps Script, a cron) cannot log in, so it presents
 * `Authorization: Bearer <MACHINE_TOKEN>` instead — Access must let that path through (a bypass
 * or Service-Auth policy on the API routes it uses) and this check is what guards it. Rules:
 * a bearer is checked only when present; a wrong one, or any bearer while MACHINE_TOKEN is unset,
 * is 401; a right one makes the request a machine request whose actor defaults to MACHINE_ACTOR
 * ("gt-relay") and which may only reach the routes below — never a judgment, close, reopen or
 * archive route, so a machine token cannot triage or flush by construction. A machine request
 * that names an actor keeps it; the token only supplies the default.
 */
const MACHINE_ROUTES: { method: string; path: RegExp }[] = [
  { method: 'GET', path: /^\/api\/v1\/(health|registry|registry\/open|queue|radar|dated)$/ },
  { method: 'POST', path: /^\/api\/v1\/capture$/ },
  { method: 'POST', path: /^\/api\/v1\/tasks\/[^/]+\/note$/ },
];
const DEFAULT_MACHINE_ACTOR = 'gt-relay';

/** Constant-time string equality (no early exit on the first differing byte). */
function tokenEquals(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let k = 0; k < Math.max(x.length, y.length); k++) diff |= (x[k] ?? 0) ^ (y[k] ?? 0);
  return diff === 0;
}

class Unauthorized extends Error {}
class Forbidden extends Error {}

/** Origins allowed without configuration: the client's dev server and preview on this machine. */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * The client (Pages, `app.<domain>`; `vite` on :5173 / `vite preview` on :4173 locally) is a
 * different origin from the Worker, so every browser call is cross-origin and the POSTs carry
 * custom headers (X-Actor, X-Human-Judgment) that force a preflight. Allowed origins come from
 * `CORS_ORIGINS` (comma-separated) in the Worker's vars; when it is unset only localhost origins
 * are allowed. Origins are never reflected blindly: with Cloudflare Access in front the browser
 * sends the Access cookie, and an open allowlist with credentials would let any site act as him.
 */
function allowedOrigin(origin: string, configured: string | undefined): string | null {
  const list = (configured ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length ? list.includes(origin) : LOCAL_ORIGIN.test(origin)) return origin;
  return null;
}

function todayFor(c: Ctx, explicit?: string | null): string {
  if (explicit && ISO.test(explicit)) return explicit;
  const q = c.req.query('today');
  if (q && ISO.test(q)) return q;
  return sofiaToday(c.get('clock').now());
}

async function envelope(c: Ctx, rows: Task[], all: Task[]) {
  const stamp = (await getMeta(c.env.DB, META_KEYS.currentStamp)) ?? '';
  return {
    stamp,
    today: todayFor(c),
    rows,
    counts: countRows(all),
    next_free_id: nextFreeId(all),
    reserved: reservedIds(all),
  };
}

function actorSource(body: { actor?: unknown; source?: unknown }, c: Ctx): { actor: string; source: string } {
  const actor = typeof body.actor === 'string' && body.actor ? body.actor : (c.req.header('X-Actor') ?? c.get('machineActor'));
  const source = typeof body.source === 'string' && body.source ? body.source : (c.req.header('X-Source') ?? 'app');
  if (!actor) throw new BadRequest('actor is required (body.actor or X-Actor)');
  return { actor, source };
}

interface CaptureItem {
  task?: string;
  category?: string;
  notes?: string;
}
interface CaptureBody {
  items?: CaptureItem[];
  /** The Google Tasks relay's shape: per-row actor/source. Normalised to `items` below. */
  rows?: (CaptureItem & { actor?: string; source?: string })[];
  actor?: string;
  source?: string;
}

/**
 * `{ rows: [{task, notes, source, actor}] }` (the relay's payload) → the contract's
 * `{ items, actor, source }`. The first row's actor/source stand in for missing top-level ones;
 * per-row category/notes pass through. Returns the field the body arrived in, for the envelope.
 */
function normaliseCapture(body: CaptureBody): { body: CaptureBody; normalizedFrom: 'rows' | null } {
  if (Array.isArray(body.items)) return { body, normalizedFrom: null };
  if (!Array.isArray(body.rows)) return { body, normalizedFrom: null };
  const first = body.rows[0] ?? {};
  const out: CaptureBody = {
    items: body.rows.map((r) => ({ task: r?.task, category: r?.category, notes: r?.notes })),
    actor: body.actor ?? first.actor,
    source: body.source ?? first.source,
  };
  return { body: out, normalizedFrom: 'rows' };
}

/** 409 when the caller's If-Match stamp is older than the current one. */
async function checkIfMatch(c: Ctx): Promise<void> {
  const given = c.req.header('If-Match');
  if (!given) return;
  const current = (await getMeta(c.env.DB, META_KEYS.currentStamp)) ?? '';
  if (given.replace(/"/g, '') < current) throw new Stale(`If-Match ${given} is older than the current stamp ${current}`);
}

class Stale extends Error {}

async function readJson<T>(c: Ctx): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new BadRequest('Body must be JSON');
  }
}

async function applyBatch(c: Ctx, batch: JudgmentBatch, captures: { id: string | null; task: string }[] = []) {
  const { actor, source } = actorSource(batch, c);
  if (!Array.isArray(batch.judgments)) throw new BadRequest('judgments must be an array');
  checkCovenant(batch);
  await checkIfMatch(c);
  const today = todayFor(c, batch.today);

  const changes: Change[] = [];
  const rejected: Rejection[] = [];
  for (const j of batch.judgments) {
    if (!j || typeof j.id !== 'string') throw new BadRequest('every judgment needs an id');
    const row = await readTask(c.env.DB, j.id);
    const res = judgmentToChange(j, row, today);
    if ('rejected' in res) rejected.push(res.rejected);
    else changes.push(res.change);
  }
  const captured: Change[] = [];
  if (captures.length) {
    const all = await readAllTasks(c.env.DB);
    const taken = new Set(all.map((r) => r.id));
    let next = Number(nextFreeId(all).slice(2));
    for (const cap of captures) {
      let id = cap.id && !taken.has(cap.id) ? cap.id : null;
      if (!id) {
        while (taken.has(`T-${String(next).padStart(3, '0')}`)) next++;
        id = `T-${String(next).padStart(3, '0')}`;
      }
      taken.add(id);
      next = Math.max(next, Number(id.slice(2).split('.')[0]) + 1);
      captured.push(captureChange(id, cap.task, undefined, undefined, today));
    }
  }
  const all = [...changes, ...captured];
  let stamp = (await getMeta(c.env.DB, META_KEYS.currentStamp)) ?? '';
  if (all.length) {
    stamp = (await recordChanges(c.env.DB, all, { actor, source, human_judgment: batch.human_judgment === true }, c.get('clock'))).stamp;
  }
  return { applied: all.length, rejected, delta_stamp: stamp, captured: captured.map((ch) => ch.id) };
}

function captureChange(id: string, task: string, category: string | undefined, notes: string | undefined, today: string): Change {
  const ch: Change = {
    id,
    name: task,
    isNew: true,
    sets: { Task: task, Category: category?.trim() || 'Personal / Admin', Status: 'Inbox', Recorded: today },
    noteAppends: [],
  };
  if (!category?.trim()) ch.noteAppends.push('Category not given at capture — Personal / Admin by default; one word moves it.');
  if (notes?.trim()) ch.noteAppends.push(notes.trim());
  return ch;
}

export function createApp(opts: AppOptions = {}): App {
  const app: App = new Hono();
  const clock = opts.clock ?? systemClock;

  app.use('*', async (c, next) => {
    c.set('clock', clock);
    c.set('machineActor', null);
    await next();
  });

  app.use(
    '/api/*',
    cors({
      origin: (origin, c) => allowedOrigin(origin, (c.env as Env).CORS_ORIGINS),
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Accept', 'Authorization', 'If-Match', 'X-Actor', 'X-Source', 'X-Human-Judgment'],
      credentials: true,
      maxAge: 600,
    })
  );

  // Machine bearer (see MACHINE_ROUTES). Runs after CORS so a preflight never needs a token.
  app.use('/api/*', async (c, next) => {
    const header = c.req.header('Authorization');
    if (c.req.method === 'OPTIONS' || !header) return next();
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    const configured = c.env.MACHINE_TOKEN;
    if (!m) throw new Unauthorized('Authorization must be "Bearer <token>"');
    if (!configured) throw new Unauthorized('machine auth is not configured on this service (MACHINE_TOKEN unset)');
    if (!tokenEquals(m[1]!.trim(), configured)) throw new Unauthorized('bad machine token');
    const actor = c.env.MACHINE_ACTOR?.trim() || DEFAULT_MACHINE_ACTOR;
    const path = new URL(c.req.url).pathname;
    if (!MACHINE_ROUTES.some((r) => r.method === c.req.method && r.path.test(path))) {
      throw new Forbidden(`the machine token (${actor}) may not ${c.req.method} ${path}: captures, notes and reads only — triage is a human act`);
    }
    c.set('machineActor', actor);
    return next();
  });

  app.onError((err, c) => {
    if (err instanceof Unauthorized) return c.json({ error: 'unauthorized', detail: err.message }, 401);
    if (err instanceof Forbidden) return c.json({ error: 'forbidden', detail: err.message }, 403);
    if (err instanceof CovenantError) return c.json({ error: 'covenant', detail: err.message }, 403);
    if (err instanceof BadRequest) return c.json({ error: 'bad_request', detail: err.message }, 400);
    if (err instanceof Stale) return c.json({ error: 'stale', detail: err.message }, 409);
    if (err instanceof StampCollision) return c.json({ error: 'stamp_collision', detail: err.message }, 409);
    if (err instanceof NothingPending) return c.json({ error: 'nothing_pending', detail: err.message }, 400);
    console.error(err);
    return c.json({ error: 'internal', detail: err.message }, 500);
  });

  const api = new Hono<{ Bindings: Env; Variables: Vars }>();

  api.get('/health', async (c) => {
    const all = await readAllTasks(c.env.DB);
    return c.json({ ok: true, stamp: (await getMeta(c.env.DB, META_KEYS.currentStamp)) ?? '', rows: all.length });
  });

  api.get('/registry', async (c) => {
    const all = await readAllTasks(c.env.DB);
    return c.json(await envelope(c, all, all));
  });

  api.get('/registry/open', async (c) => {
    const all = await readAllTasks(c.env.DB);
    return c.json(await envelope(c, all.filter((r) => r.status !== 'Done' && r.status !== 'Dropped'), all));
  });

  api.get('/queue', async (c) => {
    const chunk = Math.max(1, Number(c.req.query('chunk') ?? '5') || 5);
    const page = Math.max(0, Number(c.req.query('page') ?? '0') || 0);
    const today = todayFor(c);
    const all = await readAllTasks(c.env.DB);
    const entries = buildQueue(all, today);
    return c.json({
      monday: cycleMonday(today),
      today,
      entries: chunkQueue(entries, chunk, page).map((e) => ({ top: e.top, rows: e.rows, tier: e.tier, key: e.key })),
      total: entries.length,
      page,
      chunk,
    });
  });

  api.get('/radar', async (c) => {
    const days = Math.max(1, Number(c.req.query('days') ?? '14') || 14);
    const all = await readAllTasks(c.env.DB);
    return c.json(buildRadar(all, todayFor(c), days));
  });

  /**
   * Every open row carrying a date, as the flat list the Google Tasks relay mirrors into its
   * "PTO deadlines" list: the radar's dated sections flattened and re-sorted by date then ID.
   * `deadline_type` is never null here — an untyped date has DL semantics (core's dstate), so it
   * is reported as DL. Same rows as /radar minus `undated`; nothing else is derived.
   */
  api.get('/dated', async (c) => {
    const all = await readAllTasks(c.env.DB);
    const today = todayFor(c);
    const radar = buildRadar(all, today, 14);
    const dated = [...radar.overdue, ...radar.today_tomorrow, ...radar.fortnight, ...radar.passed_not_overdue, ...radar.further, ...radar.dormant];
    dated.sort((a, b) => (a.deadline! < b.deadline! ? -1 : a.deadline! > b.deadline! ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return c.json(dated.map((t) => ({ id: t.id, task: t.task, deadline: t.deadline, deadline_type: t.deadline_type ?? 'DL', status: t.status })));
  });

  api.post('/judgments', async (c) => {
    const batch = await readJson<JudgmentBatch>(c);
    return c.json(await applyBatch(c, batch));
  });

  api.post('/judgments/text', async (c) => {
    const text = await c.req.text();
    const parsed = parseSendResults(text);
    const batch: JudgmentBatch = {
      actor: c.req.header('X-Actor') ?? '',
      source: c.req.header('X-Source') ?? 'app',
      human_judgment: /^true$/i.test(c.req.header('X-Human-Judgment') ?? ''),
      today: parsed.today ?? undefined,
      judgments: parsed.judgments,
    };
    return c.json(await applyBatch(c, batch, parsed.captures));
  });

  api.post('/capture', async (c) => {
    const { body, normalizedFrom } = normaliseCapture(await readJson<CaptureBody>(c));
    const { actor, source } = actorSource(body, c);
    if (!Array.isArray(body.items) || body.items.length === 0) throw new BadRequest('items must be a non-empty array');
    await checkIfMatch(c);
    const today = todayFor(c);
    const all = await readAllTasks(c.env.DB);
    let next = Number(nextFreeId(all).slice(2));
    const changes: Change[] = [];
    for (const item of body.items) {
      if (!item || typeof item.task !== 'string' || !item.task.trim()) throw new BadRequest('every item needs a task');
      const id = `T-${String(next++).padStart(3, '0')}`;
      changes.push(captureChange(id, item.task.trim(), item.category, item.notes, today));
    }
    // A capture is never a judgment: Status=Inbox, Triaged=null, no scores — whoever the actor is.
    const res = await recordChanges(c.env.DB, changes, { actor, source, human_judgment: false }, clock);
    const out: Record<string, unknown> = { rows: res.rows, delta_stamp: res.stamp };
    if (normalizedFrom) out.normalized_from = normalizedFrom; // deprecated shape accepted; send `items` + top-level actor/source
    return c.json(out);
  });

  api.post('/tasks/:id/close', async (c) => {
    const id = c.req.param('id');
    const body = await readJson<{ actor?: string; source?: string; human_judgment?: boolean; done?: string; note?: string }>(c);
    const { actor, source } = actorSource(body, c);
    const row = await readTask(c.env.DB, id);
    if (!row) return c.json({ error: 'not_found', detail: `unknown id ${id}` }, 404);
    const j: Judgment = { id, status: 'Done' };
    if (body.note) j.note = body.note;
    checkCovenant({ human_judgment: body.human_judgment, judgments: [j] });
    await checkIfMatch(c);
    const today = todayFor(c);
    const res = judgmentToChange(j, row, today);
    if ('rejected' in res) throw new BadRequest(res.rejected.reason);
    if (body.done) {
      if (!ISO.test(body.done)) throw new BadRequest('done must be YYYY-MM-DD');
      res.change.sets.Done = body.done;
    }
    const w = await recordChanges(c.env.DB, [res.change], { actor, source, human_judgment: true, note: body.note ?? null }, clock);
    return c.json(w.rows[0]);
  });

  api.post('/tasks/:id/reopen', async (c) => {
    const id = c.req.param('id');
    const body = await readJson<{ actor?: string; source?: string; human_judgment?: boolean; status?: string; note?: string }>(c);
    const { actor, source } = actorSource(body, c);
    const row = await readTask(c.env.DB, id);
    if (!row) return c.json({ error: 'not_found', detail: `unknown id ${id}` }, 404);
    if (!body.status) throw new BadRequest('status is required');
    const j: Judgment = { id, reopen: body.status };
    if (body.note) j.note = body.note;
    checkCovenant({ human_judgment: body.human_judgment, judgments: [j] });
    await checkIfMatch(c);
    const res = judgmentToChange(j, row, todayFor(c));
    if ('rejected' in res) throw new BadRequest(res.rejected.reason);
    const w = await recordChanges(c.env.DB, [res.change], { actor, source, human_judgment: true, note: body.note ?? null }, clock);
    return c.json(w.rows[0]);
  });

  api.post('/tasks/:id/note', async (c) => {
    const id = c.req.param('id');
    const body = await readJson<{ actor?: string; source?: string; text?: string }>(c);
    const { actor, source } = actorSource(body, c);
    const row = await readTask(c.env.DB, id);
    if (!row) return c.json({ error: 'not_found', detail: `unknown id ${id}` }, 404);
    if (typeof body.text !== 'string' || !body.text.trim()) throw new BadRequest('text is required');
    await checkIfMatch(c);
    const change: Change = { id, name: row.task, isNew: false, sets: {}, noteAppends: [body.text.trim()] };
    const w = await recordChanges(c.env.DB, [change], { actor, source, human_judgment: false, note: body.text.trim() }, clock);
    return c.json(w.rows[0]);
  });

  api.get('/archive/pending', async (c) => {
    const view = await buildPendingDelta(c.env.DB, clock);
    return c.json(view);
  });

  api.post('/archive/flush', async (c) => {
    let compact = false;
    if ((c.req.header('Content-Type') ?? '').includes('application/json')) {
      const body = await readJson<{ compact?: boolean }>(c);
      compact = body.compact === true;
    }
    const file = await flush(c.env.DB, { compact }, clock);
    return c.json(file);
  });

  app.route('/api/v1', api);
  app.get('/', (c) => c.json({ service: 'Free the Brain registry', api: '/api/v1' }));
  return app;
}

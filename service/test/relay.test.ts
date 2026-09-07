// The service side of the Google Tasks relay's "service" lane (integrations/google-tasks): the
// optional machine bearer, GET /dated, and the relay's `{ rows }` capture shape. Same harness as
// service.test.ts — the Hono app against a real local D1 seeded from data/registry.
import { env } from 'cloudflare:test';
import type { Task } from '@ftb/core';
import { isOpen } from '@ftb/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { runImport } from '../src/import.ts';
import type { Clock } from '../src/writes.ts';

const files = env.REGISTRY_FILES ?? [];
const hasRegistry = files.length > 0;

const clock: Clock = { now: () => new Date('2026-09-07T18:30:00Z') }; // Monday 2026-09-07 21:30 Europe/Sofia
const app = createApp({ clock });
const TODAY = '2026-09-07';
const TOKEN = 'relay-secret-token';
/** The deployed shape: MACHINE_TOKEN is a Worker secret, MACHINE_ACTOR is optional. */
const MACHINE_ENV = { ...env, MACHINE_TOKEN: TOKEN };

async function api(path: string, init: RequestInit = {}, bindings: object = env) {
  const res = await app.request(`/api/v1${path}`, init, bindings);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { status: res.status, body: body as any };
}

function json(method: string, path: string, body: unknown, headers: Record<string, string> = {}, bindings: object = env) {
  return api(path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }, bindings);
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function judgmentsFor(taskId: string) {
  const res = await env.DB.prepare('SELECT actor, source, human_judgment FROM judgments WHERE task_id = ? ORDER BY id').bind(taskId).all<{ actor: string; source: string; human_judgment: number }>();
  return res.results;
}

describe.skipIf(!hasRegistry)('relay-readiness: machine bearer, /dated, rows-shaped capture', () => {
  beforeAll(async () => {
    await runImport(env.DB, files, clock.now());
  });

  // ---- (a) machine bearer ---------------------------------------------------------------------

  it('without a bearer nothing changes: browser traffic (through Access) needs no token', async () => {
    expect((await api('/health')).status).toBe(200);
    expect((await api('/health', {}, MACHINE_ENV)).status).toBe(200);
    // and the existing actor rule still applies: a capture with no actor anywhere is a 400, not a machine request
    const res = await json('POST', '/capture', { source: 'mcp', items: [{ task: 'no actor' }] }, {}, MACHINE_ENV);
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/actor is required/);
  });

  it('any bearer while MACHINE_TOKEN is unset is 401; a wrong or malformed bearer is 401', async () => {
    const unset = await api('/health', { headers: bearer(TOKEN) }); // env without MACHINE_TOKEN
    expect(unset.status).toBe(401);
    expect(unset.body).toMatchObject({ error: 'unauthorized', detail: expect.stringMatching(/MACHINE_TOKEN unset/) });

    const wrong = await api('/health', { headers: bearer('nope') }, MACHINE_ENV);
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe('unauthorized');

    const malformed = await api('/health', { headers: { Authorization: 'Basic abc' } }, MACHINE_ENV);
    expect(malformed.status).toBe(401);

    // a wrong bearer on a write must not write
    const before = (await api('/registry', {}, MACHINE_ENV)).body.counts.total;
    const write = await json('POST', '/capture', { items: [{ task: 'must not land' }] }, bearer('nope'), MACHINE_ENV);
    expect(write.status).toBe(401);
    expect((await api('/registry', {}, MACHINE_ENV)).body.counts.total).toBe(before);
  });

  it('the CORS preflight never needs the token', async () => {
    const pre = await app.request(
      '/api/v1/capture',
      { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } },
      MACHINE_ENV,
    );
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Headers')).toMatch(/Authorization/);
  });

  it('a right bearer is accepted, and the actor defaults to the configured machine name', async () => {
    // default name
    const res = await json('POST', '/capture', { source: 'gtasks', items: [{ task: 'Bearer capture, default actor' }] }, bearer(TOKEN), MACHINE_ENV);
    expect(res.status).toBe(200);
    const id = res.body.rows[0].id as string;
    expect(id).toBe('T-103');
    expect(await judgmentsFor(id)).toEqual([{ actor: 'gt-relay', source: 'gtasks', human_judgment: 0 }]);

    // configured name
    const named = await json('POST', '/capture', { source: 'cron', items: [{ task: 'Bearer capture, named actor' }] }, bearer(TOKEN), { ...MACHINE_ENV, MACHINE_ACTOR: 'nightly-cron' });
    expect(named.status).toBe(200);
    expect(await judgmentsFor(named.body.rows[0].id)).toEqual([{ actor: 'nightly-cron', source: 'cron', human_judgment: 0 }]);

    // a body actor is a default override, not forbidden
    const explicit = await json('POST', '/capture', { actor: 'gemini', source: 'gtasks', items: [{ task: 'Bearer capture, explicit actor' }] }, bearer(TOKEN), MACHINE_ENV);
    expect(await judgmentsFor(explicit.body.rows[0].id)).toEqual([{ actor: 'gemini', source: 'gtasks', human_judgment: 0 }]);

    // reads work too
    expect((await api('/dated', { headers: bearer(TOKEN) }, MACHINE_ENV)).status).toBe(200);
    expect((await api('/radar', { headers: bearer(TOKEN) }, MACHINE_ENV)).status).toBe(200);
  });

  it('the machine token cannot reach a judgment, close, reopen or archive route (403), even with human_judgment: true', async () => {
    const attempts: [string, string, unknown][] = [
      ['POST', '/judgments', { human_judgment: true, today: TODAY, judgments: [{ id: 'T-029', u: 'H' }] }],
      ['POST', '/judgments/text', 'TRIAGE — x\nT-029 (x): U=H'],
      ['POST', '/tasks/T-029/close', { human_judgment: true }],
      ['POST', '/tasks/T-029/reopen', { human_judgment: true, status: 'Planned' }],
      ['POST', '/archive/flush', {}],
      ['GET', '/archive/pending', undefined],
    ];
    const before = (await api('/registry', {}, MACHINE_ENV)).body.rows.find((r: Task) => r.id === 'T-029') as Task;
    for (const [method, path, body] of attempts) {
      const res =
        body === undefined
          ? await api(path, { method, headers: bearer(TOKEN) }, MACHINE_ENV)
          : typeof body === 'string'
            ? await api(path, { method, headers: { ...bearer(TOKEN), 'Content-Type': 'text/plain', 'X-Human-Judgment': 'true' }, body }, MACHINE_ENV)
            : await json(method, path, body, bearer(TOKEN), MACHINE_ENV);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error, `${method} ${path}`).toBe('forbidden');
      expect(res.body.detail).toMatch(/triage is a human act/);
    }
    const after = (await api('/registry', {}, MACHINE_ENV)).body.rows.find((r: Task) => r.id === 'T-029') as Task;
    expect(after).toEqual(before);

    // a note is allowed — it is not a judgment
    const note = await json('POST', '/tasks/T-029/note', { text: 'seen by the relay' }, bearer(TOKEN), MACHINE_ENV);
    expect(note.status).toBe(200);
    expect(note.body.notes.endsWith('\nseen by the relay')).toBe(true);
    expect(note.body.triaged).toBe(before.triaged);
    expect((await judgmentsFor('T-029')).at(-1)).toEqual({ actor: 'gt-relay', source: 'app', human_judgment: 0 });
  });

  // ---- (b) GET /dated -------------------------------------------------------------------------

  it('GET /dated is the flat array the relay expects: every open dated row, five fields, date order', async () => {
    const res = await api('/dated');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const dated = res.body as { id: string; task: string; deadline: string; deadline_type: string; status: string }[];
    expect(dated.length).toBeGreaterThan(0);
    for (const r of dated) {
      expect(Object.keys(r).sort()).toEqual(['deadline', 'deadline_type', 'id', 'status', 'task']);
      expect(r.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(['DL', 'SO', 'SB']).toContain(r.deadline_type);
      expect(['Inbox', 'Planned', 'Active', 'Blocked']).toContain(r.status);
    }
    // sorted by date then id
    const keys = dated.map((r) => `${r.deadline} ${r.id}`);
    expect(keys).toEqual([...keys].sort());

    // exactly the open rows with a date — the same population as /radar minus `undated`
    const all = (await api('/registry')).body.rows as Task[];
    const expected = all.filter((r) => isOpen(r) && r.deadline).map((r) => r.id).sort();
    expect(dated.map((r) => r.id).sort()).toEqual(expected);
    const radar = (await api('/radar')).body as Record<string, Task[]>;
    const radarDated = Object.entries(radar)
      .filter(([k]) => k !== 'undated')
      .flatMap(([, rows]) => rows.map((r) => r.id))
      .sort();
    expect(radarDated).toEqual(expected);
    // and no closed row leaks in, whatever its date
    const closedDated = all.filter((r) => !isOpen(r) && r.deadline);
    expect(closedDated.length).toBeGreaterThan(0);
    for (const r of closedDated) expect(dated.find((d) => d.id === r.id)).toBeUndefined();
  });

  it('GET /dated follows the row as it is judged: a new date appears, "none" removes it, closing removes it', async () => {
    const ftb = { actor: 'ftb', source: 'app', human_judgment: true, today: TODAY };
    const target = (await api('/registry')).body.rows.find((r: Task) => isOpen(r) && !r.deadline) as Task;
    expect(target).toBeDefined();
    const set = await json('POST', '/judgments', { ...ftb, judgments: [{ id: target.id, deadline: { type: 'SO', date: '2026-12-01' } }] });
    expect(set.status).toBe(200);
    let hit = ((await api('/dated')).body as any[]).find((r) => r.id === target.id);
    expect(hit).toEqual({ id: target.id, task: target.task, deadline: '2026-12-01', deadline_type: 'SO', status: target.status });

    await json('POST', '/judgments', { ...ftb, judgments: [{ id: target.id, deadline: 'none' }] });
    hit = ((await api('/dated')).body as any[]).find((r) => r.id === target.id);
    expect(hit).toBeUndefined();

    const datedOpen = ((await api('/dated')).body as any[])[0];
    await json('POST', `/tasks/${datedOpen.id}/close`, { actor: 'ftb', source: 'app', human_judgment: true });
    expect(((await api('/dated')).body as any[]).find((r) => r.id === datedOpen.id)).toBeUndefined();
  });

  // ---- (c) `{ rows }` capture shape -----------------------------------------------------------

  it("accepts the relay's { rows: [...] } shape, normalises it to items and says so", async () => {
    const payload = {
      rows: [
        { task: 'call the yard company', source: 'gtasks', actor: 'gt-relay', notes: 'dictated via Gemini · gt:abc123 · seen 2026-09-07' },
        { task: 'buy printer paper', source: 'gtasks', actor: 'gt-relay', notes: 'dictated via Gemini · gt:def456 · seen 2026-09-07 · gt-due 2026-09-10' },
      ],
    };
    const res = await json('POST', '/capture', payload, bearer(TOKEN), MACHINE_ENV);
    expect(res.status).toBe(200);
    expect(res.body.normalized_from).toBe('rows');
    expect(res.body.rows).toHaveLength(2);
    for (const row of res.body.rows as Task[]) {
      expect(row).toMatchObject({ status: 'Inbox', recorded: TODAY, triaged: null, u: null, i: null, deadline: null, category: 'Personal / Admin' });
      expect(await judgmentsFor(row.id)).toEqual([{ actor: 'gt-relay', source: 'gtasks', human_judgment: 0 }]);
    }
    expect(res.body.rows[0].task).toBe('call the yard company');
    expect(res.body.rows[0].notes).toContain('gt:abc123');
    expect(res.body.rows[1].notes).toContain('gt-due 2026-09-10'); // provenance only — a gt-due is not a deadline until he sets one

    // the contract shape is unchanged and carries no normalisation note
    const plain = await json('POST', '/capture', { actor: 'claude', source: 'mcp', items: [{ task: 'plain items' }] });
    expect(plain.status).toBe(200);
    expect(plain.body.normalized_from).toBeUndefined();

    // rows without a bearer still need an actor: the per-row actor supplies it
    const noBearer = await json('POST', '/capture', { rows: [{ task: 'rows, no bearer', source: 'gtasks', actor: 'gt-relay' }] });
    expect(noBearer.status).toBe(200);
    expect(await judgmentsFor(noBearer.body.rows[0].id)).toEqual([{ actor: 'gt-relay', source: 'gtasks', human_judgment: 0 }]);

    // and top-level actor/source win over per-row ones
    const mixed = await json('POST', '/capture', { actor: 'ftb', source: 'voice', rows: [{ task: 'rows with top-level actor', source: 'gtasks', actor: 'gt-relay' }] });
    expect(await judgmentsFor(mixed.body.rows[0].id)).toEqual([{ actor: 'ftb', source: 'voice', human_judgment: 0 }]);

    // empty or malformed rows are 400 like empty items
    expect((await json('POST', '/capture', { rows: [] }, bearer(TOKEN), MACHINE_ENV)).status).toBe(400);
    expect((await json('POST', '/capture', { rows: [{ notes: 'no task' }] }, bearer(TOKEN), MACHINE_ENV)).status).toBe(400);
  });

  it('a gtasks capture is covenant-safe by construction: Inbox, unscored, untriaged — and stays out of the judged set', async () => {
    const res = await json('POST', '/capture', { rows: [{ task: 'relay test one', source: 'gtasks', actor: 'gt-relay' }] }, bearer(TOKEN), MACHINE_ENV);
    const row = res.body.rows[0] as Task;
    const stored = (await api('/registry')).body.rows.find((r: Task) => r.id === row.id) as Task;
    expect(stored).toMatchObject({ task: 'relay test one', status: 'Inbox', triaged: null, u: null, i: null, deadline: null, done: null });
    // it lands in the queue's "never judged" tier, so triage still happens on his terms
    const q = await api('/queue?chunk=500&page=0');
    const entry = q.body.entries.find((e: any) => e.top.id === row.id);
    expect(entry).toBeDefined();
    expect(entry.tier).toBe(3);
  });
});

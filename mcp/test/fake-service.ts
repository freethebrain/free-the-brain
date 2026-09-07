/**
 * A fake Registry Service: just enough of docs/api-contract.md, in memory, on
 * Node's http module. Records every request it receives so tests can assert
 * that a refused call never reached it.
 */
import { createServer, type Server } from 'node:http';

import { dateState, isoWeekMonday, parentOf } from '../src/dates.js';
import type { Judgment, JudgmentBatch, QueueEntry, Task } from '../src/types.js';

export const FIXTURE_TODAY = '2026-09-07'; // a Monday

export function fixtureRows(): Task[] {
  const base = { done: null, blocker: null, updated_at: '2026-09-06T10:00:00+03:00' };
  return [
    { ...base, id: 'T-041', task: 'Chase Ian for the pay figure', category: 'Freelance Videoediting', u: 'H', i: 'M', status: 'Planned', recorded: '2026-07-17', triaged: '2026-08-04', deadline: '2026-08-26', deadline_type: 'DL', deadline_kind: 'hard', notes: 'Ian said Friday. Then nothing.\nRate context: €1,000 for the week.' },
    { ...base, id: 'T-041.1', task: 'Draft the follow-up message', category: 'Freelance Videoediting', u: null, i: null, status: 'Inbox', recorded: '2026-08-20', triaged: null, deadline: null, deadline_type: null, deadline_kind: null, notes: '' },
    { ...base, id: 'T-052', task: 'Book dentist', category: 'Personal / Admin', u: 'L', i: 'M', status: 'Inbox', recorded: '2026-08-22', triaged: null, deadline: '2026-09-15', deadline_type: 'SB', deadline_kind: 'self', notes: '' },
    { ...base, id: 'T-060', task: 'Price list for the Art College', category: 'Art College', u: null, i: null, status: 'Inbox', recorded: '2026-08-01', triaged: null, deadline: null, deadline_type: null, deadline_kind: null, notes: 'Operational-independence gate.' },
    { ...base, id: 'T-061', task: 'Booking system quotes', category: 'Art College', u: 'M', i: 'H', status: 'Blocked', recorded: '2026-08-05', triaged: '2026-08-11', deadline: '2026-10-01', deadline_type: 'SO', deadline_kind: 'self', notes: 'Waiting on Sasho for the second quote.', blocker: 'Sasho' },
    { ...base, id: 'T-070', task: 'Volvo brakes', category: 'Personal / Admin', u: 'H', i: 'M', status: 'Done', recorded: '2026-08-10', triaged: '2026-08-20', deadline: null, deadline_type: null, deadline_kind: null, notes: 'Paid EUR 340 against a researched EUR 520 band.', done: '2026-08-22' },
    { ...base, id: 'T-071', task: 'Old idea, dropped', category: 'Research & Side Projects', u: null, i: null, status: 'Dropped', recorded: '2026-07-01', triaged: '2026-08-01', deadline: null, deadline_type: null, deadline_kind: null, notes: '', done: '2026-08-01' },
    { ...base, id: 'T-080', task: 'Send the exhibition proposal', category: 'Best Moments', u: 'M', i: 'M', status: 'Planned', recorded: '2026-08-25', triaged: '2026-09-07', deadline: '2026-09-09', deadline_type: 'DL', deadline_kind: 'hard', notes: 'Judged this cycle — must be out of the queue.' },
  ];
}

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

export interface FakeService {
  url: string;
  rows: Task[];
  requests: RecordedRequest[];
  writes(): RecordedRequest[];
  close(): Promise<void>;
}

const GUARDED: (keyof Judgment)[] = ['u', 'i', 'status', 'deadline', 'category', 'reopen'];
const OPEN = new Set(['Inbox', 'Planned', 'Active', 'Blocked']);

function tierOf(r: Task, today: string): [number, string] {
  const d = dateState(r, today);
  if (d?.kind === 'overdue') return [1, String(d.n).padStart(6, '0')];
  if (d && d.n <= 14 && d.kind !== 'dormant' && d.kind !== 'started') return [2, String(d.n).padStart(6, '0')];
  if (!r.u && !r.i) return [3, r.recorded];
  if (!r.triaged) return [4, r.recorded];
  return [5, r.triaged];
}

export function deriveQueue(rows: Task[], today: string): QueueEntry[] {
  const monday = isoWeekMonday(today);
  const open = rows.filter((r) => OPEN.has(r.status));
  const live = open.filter((r) => !(r.triaged && r.triaged >= monday));
  const ids = new Set(live.map((r) => r.id));
  const tops = live.filter((r) => !parentOf(r.id) || !ids.has(parentOf(r.id)!));
  const entries = tops.map((t) => {
    const branch: Task[] = [t];
    const grab = (p: Task) => live.filter((r) => parentOf(r.id) === p.id).sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((c) => { branch.push(c); grab(c); });
    grab(t);
    let best: [number, string] | null = null;
    for (const r of branch) { const k = tierOf(r, today); if (!best || k[0] < best[0] || (k[0] === best[0] && k[1] < best[1])) best = k; }
    return { top: t, rows: branch, tier: best![0] as QueueEntry['tier'], key: best };
  });
  entries.sort((a, b) => a.tier - b.tier || ((a.key as [number, string])[1] < (b.key as [number, string])[1] ? -1 : (a.key as [number, string])[1] > (b.key as [number, string])[1] ? 1 : 0) || (a.top.id < b.top.id ? -1 : 1));
  return entries;
}

function nextFreeIds(rows: Task[], n: number): string[] {
  const max = rows.reduce((m, r) => Math.max(m, Number(r.id.split('.')[0].slice(2))), 0);
  return Array.from({ length: n }, (_, i) => `T-${String(max + 1 + i).padStart(3, '0')}`);
}

export async function startFakeService(opts: { rows?: Task[]; today?: string } = {}): Promise<FakeService> {
  const rows = opts.rows ?? fixtureRows();
  const today = opts.today ?? FIXTURE_TODAY;
  const requests: RecordedRequest[] = [];
  const stamp = '2026-09-07-0900';

  const envelope = (rs: Task[]) => ({
    stamp,
    today,
    rows: rs,
    counts: {
      open: rows.filter((r) => OPEN.has(r.status)).length,
      done: rows.filter((r) => r.status === 'Done').length,
      dropped: rows.filter((r) => r.status === 'Dropped').length,
      total: rows.length,
    },
    next_free_id: nextFreeIds(rows, 1)[0],
    reserved: nextFreeIds(rows, 3),
  });

  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: unknown = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    const url = new URL(req.url ?? '/', 'http://fake');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    requests.push({ method: req.method ?? 'GET', path, body, headers: req.headers });

    const send = (status: number, value: unknown) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(value));
    };
    const m = req.method;

    if (m === 'GET' && path === '/health') return send(200, { ok: true, stamp, rows: rows.length });
    if (m === 'GET' && path === '/registry') return send(200, envelope(rows));
    if (m === 'GET' && path === '/registry/open') return send(200, envelope(rows.filter((r) => OPEN.has(r.status))));
    if (m === 'GET' && path === '/queue') {
      const chunk = Number(url.searchParams.get('chunk') ?? 5);
      const page = Number(url.searchParams.get('page') ?? 0);
      const all = deriveQueue(rows, today);
      return send(200, { monday: isoWeekMonday(today), entries: all.slice(page * chunk, page * chunk + chunk), total: all.length, page, chunk, today });
    }
    if (m === 'GET' && path === '/radar') {
      const open = rows.filter((r) => OPEN.has(r.status));
      const days = Number(url.searchParams.get('days') ?? 14);
      const st = (r: Task) => dateState(r, today);
      return send(200, {
        overdue: open.filter((r) => st(r)?.kind === 'overdue'),
        today_tomorrow: open.filter((r) => { const d = st(r); return d && d.n >= 0 && d.n <= 1 && d.kind !== 'dormant'; }),
        fortnight: open.filter((r) => { const d = st(r); return d && d.n > 1 && d.n <= days && d.kind !== 'dormant'; }),
        passed_not_overdue: open.filter((r) => { const k = st(r)?.kind; return k === 'eligible' || k === 'started'; }),
        further: open.filter((r) => { const d = st(r); return d && d.n > days && d.kind !== 'dormant'; }),
        dormant: open.filter((r) => st(r)?.kind === 'dormant'),
        undated: open.filter((r) => !r.deadline),
      });
    }
    if (m === 'POST' && path === '/judgments') {
      const b = body as JudgmentBatch;
      if (!b || !Array.isArray(b.judgments) || !b.actor) return send(400, { error: 'malformed' });
      const touches = b.judgments.some((j) => GUARDED.some((f) => j[f] !== undefined));
      if (b.human_judgment !== true && touches) return send(403, { error: 'covenant', detail: 'triage fields need human_judgment: true' });
      const t = b.today ?? today;
      const rejected: { id: string; reason: string }[] = [];
      let applied = 0;
      for (const j of b.judgments) {
        const r = rows.find((x) => x.id === j.id);
        if (!r) { rejected.push({ id: j.id, reason: 'unknown id' }); continue; }
        if (j.u) r.u = j.u;
        if (j.i) r.i = j.i;
        if (j.category) r.category = j.category;
        if (j.status) { r.status = j.status; if (j.status === 'Done') r.done = t; }
        if (j.reopen) { r.status = j.reopen; r.done = null; }
        if (j.deadline === 'none') { r.deadline = null; r.deadline_type = null; }
        else if (j.deadline) { r.deadline = j.deadline.date; r.deadline_type = j.deadline.type; }
        if (j.note) r.notes = r.notes ? `${r.notes}\n${j.note}` : j.note;
        r.triaged = t;
        applied++;
      }
      return send(200, { applied, rejected, delta_stamp: '2026-09-07-1200' });
    }
    if (m === 'POST' && path === '/capture') {
      const b = body as { items: { task: string; category?: string; notes?: string }[]; actor: string; source: string };
      if (!b?.items?.length || !b.actor) return send(400, { error: 'malformed' });
      const ids = nextFreeIds(rows, b.items.length);
      const created: Task[] = b.items.map((it, i) => ({
        id: ids[i], task: it.task, category: it.category ?? 'Personal / Admin', u: null, i: null, status: 'Inbox', recorded: today, triaged: null,
        deadline: null, deadline_type: null, deadline_kind: null, done: null, notes: it.notes ?? '', blocker: null, updated_at: `${today}T12:00:00+03:00`,
      }));
      rows.push(...created);
      return send(200, { rows: created });
    }
    const task = path.match(/^\/tasks\/([^/]+)\/(close|reopen|note)$/);
    if (m === 'POST' && task) {
      const r = rows.find((x) => x.id === decodeURIComponent(task[1]));
      if (!r) return send(404, { error: 'unknown id' });
      const b = body as { actor?: string; human_judgment?: boolean; done?: string; status?: Task['status']; note?: string; text?: string };
      if (task[2] !== 'note' && b.human_judgment !== true) return send(403, { error: 'covenant', detail: 'status change needs human_judgment: true' });
      if (task[2] === 'close') { r.status = 'Done'; r.done = b.done ?? today; }
      if (task[2] === 'reopen') { r.status = b.status ?? 'Planned'; r.done = null; }
      const line = task[2] === 'note' ? b.text : b.note;
      if (line) r.notes = r.notes ? `${r.notes}\n${line}` : line;
      return send(200, r);
    }
    return send(404, { error: 'not found' });
  });

  const url = await new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      resolve(`http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`);
    });
  });

  return {
    url,
    rows,
    requests,
    writes: () => requests.filter((r) => r.method !== 'GET'),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

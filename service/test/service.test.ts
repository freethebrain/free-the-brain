// Integration tests: the Hono app against a real local D1 inside workerd, seeded from the real
// registry files (handed in as a binding by vitest.config.ts). Nothing here touches the network.
import { env, SELF } from 'cloudflare:test';
import type { Task } from '@ftb/core';
import { applyChanges, countRows, parseDelta, parseSnapshot, resolveRegistry, stampToTimestamp } from '@ftb/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { runImport } from '../src/import.ts';
import type { Clock } from '../src/writes.ts';

const files = env.REGISTRY_FILES ?? [];
const hasRegistry = files.length > 0;

// A clock the tests can move: starts Monday 2026-09-07 10:00 Europe/Sofia (07:00Z).
const clock: Clock & { set(iso: string): void } = {
  at: new Date('2026-09-07T07:00:00Z'),
  now() {
    return this.at;
  },
  set(iso: string) {
    this.at = new Date(iso);
  },
} as Clock & { at: Date; set(iso: string): void };

const app = createApp({ clock });
const TODAY = '2026-09-07';

async function api(path: string, init: RequestInit = {}) {
  const res = await app.request(`/api/v1${path}`, init, env);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { status: res.status, body: body as any };
}

function json(method: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return api(path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

const FTB = { actor: 'ftb', source: 'app', human_judgment: true, today: TODAY };

describe.skipIf(!hasRegistry)('registry service', () => {
  beforeAll(async () => {
    await runImport(env.DB, files, clock.now());
  });

  it('serves health through the real worker entry', async () => {
    const res = await SELF.fetch('http://service/api/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; rows: number };
    expect(body.ok).toBe(true);
    expect(body.rows).toBeGreaterThanOrEqual(0); // SELF has its own isolated storage; the shape is what matters
  });

  it('answers CORS for the client origin (preflight + actual), and not for a foreign one', async () => {
    // The client is served from another origin (Pages / vite) and its POSTs carry custom headers.
    const pre = await app.request(
      '/api/v1/judgments/text',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,x-actor,x-human-judgment',
        },
      },
      env
    );
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(pre.headers.get('Access-Control-Allow-Headers')).toMatch(/X-Human-Judgment/);
    expect(pre.headers.get('Access-Control-Allow-Methods')).toMatch(/POST/);

    const actual = await app.request('/api/v1/health', { headers: { Origin: 'http://localhost:4173' } }, env);
    expect(actual.status).toBe(200);
    expect(actual.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4173');
    expect(actual.headers.get('Access-Control-Allow-Credentials')).toBe('true');

    const foreign = await app.request('/api/v1/health', { headers: { Origin: 'https://evil.example' } }, env);
    expect(foreign.headers.get('Access-Control-Allow-Origin')).toBeNull();

    // With CORS_ORIGINS configured, only the listed origins pass — localhost no longer does.
    const configured = await app.request('/api/v1/health', { headers: { Origin: 'https://app.example.com' } }, { ...env, CORS_ORIGINS: 'https://app.example.com' });
    expect(configured.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
    const local = await app.request('/api/v1/health', { headers: { Origin: 'http://localhost:5173' } }, { ...env, CORS_ORIGINS: 'https://app.example.com' });
    expect(local.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('import → GET /registry reports the folded counts and next free ID', async () => {
    const { status, body } = await api('/registry?today=2026-09-07');
    expect(status).toBe(200);
    expect(body.counts).toEqual({ open: 82, done: 73, dropped: 2, total: 157 });
    expect(body.rows).toHaveLength(157);
    expect(body.stamp).toBe('2026-09-06-1445');
    expect(body.next_free_id).toBe('T-103');
    expect(body.reserved).toEqual(['T-103', 'T-104', 'T-105']);
    expect(body.today).toBe(TODAY);
    const open = await api('/registry/open');
    expect(open.body.rows).toHaveLength(82);
    expect(open.body.counts.total).toBe(157);
  });

  it('GET /queue and /radar have the contract shape', async () => {
    const q = await api('/queue?chunk=5&page=0');
    expect(q.status).toBe(200);
    expect(q.body.monday).toBe('2026-09-07');
    expect(q.body.entries).toHaveLength(5);
    expect(q.body.total).toBeGreaterThan(50);
    expect(q.body.entries[0]).toMatchObject({ tier: 1 });
    expect(q.body.entries[0].rows[0].id).toBe(q.body.entries[0].top.id);
    const r = await api('/radar?days=14');
    expect(Object.keys(r.body).sort()).toEqual(['dormant', 'fortnight', 'further', 'overdue', 'passed_not_overdue', 'today_tomorrow', 'undated'].sort());
    expect(r.body.overdue.length).toBeGreaterThan(0);
  });

  it('rejects an unattested score change with 403 covenant, but allows note-only', async () => {
    const bad = await json('POST', '/judgments', { actor: 'claude', source: 'mcp', today: TODAY, judgments: [{ id: 'T-029', u: 'L', note: 'x' }] });
    expect(bad.status).toBe(403);
    expect(bad.body.error).toBe('covenant');
    expect(bad.body.detail).toMatch(/T-029/);

    const before = (await api('/registry')).body.rows.find((r: Task) => r.id === 'T-029') as Task;
    const ok = await json('POST', '/judgments', { actor: 'claude', source: 'mcp', today: TODAY, judgments: [{ id: 'T-029', note: 'observed only' }] });
    expect(ok.status).toBe(200);
    expect(ok.body.applied).toBe(1);
    const after = (await api('/registry')).body.rows.find((r: Task) => r.id === 'T-029') as Task;
    expect(after.notes).toBe(`${before.notes}\nobserved only`);
    expect(after.triaged).toBe(before.triaged); // a note is not a triage
    expect(after.u).toBe(before.u);
  });

  it('applies attested judgments: scores, status, typed deadline, none, Done, reopen', async () => {
    const res = await json('POST', '/judgments', {
      ...FTB,
      judgments: [
        { id: 'T-029', u: 'L', i: 'L', status: 'Planned', deadline: { type: 'SB', date: '2026-09-15' }, note: 'keep, small' },
        { id: 'T-023', deadline: 'none' },
        { id: 'T-066', status: 'Done' },
        { id: 'T-096', reopen: 'Planned', note: 'not a duplicate after all' },
        { id: 'T-001', reopen: 'Planned' },
        { id: 'T-999', u: 'H' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(4);
    expect(res.body.rejected).toEqual([
      { id: 'T-001', reason: expect.stringMatching(/reopen is only valid on a closed row/) },
      { id: 'T-999', reason: 'unknown id' },
    ]);
    expect(res.body.delta_stamp).toBe('2026-09-07-1000');

    const rows = (await api('/registry')).body.rows as Task[];
    const by = new Map(rows.map((r) => [r.id, r]));
    expect(by.get('T-029')).toMatchObject({ u: 'L', i: 'L', status: 'Planned', deadline: '2026-09-15', deadline_type: 'SB', deadline_kind: 'self', triaged: TODAY });
    expect(by.get('T-029')!.notes.endsWith('\nkeep, small')).toBe(true);
    expect(by.get('T-023')).toMatchObject({ deadline: null, deadline_type: null, deadline_kind: null, triaged: TODAY, status: 'Planned' });
    expect(by.get('T-066')).toMatchObject({ status: 'Done', done: TODAY, triaged: TODAY });
    expect(by.get('T-096')).toMatchObject({ status: 'Planned', done: null, triaged: TODAY });
    expect(by.get('T-001')!.status).toBe('Active');
  });

  it('accepts the Master widget text format with header attestation', async () => {
    const text = [
      'TRIAGE — Master widget — 2026-09-07 (staged from 2026-09-06-1445)',
      'T-084 (Make sure to break up with my girlfriend): U=M I=H status=Planned note: his call, recorded as given',
      'T-015.1 (meet Zacksi (introductory meeting only)): deadline=no date',
      'T-088 (upload spec): REOPEN status=Planned note: re-upload needed',
      '',
      'NEW TASKS:',
      'T-103: Book the dentist',
      'T-103: Second capture on a taken reserved ID',
    ].join('\n');
    const noAttest = await api('/judgments/text', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Actor': 'ftb' }, body: text });
    expect(noAttest.status).toBe(403);

    const res = await api('/judgments/text', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'X-Actor': 'ftb', 'X-Human-Judgment': 'true' },
      body: text,
    });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(5);
    expect(res.body.rejected).toEqual([]);
    expect(res.body.captured).toEqual(['T-103', 'T-104']);

    const rows = (await api('/registry')).body.rows as Task[];
    const by = new Map(rows.map((r) => [r.id, r]));
    expect(by.get('T-084')).toMatchObject({ u: 'M', i: 'H', status: 'Planned', triaged: TODAY });
    expect(by.get('T-084')!.notes.endsWith('\nhis call, recorded as given')).toBe(true);
    expect(by.get('T-015.1')).toMatchObject({ deadline: null, triaged: TODAY });
    expect(by.get('T-088')).toMatchObject({ status: 'Planned', done: null });
    expect(by.get('T-103')).toMatchObject({ task: 'Book the dentist', status: 'Inbox', recorded: TODAY, triaged: null, u: null, i: null });
    expect(by.get('T-104')!.task).toBe('Second capture on a taken reserved ID');
  });

  it('POST /capture assigns the next free IDs in order', async () => {
    const res = await json('POST', '/capture', { actor: 'claude', source: 'mcp', items: [{ task: 'Alpha', category: 'Art College' }, { task: 'Beta', notes: 'from a brain-dump' }] });
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r: Task) => r.id)).toEqual(['T-105', 'T-106']);
    expect(res.body.rows[0]).toMatchObject({ task: 'Alpha', category: 'Art College', status: 'Inbox', recorded: TODAY, triaged: null });
    expect(res.body.rows[1]).toMatchObject({ category: 'Personal / Admin' });
    expect(res.body.rows[1].notes).toContain('from a brain-dump');
    const reg = await api('/registry');
    expect(reg.body.next_free_id).toBe('T-107');
    expect(reg.body.counts.total).toBe(161);
  });

  it('close / reopen / note on a single task; 404 for unknown ids', async () => {
    const closeNo = await json('POST', '/tasks/T-105/close', { actor: 'claude', source: 'mcp' });
    expect(closeNo.status).toBe(403);
    const close = await json('POST', '/tasks/T-105/close', { actor: 'ftb', source: 'app', human_judgment: true, note: 'done in a minute' });
    expect(close.status).toBe(200);
    expect(close.body).toMatchObject({ id: 'T-105', status: 'Done', done: TODAY, triaged: TODAY });
    expect(close.body.notes).toContain('done in a minute');

    const reopen = await json('POST', '/tasks/T-105/reopen', { actor: 'ftb', source: 'app', human_judgment: true, status: 'Active' });
    expect(reopen.status).toBe(200);
    expect(reopen.body).toMatchObject({ status: 'Active', done: null });

    const note = await json('POST', '/tasks/T-105/note', { actor: 'claude', source: 'mcp', text: 'a note' });
    expect(note.status).toBe(200);
    expect(note.body.notes.endsWith('\na note')).toBe(true);
    expect(note.body.status).toBe('Active');

    expect((await json('POST', '/tasks/T-999/note', { actor: 'claude', source: 'mcp', text: 'x' })).status).toBe(404);
    expect((await json('POST', '/tasks/T-999/close', { actor: 'ftb', source: 'app', human_judgment: true })).status).toBe(404);
  });

  it('409 on a stale If-Match', async () => {
    const stale = await json('POST', '/tasks/T-105/note', { actor: 'claude', source: 'mcp', text: 'late' }, { 'If-Match': '2026-09-06-1445' });
    expect(stale.status).toBe(409);
    const fresh = await json('POST', '/tasks/T-105/note', { actor: 'claude', source: 'mcp', text: 'on time' }, { 'If-Match': '2026-09-07-1000' });
    expect(fresh.status).toBe(200);
  });

  it('archive/pending is a parseable delta that reproduces the DB state when applied to the import', async () => {
    const pending = await api('/archive/pending');
    expect(pending.status).toBe(200);
    expect(pending.body.filename).toBe('Registry Delta — 2026-09-07-1000.md');
    expect(pending.body.compact_due).toBe(true); // nine deltas already on the 1137 base
    expect(pending.body.content).toContain('Written by: Free the Brain service');
    expect(pending.body.content).toContain('Base: Task Registry — 2026-08-31-1137.md');
    expect(pending.body.content).toContain('Prior deltas: 2026-08-31-1153, 2026-09-01-2014');

    const delta = parseDelta(pending.body.content, { filename: pending.body.filename });
    expect(delta.warnings).toEqual([]);
    expect(delta.baseStamp).toBe('2026-08-31-1137');
    expect(delta.priorDeltas).toHaveLength(9);
    expect(delta.changes.length).toBe(pending.body.changes);
    expect(delta.forNextCompaction).toMatch(/161 total/);

    const imported = resolveRegistry(files).rows;
    const replayed = applyChanges(imported, delta.changes, { updatedAt: stampToTimestamp(delta.stamp) });
    expect(replayed.warnings).toEqual([]);
    const strip = (r: Task) => {
      const { updated_at: _u, ...rest } = r;
      return rest;
    };
    const db = ((await api('/registry')).body.rows as Task[]).map(strip);
    expect(replayed.rows.map(strip)).toEqual(db);
  });

  it('flush emits the delta and advances the chain; compact emits a verified snapshot', async () => {
    const first = await json('POST', '/archive/flush', {});
    expect(first.status).toBe(200);
    expect(first.body.kind).toBe('delta');
    expect(first.body.filename).toBe('Registry Delta — 2026-09-07-1000.md');

    const empty = await json('POST', '/archive/flush', {});
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('nothing_pending');

    // Same minute again → the filename would collide.
    await json('POST', '/tasks/T-105/note', { actor: 'claude', source: 'mcp', text: 'after flush' });
    const collide = await json('POST', '/archive/flush', {});
    expect(collide.status).toBe(409);

    clock.set('2026-09-07T07:01:00Z');
    const view = await api('/archive/pending');
    expect(view.body.content).toContain('Prior deltas: 2026-08-31-1153, 2026-09-01-2014, 2026-09-01-2104, 2026-09-03-2321, 2026-09-03-2322, 2026-09-04-1425, 2026-09-06-1438, 2026-09-06-1442, 2026-09-06-1445, 2026-09-07-1000');
    expect(view.body.delta_count).toBe(10);

    const snap = await json('POST', '/archive/flush', { compact: true });
    expect(snap.status).toBe(200);
    expect(snap.body.kind).toBe('snapshot');
    expect(snap.body.filename).toBe('Task Registry — 2026-09-07-1001.md');
    const parsed = parseSnapshot(snap.body.content, { filename: snap.body.filename });
    expect(parsed.rows).toHaveLength(161);
    expect(parsed.counts).toEqual(countRows(parsed.rows));
    expect(parsed.nextFreeId).toBe('T-107');
    expect(snap.body.content).toContain('COUNT — independently verified');
    expect(snap.body.content).toContain('Written by: Free the Brain service');

    clock.set('2026-09-07T07:02:00Z');
    const after = await api('/archive/pending');
    expect(after.body.changes).toBe(0);
    expect(after.body.delta_count).toBe(0);
    expect(after.body.content).toContain('Base: Task Registry — 2026-09-07-1001.md');
    expect(after.body.content).toContain('Prior deltas: (none)');
  });
});

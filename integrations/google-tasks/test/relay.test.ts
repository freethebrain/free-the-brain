// Behavioural fit test of gt-relay-v2.gs (and the v2.1 correction of its SERVICE block) — the
// script itself, run as plain JavaScript in a vm context over stubbed Apps Script globals
// (test/gas.ts). The service lane talks to the REAL Registry Service (service/src/app.ts) on a
// worker thread (test/service-thread.ts), not to a fake. See FIT-ASSESSMENT.md for what the
// results mean.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadRelay, makeWorld, type GasWorld, type LoadedRelay } from './gas.ts';
import { ServiceBridge, type SeedRow } from './service-bridge.ts';

const V2 = new URL('../gt-relay-v2.gs', import.meta.url);
const V21 = new URL('../gt-relay-v2.1.gs', import.meta.url);

const NOW = '2026-09-07T18:30:00Z'; // Monday 2026-09-07 21:30 Europe/Sofia
const STAMP = '2026-09-07-2130';
const TODAY = '2026-09-07';
const TOKEN = 'relay-secret-token';

function freshWorld(bridge?: ServiceBridge): GasWorld {
  const w = makeWorld({ nowIso: NOW, bridge });
  w.addList('My Tasks');
  w.addList('Dictation');
  // the archive is already in the folder; the relay must never touch these
  w.addFile('Task Registry — 2026-08-31-1137.md', '# Task Registry — 2026-08-31-1137\n| ID | Task |\n');
  w.addFile('Registry Delta — 2026-09-06-1445.md', '# Registry Delta — 2026-09-06-1445\nBase: Task Registry — 2026-08-31-1137.md\n');
  w.addFile('_REGISTRY PROTOCOL — Delta Writes v1.md', 'protocol');
  return w;
}

function load(file: URL, w: GasWorld, config: Record<string, unknown> = {}): LoadedRelay {
  const r = loadRelay(file, w);
  Object.assign(r.config, config);
  return r;
}

function dictate(w: GasWorld, title: string, extra: Record<string, unknown> = {}) {
  return w.addTask('Dictation', { title, ...extra });
}

const archiveNames = (w: GasWorld) => w.files.map((f) => f.name).filter((n) => !n.startsWith('GT '));
const ARCHIVE = ['Task Registry — 2026-08-31-1137.md', 'Registry Delta — 2026-09-06-1445.md', '_REGISTRY PROTOCOL — Delta Writes v1.md'];

// ================================================================ discovery and guards

describe('discovery, guards, trigger', () => {
  it('discoverLists lists both lists with their open counts and newest titles', () => {
    const w = freshWorld();
    dictate(w, 'call the yard company');
    dictate(w, 'buy printer paper');
    dictate(w, 'finished already', { status: 'completed' });
    const r = load(V2, w);
    const out = r.fn<string>('discoverLists');
    expect(out).toContain('Google Tasks lists on this account (2)');
    expect(out).toContain('• "My Tasks" — 0 open');
    expect(out).toContain('• "Dictation" — 2 open · newest: "call the yard company"');
    expect(out).toContain('"buy printer paper"');
    expect(out).not.toContain('finished already');
    expect(out).toContain('It must NOT be "PTO deadlines"');
  });

  it('guardLists_ refuses SOURCE_LIST === OUTBOUND_LIST, before anything runs', () => {
    const w = freshWorld();
    const r = load(V2, w, { SOURCE_LIST: 'PTO deadlines' });
    expect(() => r.fn('guardLists_')).toThrow(/same list — that would loop/);
    expect(() => r.fn('testRun')).toThrow(/same list/);
    expect(() => r.fn('installTrigger')).toThrow(/same list/);
    // relay() catches lane errors, mails, and rethrows — and touched neither Tasks nor Drive
    expect(() => r.fn('relay')).toThrow(/same list/);
    expect(w.mails).toHaveLength(1);
    expect(w.calls.filter((c) => c.api !== 'Tasklists.list')).toEqual([]);
    expect(w.files.map((f) => f.name)).toEqual(ARCHIVE);
    expect(w.triggers).toEqual([]);
  });

  it('with SOURCE_LIST unset the inbound lane is skipped and no trigger can be installed', () => {
    const w = freshWorld();
    const r = load(V2, w);
    const report = r.fn<string>('relay');
    expect(report).toContain('in:  skipped — CONFIG.SOURCE_LIST is unset');
    expect(report).toContain('out: no GT Outbox file yet — nothing to mirror');
    expect(() => r.fn('installTrigger')).toThrow(/SOURCE_LIST is unset/);
    expect(r.fn<string>('status')).toContain('inbound: (UNSET — run discoverLists)');
  });

  it('installTrigger installs exactly one 15-minute relay trigger; status reports it', () => {
    const w = freshWorld();
    const r = load(V2, w, { SOURCE_LIST: 'Dictation' });
    expect(r.fn<string>('installTrigger')).toBe('Trigger installed: relay() every 15 minutes.');
    r.fn('installTrigger'); // idempotent: re-install replaces
    expect(w.triggers).toEqual([{ handler: 'relay', minutes: 15 }]);
    expect(r.fn<string>('status')).toContain('trigger installed: yes');
    r.fn('uninstallTrigger');
    expect(w.triggers).toEqual([]);
  });
});

// ================================================================ inbound — drive lane

describe('inbound lane → Drive', () => {
  it('two dictated tasks → one GT Inbox file in the documented grammar; the cursor advances after the write', () => {
    const w = freshWorld();
    const a = dictate(w, 'call the yard company');
    const b = dictate(w, 'buy printer paper', { due: '2026-09-10T00:00:00.000Z', notes: 'A4, two | packs\nfor the office' });
    const r = load(V2, w, { SOURCE_LIST: 'Dictation' });

    expect(r.fn<string>('testRun')).toContain('in:  would export 2 task(s) via drive');
    expect(w.files.map((f) => f.name)).toEqual(ARCHIVE); // a dry run writes nothing
    expect(w.props.has('exported_ids')).toBe(false);

    const report = r.fn<string>('relay');
    expect(report).toContain(`in:  exported 2 task(s) → GT Inbox — ${STAMP}.md`);
    const inbox = w.files.filter((f) => f.name.startsWith('GT Inbox — '));
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.mime).toBe('text/plain');
    const body = inbox[0]!.content;
    expect(body.split('\n').slice(0, 5)).toEqual([
      `# GT Inbox — ${STAMP}`,
      'Source: Google Tasks list "Dictation" · relay v2 · mode: cursor',
      'Written by: Apps Script relay running as ftb@example.test. Clock source: script, Europe/Sofia.',
      expect.stringMatching(/^Ingest rule: each line becomes one capture row — Status=Inbox/),
      '',
    ]);
    expect(body).toContain('## TASKS (2)');
    expect(body).toContain(`- [gt:${a.id}] | call the yard company | seen=${TODAY}`);
    // due → gt-due; newlines and pipes in notes are flattened so the line grammar survives
    expect(body).toContain(`- [gt:${b.id}] | buy printer paper | seen=${TODAY} | gt-due=2026-09-10 | notes=A4, two ¦ packs / for the office`);
    expect(body.endsWith('\n')).toBe(true);
    // one line per task, every line in grammar
    const lines = body.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l).toMatch(/^- \[gt:[^\]]+\] \| .+ \| seen=\d{4}-\d{2}-\d{2}( \| gt-due=\d{4}-\d{2}-\d{2})?( \| gt-parent=\S+)?( \| notes=.+)?$/);

    // cursor
    expect(JSON.parse(w.props.get('exported_ids')!)).toEqual([a.id, b.id]);
    expect(w.props.get('last_inbound')).toBe(STAMP);
    expect(w.props.get('last_inbox_file')).toBe(`GT Inbox — ${STAMP}.md`);
    expect(w.props.get('last_run')).toBe(STAMP);
    // the dictated tasks are untouched (cursor mode) and the archive files are untouched
    expect(w.lists.find((l) => l.title === 'Dictation')!.tasks.map((t) => t.status)).toEqual(['needsAction', 'needsAction']);
    expect(w.calls.map((c) => c.api)).not.toContain('Tasks.patch');
    expect(archiveNames(w)).toEqual(ARCHIVE);
    expect(w.fetches).toEqual([]); // the drive lane never calls the service
    expect(w.mails).toEqual([]);

    // second run: nothing new, no second file
    w.clock.set('2026-09-07T18:45:00Z');
    expect(r.fn<string>('relay')).toContain('in:  nothing new (2 open in the list)');
    expect(w.files.filter((f) => f.name.startsWith('GT Inbox — '))).toHaveLength(1);
  });

  it('when the Drive write fails the cursor does not move, the error is mailed, and the next run retries', () => {
    const w = freshWorld();
    dictate(w, 'call the yard company');
    const r = load(V2, w, { SOURCE_LIST: 'Dictation' });
    w.failNextCreateFile = new Error('Drive quota exceeded');
    expect(() => r.fn('relay')).toThrow(/Drive quota exceeded/);
    expect(w.props.has('exported_ids')).toBe(false);
    expect(w.props.has('last_inbound')).toBe(false);
    expect(w.files.filter((f) => f.name.startsWith('GT Inbox — '))).toHaveLength(0);
    expect(w.mails).toHaveLength(1);
    expect(w.mails[0]).toMatchObject({ to: 'ftb@example.test', subject: 'GT relay error' });
    expect(w.mails[0]!.body).toContain('INBOUND: ');
    // the run itself is still recorded
    expect(w.props.get('last_run')).toBe(STAMP);

    w.clock.set('2026-09-07T18:45:00Z');
    expect(r.fn<string>('relay')).toContain('in:  exported 1 task(s) → GT Inbox — 2026-09-07-2145.md');
    expect(JSON.parse(w.props.get('exported_ids')!)).toHaveLength(1);
  });

  it('a task whose notes contain "pto:" is skipped (loop guard), completed tasks are not read, other lists are not read', () => {
    const w = freshWorld();
    dictate(w, 'real dictation');
    dictate(w, 'echo of a mirrored row', { notes: 'PTO:T-086 · mirrored' });
    dictate(w, 'already done', { status: 'completed' });
    w.addList('PTO deadlines');
    w.addTask('PTO deadlines', { title: 'dictated into the wrong list', notes: 'pto:loop-test' });
    w.addTask('PTO deadlines', { title: 'dictated into the wrong list without a marker' });
    w.addTask('My Tasks', { title: 'someone else’s list' });
    const r = load(V2, w, { SOURCE_LIST: 'Dictation' });
    const report = r.fn<string>('relay');
    expect(report).toContain('in:  exported 1 task(s)');
    const body = w.files.find((f) => f.name.startsWith('GT Inbox — '))!.content;
    expect(body).toContain('real dictation');
    expect(body).not.toContain('echo of a mirrored row');
    expect(body).not.toContain('already done');
    expect(body).not.toContain('wrong list');
    expect(body).not.toContain('someone else');
    expect(JSON.parse(w.props.get('exported_ids')!)).toHaveLength(1);
    w.clock.set('2026-09-07T18:45:00Z');
    // the pto: task is not remembered either — it is re-filtered every run, silently, forever
    expect(r.fn<string>('relay')).toContain('in:  nothing new (1 open in the list)');
  });

  it('pages through the list when it exceeds MAX_TASKS, and suffixes a same-minute second file', () => {
    const w = freshWorld();
    dictate(w, 'one');
    dictate(w, 'two');
    dictate(w, 'three');
    const r = load(V2, w, { SOURCE_LIST: 'Dictation', MAX_TASKS: 1 });
    expect(r.fn<string>('relay')).toContain('in:  exported 3 task(s)');
    expect(w.calls.filter((c) => c.api === 'Tasks.list')).toHaveLength(3);
    dictate(w, 'four');
    expect(r.fn<string>('relay')).toContain(`→ GT Inbox — ${STAMP}-b.md`);
  });

  it('KNOWN LIMIT: the exported_ids cursor hits the 9 KB Script Property ceiling long before its 2000-id cap', () => {
    // Google Tasks ids are ~32 characters; ~260 of them in a JSON array exceed the platform's
    // 9 KB per-property value limit. The file is written first (durability order), THEN the
    // cursor write throws — so every later run re-exports the same tasks into a new file.
    const w = freshWorld();
    for (let k = 0; k < 270; k++) dictate(w, `dictated task ${k}`);
    const r = load(V2, w, { SOURCE_LIST: 'Dictation' });
    expect(() => r.fn('relay')).toThrow(/Argument too large/);
    expect(w.files.filter((f) => f.name.startsWith('GT Inbox — '))).toHaveLength(1); // written…
    expect(w.props.has('exported_ids')).toBe(false); // …but not remembered
    w.clock.set('2026-09-07T18:45:00Z');
    expect(() => r.fn('relay')).toThrow(/Argument too large/);
    expect(w.files.filter((f) => f.name.startsWith('GT Inbox — '))).toHaveLength(2); // duplicate export, every 15 minutes from here on
    expect(w.mails).toHaveLength(2);
  });
});

// ================================================================ outbound — drive lane

const OUTBOX_1 = [
  '# GT Outbox — 2026-09-07-2100',
  'Base: 2026-08-31-1137 + deltas to 2026-09-06-1445',
  '## ROWS',
  '- T-086 | Start recycling with Georgi at the Art College | DL | 2026-09-12 | Planned',
  '- T-061 | Booking system quotes | SO | 2026-10-01 | Blocked',
  '- T-052 | Book dentist | SB | 2026-09-15 | Inbox',
  '',
].join('\n');

const OUTBOX_2 = [
  '# GT Outbox — 2026-09-07-2200',
  '## ROWS',
  '- T-086 | Start recycling with Georgi at the Art College | DL | 2026-09-19 | Active',
  '- T-052 | Book dentist | SB | 2026-09-15 | Inbox',
  '',
].join('\n');

describe('outbound lane ← Drive', () => {
  it('a GT Outbox with three rows → three tasks in "PTO deadlines" with due dates and pto:T- notes', () => {
    const w = freshWorld();
    w.addFile('GT Outbox — 2026-09-07-2100.md', OUTBOX_1);
    const r = load(V2, w, { SOURCE_LIST: 'Dictation' });
    expect(r.fn<string>('testRun')).toContain('out: would mirror 3 dated row(s) from 2026-09-07-2100, complete 0 that left the set');
    expect(w.lists.map((l) => l.title)).toEqual(['My Tasks', 'Dictation']); // dry run creates nothing

    const report = r.fn<string>('relay');
    expect(report).toContain('out: mirrored 3 dated row(s) from 2026-09-07-2100, completed 0');
    const list = w.lists.find((l) => l.title === 'PTO deadlines');
    expect(list).toBeDefined();
    const byTitle = Object.fromEntries(list!.tasks.map((t) => [t.title, t]));
    expect(Object.keys(byTitle).sort()).toEqual(['T-086 · Start recycling with Georgi at the Art College', 'start by · T-052 · Book dentist', 'start on · T-061 · Booking system quotes'].sort());
    expect(byTitle['T-086 · Start recycling with Georgi at the Art College']).toMatchObject({ due: '2026-09-12T00:00:00.000Z', status: 'needsAction' });
    expect(byTitle['start on · T-061 · Booking system quotes']!.due).toBe('2026-10-01T00:00:00.000Z');
    expect(byTitle['start by · T-052 · Book dentist']!.due).toBe('2026-09-15T00:00:00.000Z');
    for (const t of list!.tasks) {
      expect(t.notes).toMatch(/^pto:T-\d+ · (DL|SO|SB) \d{4}-\d{2}-\d{2} · \w+ · mirrored from 2026-09-07-2100\nDo not edit here — the registry is the source\.$/);
    }
    const map = JSON.parse(w.props.get('outbound_map')!);
    expect(Object.keys(map).sort()).toEqual(['T-052', 'T-061', 'T-086']);
    expect(w.props.get('last_outbox_stamp')).toBe('2026-09-07-2100');
    // the archive files were listed by name, never modified; the dictation list was not written
    expect(archiveNames(w)).toEqual(ARCHIVE);
    expect(w.lists.find((l) => l.title === 'Dictation')!.tasks).toEqual([]);
  });

  it('a same-stamp outbox is not re-mirrored; a newer outbox missing a row completes that task and patches the rest', () => {
    const w = freshWorld();
    w.addFile('GT Outbox — 2026-09-07-2100.md', OUTBOX_1);
    const r = load(V2, w, { SOURCE_LIST: 'Dictation' });
    r.fn('relay');
    const writes = () => w.calls.filter((c) => c.api === 'Tasks.insert' || c.api === 'Tasks.patch').length;
    const before = writes();
    w.clock.set('2026-09-07T18:45:00Z');
    expect(r.fn<string>('relay')).toContain('out: outbox 2026-09-07-2100 already mirrored');
    expect(writes()).toBe(before);

    // the newest outbox wins by stamp, whatever order Drive lists them in
    w.addFile('GT Outbox — 2026-09-07-2200.md', OUTBOX_2);
    w.addFile('GT Outbox — 2026-09-07-2030.md', '# older\n## ROWS\n- T-001 | stale | DL | 2026-01-01 | Planned\n');
    w.clock.set('2026-09-07T19:00:00Z');
    expect(r.fn<string>('relay')).toContain('out: mirrored 2 dated row(s) from 2026-09-07-2200, completed 1');
    const list = w.lists.find((l) => l.title === 'PTO deadlines')!;
    const t061 = list.tasks.find((t) => t.title.includes('T-061'))!;
    expect(t061.status).toBe('completed');
    const t086 = list.tasks.find((t) => t.title.includes('T-086'))!;
    expect(t086).toMatchObject({ status: 'needsAction', due: '2026-09-19T00:00:00.000Z' });
    expect(t086.notes).toContain('· Active · mirrored from 2026-09-07-2200');
    expect(list.tasks).toHaveLength(3); // patched in place, not re-created
    expect(Object.keys(JSON.parse(w.props.get('outbound_map')!)).sort()).toEqual(['T-052', 'T-086']);
    expect(list.tasks.find((t) => t.title.includes('T-001'))).toBeUndefined();
  });

  it('a mirrored task deleted by hand is re-created on the next mirror', () => {
    const w = freshWorld();
    w.addFile('GT Outbox — 2026-09-07-2100.md', OUTBOX_1);
    const r = load(V2, w, { SOURCE_LIST: 'Dictation' });
    r.fn('relay');
    const list = w.lists.find((l) => l.title === 'PTO deadlines')!;
    list.tasks = list.tasks.filter((t) => !t.title.includes('T-052'));
    w.addFile('GT Outbox — 2026-09-07-2200.md', OUTBOX_1.replace('2026-09-07-2100', '2026-09-07-2200'));
    r.fn('relay');
    expect(list.tasks.filter((t) => t.title.includes('T-052'))).toHaveLength(1);
    expect(list.tasks).toHaveLength(3);
  });

  it('BRIEF MISMATCH: the install brief’s test row "T-TEST" does not match the outbox grammar (T-digits only)', () => {
    const w = freshWorld();
    w.addFile('GT Outbox — 2026-09-07-1200.md', '# GT Outbox — 2026-09-07-1200\n## ROWS\n- T-TEST | Relay outbound test | DL | 2026-09-10 | Planned\n');
    const r = load(V2, w, { SOURCE_LIST: 'Dictation' });
    expect(r.fn('parseOutbox_', '- T-TEST | Relay outbound test | DL | 2026-09-10 | Planned')).toEqual([]);
    expect(r.fn('parseOutbox_', '- T-999 | Relay outbound test | DL | 2026-09-10 | Planned')).toEqual([{ id: 'T-999', task: 'Relay outbound test', type: 'DL', date: '2026-09-10', status: 'Planned' }]);
    // so step 6 of the brief, run verbatim, reports 0 rows instead of the expected 1
    expect(r.fn<string>('relay')).toContain('out: mirrored 0 dated row(s) from 2026-09-07-1200, completed 0');
  });
});

// ================================================================ service lane — against the real service

const base = { u: null, i: null, triaged: null, deadline: null, deadline_type: null, deadline_kind: null, done: null, blocker: null, notes: '', updated_at: '2026-09-06T10:00:00+03:00' };
const SEED: SeedRow[] = [
  { ...base, id: 'T-041', task: 'Chase Ian for the pay figure', category: 'Freelance Videoediting', u: 'H', i: 'M', status: 'Planned', recorded: '2026-07-17', triaged: '2026-08-04', deadline: '2026-08-26', deadline_type: 'DL', deadline_kind: 'hard' },
  { ...base, id: 'T-052', task: 'Book dentist', category: 'Personal / Admin', u: 'L', i: 'M', status: 'Inbox', recorded: '2026-08-22', deadline: '2026-09-15', deadline_type: 'SB', deadline_kind: 'self' },
  { ...base, id: 'T-060', task: 'Price list for the Art College', category: 'Art College', status: 'Inbox', recorded: '2026-08-01' },
  { ...base, id: 'T-061', task: 'Booking system quotes', category: 'Art College', u: 'M', i: 'H', status: 'Blocked', recorded: '2026-08-05', triaged: '2026-08-11', deadline: '2026-10-01', deadline_type: 'SO', deadline_kind: 'self', blocker: 'Sasho' },
  { ...base, id: 'T-070', task: 'Volvo brakes', category: 'Personal / Admin', u: 'H', i: 'M', status: 'Done', recorded: '2026-08-10', triaged: '2026-08-20', deadline: '2026-08-20', deadline_type: 'DL', deadline_kind: 'hard', done: '2026-08-22' },
  { ...base, id: 'T-080', task: 'Send the exhibition proposal', category: 'Best Moments', u: 'M', i: 'M', status: 'Planned', recorded: '2026-08-25', triaged: '2026-09-07', deadline: '2026-09-09', deadline_type: 'DL', deadline_kind: 'hard' },
  { ...base, id: 'T-102', task: 'Latest row', category: 'Personal / Admin', status: 'Inbox', recorded: '2026-09-06' },
];

describe('service lane (flags flipped, Script Properties set) against the real Registry Service', () => {
  let bridge: ServiceBridge;

  beforeAll(async () => {
    bridge = new ServiceBridge({ seed: SEED, stamp: '2026-09-06-1445', env: { MACHINE_TOKEN: TOKEN }, nowIso: NOW });
    await bridge.waitReady();
  });
  afterAll(async () => {
    await bridge.close();
  });
  beforeEach(() => {
    bridge.reset();
  });

  function serviceWorld(baseUrl: string) {
    const w = freshWorld(bridge);
    w.props.set('SERVICE_BASE_URL', baseUrl);
    w.props.set('SERVICE_TOKEN', TOKEN);
    return w;
  }
  const flipped = { SOURCE_LIST: 'Dictation', INBOUND_TARGET: 'service', OUTBOUND_SOURCE: 'service' };
  const registry = () => JSON.parse(bridge.fetchSync('GET', `${bridge.origin}/api/v1/registry`).text) as { rows: any[]; next_free_id: string };
  const judgments = (id: string) => bridge.sql<{ actor: string; source: string; human_judgment: number }>('SELECT actor, source, human_judgment FROM judgments WHERE task_id = ? ORDER BY id', [id]);

  it('sanity: the real service answers on the thread, with the machine token', () => {
    expect(registry().next_free_id).toBe('T-103');
    const dated = bridge.fetchSync('GET', `${bridge.origin}/api/v1/dated`, { Authorization: `Bearer ${TOKEN}` });
    expect(dated.status).toBe(200);
    expect(JSON.parse(dated.text).map((r: any) => r.id)).toEqual(['T-041', 'T-080', 'T-052', 'T-061']);
    expect(bridge.fetchSync('GET', `${bridge.origin}/api/v1/dated`, { Authorization: 'Bearer wrong' }).status).toBe(401);
  });

  describe('v2.1 (SERVICE block corrected) — PASSES', () => {
    it('inbound posts to /api/v1/capture: rows land as Inbox, source gtasks, actor gt-relay, no scores; cursor advances after the 200', () => {
      const w = serviceWorld(bridge.origin);
      const a = dictate(w, 'call the yard company');
      const b = dictate(w, 'buy printer paper', { due: '2026-09-10T00:00:00.000Z' });
      const r = load(V21, w, flipped);
      expect(r.service).toEqual({ capturePath: '/api/v1/capture', datedRowsPath: '/api/v1/dated' });

      const report = r.fn<string>('relay');
      expect(report).toContain('in:  exported 2 task(s) → service /api/v1/capture (200)');

      const post = w.fetches.find((f) => f.method === 'POST')!;
      expect(post.url).toBe(`${bridge.origin}/api/v1/capture`);
      expect(post.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' });
      const payload = JSON.parse(post.payload!);
      expect(payload).toMatchObject({ actor: 'gt-relay', source: 'gtasks' });
      expect(payload.items.map((i: any) => i.task)).toEqual(['call the yard company', 'buy printer paper']);

      const rows = registry().rows;
      const t103 = rows.find((x) => x.id === 'T-103');
      const t104 = rows.find((x) => x.id === 'T-104');
      expect(t103).toMatchObject({ task: 'call the yard company', status: 'Inbox', recorded: TODAY, triaged: null, u: null, i: null, deadline: null, category: 'Personal / Admin' });
      expect(t103.notes).toContain(`dictated via Gemini · gt:${a.id} · seen ${TODAY}`);
      expect(t104).toMatchObject({ task: 'buy printer paper', status: 'Inbox', triaged: null, u: null, i: null, deadline: null });
      expect(t104.notes).toContain(`gt:${b.id} · seen ${TODAY} · gt-due 2026-09-10`); // provenance, not a deadline
      expect(judgments('T-103')).toEqual([{ actor: 'gt-relay', source: 'gtasks', human_judgment: 0 }]);
      expect(judgments('T-104')).toEqual([{ actor: 'gt-relay', source: 'gtasks', human_judgment: 0 }]);

      expect(JSON.parse(w.props.get('exported_ids')!)).toEqual([a.id, b.id]);
      expect(w.files.filter((f) => f.name.startsWith('GT Inbox'))).toHaveLength(0); // no Drive file in service mode
      expect(w.mails).toEqual([]);

      w.clock.set('2026-09-07T18:45:00Z');
      expect(r.fn<string>('relay')).toContain('in:  nothing new (2 open in the list)');
      expect(registry().next_free_id).toBe('T-105'); // nothing captured twice
    });

    it('outbound reads /api/v1/dated and mirrors every open dated row; closed rows are excluded; the next run patches in place', () => {
      const w = serviceWorld(bridge.origin);
      const r = load(V21, w, flipped);
      const report = r.fn<string>('relay');
      expect(report).toContain(`out: mirrored 4 dated row(s) from service ${STAMP}, completed 0`);
      const get = w.fetches.find((f) => f.method === 'GET')!;
      expect(get.url).toBe(`${bridge.origin}/api/v1/dated`);
      expect(get.headers.Authorization).toBe(`Bearer ${TOKEN}`);

      const list = w.lists.find((l) => l.title === 'PTO deadlines')!;
      const titles = list.tasks.map((t) => t.title).sort();
      expect(titles).toEqual(['T-041 · Chase Ian for the pay figure', 'T-080 · Send the exhibition proposal', 'start by · T-052 · Book dentist', 'start on · T-061 · Booking system quotes'].sort());
      expect(list.tasks.find((t) => t.title.includes('T-041'))!.due).toBe('2026-08-26T00:00:00.000Z');
      expect(list.tasks.find((t) => t.title.includes('T-061'))!.notes).toMatch(/^pto:T-061 · SO 2026-10-01 · Blocked · mirrored from service /);
      expect(list.tasks.find((t) => t.title.includes('T-070'))).toBeUndefined(); // Done, dated: excluded by the service
      expect(list.tasks.find((t) => t.title.includes('T-060'))).toBeUndefined(); // undated: excluded

      // the registry was not written by the outbound lane
      expect(w.fetches.filter((f) => f.method !== 'GET')).toEqual([]);
      expect(bridge.sql('SELECT COUNT(*) AS n FROM judgments')[0]!.n).toBe(0);

      // FtB closes T-080 through the service; the next run completes its mirror and patches the rest
      const close = bridge.fetchSync('POST', `${bridge.origin}/api/v1/tasks/T-080/close`, { 'Content-Type': 'application/json' }, JSON.stringify({ actor: 'ftb', source: 'app', human_judgment: true }));
      expect(close.status).toBe(200);
      w.clock.set('2026-09-07T18:45:00Z');
      expect(r.fn<string>('relay')).toContain('out: mirrored 3 dated row(s) from service 2026-09-07-2145, completed 1');
      expect(list.tasks.find((t) => t.title.includes('T-080'))!.status).toBe('completed');
      expect(list.tasks).toHaveLength(4); // patched, not duplicated
    });

    it('a wrong token is a 401 on both lanes: nothing captured, nothing mirrored, cursor untouched, one error mail', () => {
      const w = serviceWorld(bridge.origin);
      w.props.set('SERVICE_TOKEN', 'wrong');
      dictate(w, 'call the yard company');
      const r = load(V21, w, flipped);
      expect(() => r.fn('relay')).toThrow(/service \/api\/v1\/capture → 401.*service \/api\/v1\/dated → 401/s);
      expect(w.props.has('exported_ids')).toBe(false);
      expect(w.lists.find((l) => l.title === 'PTO deadlines')).toBeUndefined();
      expect(registry().next_free_id).toBe('T-103');
      expect(w.mails).toHaveLength(1);
    });

    it('the relay is covenant-safe by construction: its token cannot reach a judgment route', () => {
      const res = bridge.fetchSync('POST', `${bridge.origin}/api/v1/judgments`, { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, JSON.stringify({ human_judgment: true, judgments: [{ id: 'T-052', u: 'H' }] }));
      expect(res.status).toBe(403);
      expect(JSON.parse(res.text).error).toBe('forbidden');
    });
  });

  describe('v2 (SERVICE block as designed) — FAILS against the real contract', () => {
    it('with SERVICE_BASE_URL = origin: both lanes 404 (/capture, /radar are not under /api/v1); error mail every run, nothing captured', () => {
      const w = serviceWorld(bridge.origin);
      dictate(w, 'call the yard company');
      const r = load(V2, w, flipped);
      expect(r.service).toEqual({ capturePath: '/capture', datedRowsPath: '/radar' });
      expect(() => r.fn('relay')).toThrow(/INBOUND: .*service \/capture → 404/s);
      expect(w.mails[0]!.body).toMatch(/OUTBOUND: .*service \/radar → 404/s);
      expect(registry().next_free_id).toBe('T-103');
      expect(w.props.has('exported_ids')).toBe(false);
      expect(w.lists.find((l) => l.title === 'PTO deadlines')).toBeUndefined();
    });

    it('with SERVICE_BASE_URL = origin + /api/v1: inbound now lands only because the service normalises { rows }; outbound still breaks on the radar’s sections', () => {
      const w = serviceWorld(`${bridge.origin}/api/v1`);
      const a = dictate(w, 'call the yard company');
      const r = load(V2, w, flipped);
      expect(() => r.fn('relay')).toThrow(/OUTBOUND: .*\.map is not a function/s);
      // inbound: accepted, normalised, recorded as gtasks / gt-relay
      const rows = registry().rows;
      expect(rows.find((x) => x.id === 'T-103')).toMatchObject({ task: 'call the yard company', status: 'Inbox', triaged: null, u: null, i: null });
      expect(judgments('T-103')).toEqual([{ actor: 'gt-relay', source: 'gtasks', human_judgment: 0 }]);
      expect(JSON.parse(w.props.get('exported_ids')!)).toEqual([a.id]);
      const post = w.fetches.find((f) => f.method === 'POST')!;
      expect(JSON.parse(post.payload!).rows[0]).toMatchObject({ task: 'call the yard company', source: 'gtasks', actor: 'gt-relay' });
      // outbound: GET /api/v1/radar returned the sections object, not an array
      const get = w.fetches.find((f) => f.method === 'GET')!;
      expect(get.url).toBe(`${bridge.origin}/api/v1/radar`);
      expect(get.status).toBe(200);
      expect(w.lists.find((l) => l.title === 'PTO deadlines')).toBeUndefined();
      expect(w.mails).toHaveLength(1);
    });
  });
});

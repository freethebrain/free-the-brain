// Delta parser and applier: synthetic lines for the tricky syntax, then the real chain — the
// nine deltas stamped after 2026-08-31-1137 applied to the base, checked against the counts the
// last delta declares in its FOR THE NEXT COMPACTION section.
import { describe, expect, it } from 'vitest';
import {
  applyChanges,
  countRows,
  nextFreeId,
  parseChangeLine,
  parseCounts,
  parseDelta,
  parseNextFreeId,
  parseSnapshot,
  resolveRegistry,
  serializeDelta,
} from '../src/index.ts';
import { BASE_STAMP, LATER_DELTAS, hasRegistry, loadRegistryFiles, readRegistryFile } from './fixtures.ts';

describe('parseChangeLine', () => {
  it('parses the protocol examples', () => {
    const a = parseChangeLine('T-023 (Volvo brakes) | Status=Done | Done=2026-08-22 | note+=paid EUR 340 against a researched EUR 520 band');
    expect(a).toEqual({
      id: 'T-023',
      name: 'Volvo brakes',
      isNew: false,
      sets: { Status: 'Done', Done: '2026-08-22' },
      noteAppends: ['paid EUR 340 against a researched EUR 520 band'],
    });
    const b = parseChangeLine('T-052 (book dentist) | NEW | Task=Book dentist | Category=Personal / Admin | U=L | I=M | Status=Inbox | Recorded=2026-08-22');
    expect(b.isNew).toBe(true);
    expect(b.sets).toEqual({ Task: 'Book dentist', Category: 'Personal / Admin', U: 'L', I: 'M', Status: 'Inbox', Recorded: '2026-08-22' });
    const c = parseChangeLine("T-018.1.1 (scan father's dissertation) | RENUMBERED FROM=T-047.1 | Status=Active");
    expect(c.renumberedFrom).toBe('T-047.1');
    expect(c.id).toBe('T-018.1.1');
  });

  it('survives parentheses inside the task name and Deadline=none', () => {
    const c = parseChangeLine('T-015.1 (meet Zacksi (introductory meeting only)) | Deadline=none | Triaged=2026-09-07');
    expect(c.name).toBe('meet Zacksi (introductory meeting only)');
    expect(c.sets).toEqual({ Deadline: 'none', Triaged: '2026-09-07' });
  });

  it('glues a " | " inside free text back onto the preceding note', () => {
    const c = parseChangeLine('T-001 (x) | U=H | note+=a | b | c');
    expect(c.sets).toEqual({ U: 'H' });
    expect(c.noteAppends).toEqual(['a | b | c']);
  });

  it('rejects an unknown field that is not a continuation', () => {
    expect(() => parseChangeLine('T-001 (x) | Urgency=H')).toThrow(/Unrecognised/);
  });
});

describe('parseDelta', () => {
  it('reads a bare-header delta with prose and a compaction section', () => {
    const d = parseDelta(
      [
        'Registry Delta — 2026-09-01-2014',
        '',
        'Base: Task Registry — 2026-08-31-1137.md',
        'Prior deltas: 2026-08-31-1153',
        'Written by: someone',
        '',
        'CHANGES',
        '',
        'T-091 (Pay Antonia) | NEW | Task=Pay Antonia | Category=Personal / Admin | Status=Planned | Recorded=2026-09-01',
        '',
        '## FOR THE NEXT COMPACTION',
        '',
        'Counts after this delta: 71 open, 73 done, 1 dropped, 145 total.',
      ].join('\n'),
    );
    expect(d.stamp).toBe('2026-09-01-2014');
    expect(d.baseStamp).toBe(BASE_STAMP);
    expect(d.priorDeltas).toEqual(['2026-08-31-1153']);
    expect(d.changes).toHaveLength(1);
    expect(d.forNextCompaction).toContain('71 open');
    expect(d.warnings).toEqual([]);
  });

  it('treats "(none) — first delta" as an empty prior list', () => {
    const d = parseDelta('# Registry Delta — 2026-08-31-1153\nBase: Task Registry — 2026-08-31-1137.md\nPrior deltas: (none) — first delta on the freshly compacted base\n\n## CHANGES\n');
    expect(d.priorDeltas).toEqual([]);
    expect(d.changes).toEqual([]);
  });

  it('round-trips through serializeDelta', () => {
    const text = serializeDelta({
      stamp: '2026-09-07-1200',
      baseStamp: BASE_STAMP,
      priorDeltas: ['2026-08-31-1153'],
      writtenBy: 'test',
      changes: [
        { id: 'T-001', name: 'Finish Thumbly (site)', isNew: false, sets: { U: 'H', Deadline: 'none' }, noteAppends: ['one', 'two | three'] },
        { id: 'T-200', name: 'New thing', isNew: true, sets: { Task: 'New thing', Category: 'Art College', Status: 'Inbox', Recorded: '2026-09-07' }, noteAppends: [] },
      ],
      forNextCompaction: 'Counts: 1 open.',
    });
    const d = parseDelta(text);
    expect(d.stamp).toBe('2026-09-07-1200');
    expect(d.priorDeltas).toEqual(['2026-08-31-1153']);
    expect(d.changes[0]).toEqual({ id: 'T-001', name: 'Finish Thumbly (site)', isNew: false, sets: { U: 'H', Deadline: 'none' }, noteAppends: ['one', 'two | three'] });
    expect(d.changes[1]!.isNew).toBe(true);
    expect(d.forNextCompaction).toBe('Counts: 1 open.');
  });
});

describe('applyChanges', () => {
  const base = parseSnapshot(
    `Last synced: 2026-01-01-0000\n\n| ID | Task | Category | U | I | Status | Recorded | Triaged | Deadline | Done | Notes |\n|--|--|--|--|--|--|--|--|--|--|--|\n| T-001 | One | Art College | H | M | Planned | 2026-01-01 | — | DL 2026-02-01 | — | first |\n| T-002.1 | Sub | Art College | — | — | Inbox | 2026-01-01 | — | — | — | — |\n`,
  ).rows;

  it('sets only mentioned fields, appends notes, clears with none', () => {
    const { rows, warnings } = applyChanges(
      base,
      [
        { id: 'T-001', name: 'One', isNew: false, sets: { Deadline: 'none', Triaged: '2026-01-05' }, noteAppends: ['second'] },
        { id: 'T-002.1', name: 'Sub', isNew: false, sets: { U: 'L' }, noteAppends: [] },
      ],
      { updatedAt: '2026-01-05T10:00:00+02:00' },
    );
    expect(warnings).toEqual([]);
    expect(rows[0]).toMatchObject({ deadline: null, deadline_type: null, deadline_kind: null, triaged: '2026-01-05', u: 'H', i: 'M', notes: 'first\nsecond', status: 'Planned' });
    expect(rows[1]).toMatchObject({ u: 'L', i: null, notes: '' });
    expect(base[0]!.deadline).toBe('2026-02-01'); // input untouched
  });

  it('adds NEW rows, renumbers, and warns on a missing base row', () => {
    const { rows, warnings } = applyChanges(
      base,
      [
        { id: 'T-003', name: 'Three', isNew: true, sets: { Task: 'Three', Category: 'Real Estate', Status: 'Inbox', Recorded: '2026-01-06' }, noteAppends: ['captured'] },
        { id: 'T-001.1', name: 'Sub', isNew: false, renumberedFrom: 'T-002.1', sets: {}, noteAppends: ['RENUMBERED: was T-002.1'] },
        { id: 'T-999', name: 'Ghost', isNew: false, sets: { U: 'H' }, noteAppends: [] },
      ],
      { updatedAt: '2026-01-06T10:00:00+02:00' },
    );
    expect(rows.map((r) => r.id)).toEqual(['T-001', 'T-001.1', 'T-003', 'T-999']);
    expect(rows[2]).toMatchObject({ task: 'Three', category: 'Real Estate', status: 'Inbox', notes: 'captured', recorded: '2026-01-06' });
    expect(rows[1]!.notes).toBe('RENUMBERED: was T-002.1');
    expect(warnings.some((w) => w.includes('T-999'))).toBe(true);
  });
});

describe.skipIf(!hasRegistry)('the real delta chain', () => {
  it('applies the nine later deltas and matches the last declared counts', () => {
    const files = loadRegistryFiles();
    const reg = resolveRegistry(files);
    expect(reg.baseStamp).toBe(BASE_STAMP);
    expect(reg.deltas.map((d) => d.stamp)).toEqual(LATER_DELTAS);
    expect(reg.stamp).toBe(LATER_DELTAS[LATER_DELTAS.length - 1]);
    for (const d of reg.deltas) expect(d.baseStamp).toBe(BASE_STAMP);
    expect(reg.warnings).toEqual([]);

    const derived = countRows(reg.rows);
    const last = reg.deltas[reg.deltas.length - 1]!;
    const declared = last.forNextCompaction ? parseCounts(last.forNextCompaction) : undefined;
    // eslint-disable-next-line no-console
    console.log(`Derived counts after the delta chain: ${JSON.stringify(derived)}; declared by ${last.stamp}: ${JSON.stringify(declared ?? 'nothing')}`);
    if (declared) expect(derived).toEqual(declared);
    else expect(derived.total).toBeGreaterThanOrEqual(142);

    const declaredNext = last.forNextCompaction ? parseNextFreeId(last.forNextCompaction) : undefined;
    if (declaredNext) expect(nextFreeId(reg.rows)).toBe(declaredNext);

    const byId = new Map(reg.rows.map((r) => [r.id, r]));
    expect(byId.get('T-096')).toMatchObject({ status: 'Dropped', done: '2026-09-06' });
    expect(byId.get('T-091')).toMatchObject({ status: 'Planned', u: 'H', i: 'L', deadline: '2026-09-03', deadline_type: 'DL', triaged: '2026-09-01' });
    expect(byId.get('T-092')).toMatchObject({ deadline: '2026-09-09', deadline_type: 'SB' });
    expect(byId.get('T-094.1')?.notes.startsWith('Cowork brief written 2026-09-03')).toBe(true);
    // note+= appended, original text intact.
    const t085 = byId.get('T-085')!;
    expect(t085.notes.startsWith('GENERATED, NOT INSTALLED.')).toBe(true);
    expect(t085.notes).toContain('\nCLOSE PROPOSED 2026-08-31, NOT APPLIED.');
  });

  it('parses every delta in the folder, including the ones on the older base', () => {
    const names = loadRegistryFiles().map((f) => f.name).filter((n) => n.startsWith('Registry Delta'));
    expect(names.length).toBeGreaterThanOrEqual(21);
    for (const name of names) {
      const d = parseDelta(readRegistryFile(name), { filename: name });
      expect(d.baseStamp).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}$/);
      expect(d.changes.length).toBeGreaterThan(0);
      for (const c of d.changes) expect(c.id).toMatch(/^T-\d+(\.\d+)*$/);
    }
  });
});

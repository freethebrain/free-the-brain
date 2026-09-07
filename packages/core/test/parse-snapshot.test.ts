// Snapshot parser against the real 2026-08-31-1137 snapshot, plus synthetic edge cases.
import { describe, expect, it } from 'vitest';
import { countRows, parseSnapshot, serializeRow, serializeSnapshot, splitRow } from '../src/index.ts';
import { BASE_STAMP, hasRegistry, readRegistryFile } from './fixtures.ts';

const SNAP_NAME = `Task Registry — ${BASE_STAMP}.md`;

describe.skipIf(!hasRegistry)('parseSnapshot on the real snapshot', () => {
  const text = hasRegistry ? readRegistryFile(SNAP_NAME) : '';
  const snap = hasRegistry ? parseSnapshot(text, { filename: SNAP_NAME }) : null!;

  it('finds the stamp, counts and next free ID in the preamble', () => {
    expect(snap.stamp).toBe(BASE_STAMP);
    expect(snap.counts).toEqual({ open: 68, done: 73, dropped: 1, total: 142 });
    expect(snap.nextFreeId).toBe('T-091');
    expect(snap.preamble.startsWith('# Task Registry')).toBe(true);
  });

  it('parses exactly 142 rows with the declared status split', () => {
    expect(snap.rows).toHaveLength(142);
    expect(countRows(snap.rows)).toEqual({ open: 68, done: 73, dropped: 1, total: 142 });
  });

  it('reads typed deadlines and derives kinds', () => {
    const byId = new Map(snap.rows.map((r) => [r.id, r]));
    expect(byId.get('T-011')).toMatchObject({ deadline: '2026-09-21', deadline_type: 'SO' });
    expect(byId.get('T-082.1')).toMatchObject({ deadline: '2026-09-01', deadline_type: 'SB' });
    expect(byId.get('T-003')).toMatchObject({ deadline: '2026-09-01', deadline_type: 'DL', deadline_kind: 'hard' });
    expect(byId.get('T-086')).toMatchObject({ deadline: '2026-09-12', deadline_type: 'DL', deadline_kind: 'hard' });
    expect(byId.get('T-005')).toMatchObject({ deadline: '2026-08-09', deadline_type: 'DL', deadline_kind: 'self' });
    expect(byId.get('T-001')?.deadline).toBeNull();
    expect(byId.get('T-001')?.deadline_kind).toBeNull();
    expect(byId.get('T-084')).toMatchObject({ u: null, i: null, status: 'Inbox', triaged: null });
    expect(byId.get('T-083')?.blocker).toMatch(/waiting on his mother/);
  });

  it('never loses Notes text', () => {
    const lines = text.split('\n').filter((l) => l.startsWith('| T-'));
    for (const [k, r] of snap.rows.entries()) {
      const cells = splitRow(lines[k]!);
      const noteCell = cells[10] ?? '';
      expect(r.notes).toBe(noteCell === '—' ? '' : noteCell);
    }
  });

  it('round-trips parse → serialize → parse losslessly', () => {
    const out = serializeSnapshot({ stamp: snap.stamp, preamble: snap.preamble, rows: snap.rows, postamble: snap.postamble });
    const again = parseSnapshot(out, { filename: SNAP_NAME });
    expect(again.rows).toEqual(snap.rows);
    expect(again.preamble).toBe(snap.preamble);
    expect(again.counts).toEqual(snap.counts);
    // The whole file too, modulo a trailing newline.
    expect(out.trimEnd()).toBe(text.trimEnd());
  });

  it('reproduces every table line byte for byte', () => {
    const original = text.split('\n').filter((l) => l.startsWith('| T-'));
    const rewritten = snap.rows.map(serializeRow);
    expect(rewritten).toEqual(original);
  });
});

describe('parseSnapshot edge cases', () => {
  const head = `# Task Registry\n\nLast synced: 2026-01-02-0304 (Europe/Sofia)\n\n`;
  const header = `| ID | Task | Category | U | I | Status | Recorded | Triaged | Deadline | Done | Notes |\n|----|------|----------|---|---|--------|----------|---------|----------|------|-------|\n`;

  it('keeps escaped pipes inside Notes and takes the stamp from the Last synced line', () => {
    const src = `${head}${header}| T-001 | A \\| B | Art College | H | — | Inbox | 2026-01-01 | — | — | — | note with a \\| pipe |\n`;
    const s = parseSnapshot(src);
    expect(s.stamp).toBe('2026-01-02-0304');
    expect(s.rows[0]).toMatchObject({ task: 'A | B', notes: 'note with a | pipe', u: 'H', i: null });
    expect(serializeRow(s.rows[0]!)).toContain('A \\| B');
  });

  it('glues an unescaped pipe in Notes back together rather than dropping text', () => {
    const src = `${head}${header}| T-002 | X | Art College | — | — | Planned | 2026-01-01 | — | SB 2026-02-01 | — | left | right |\n`;
    const s = parseSnapshot(src);
    expect(s.rows[0]!.notes).toBe('left | right');
    expect(s.rows[0]).toMatchObject({ deadline: '2026-02-01', deadline_type: 'SB' });
  });

  it('keeps a postamble after the table', () => {
    const src = `${head}${header}| T-003 | X | Art College | — | — | Done | 2026-01-01 | — | — | 2026-01-02 | — |\n\n## APPENDIX\nkept\n`;
    const s = parseSnapshot(src);
    expect(s.postamble).toBe('## APPENDIX\nkept\n');
    const again = parseSnapshot(serializeSnapshot(s));
    expect(again.postamble.trim()).toBe('## APPENDIX\nkept');
    expect(again.rows).toEqual(s.rows);
  });
});

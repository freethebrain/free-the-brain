// Parses a "Task Registry — YYYY-MM-DD-HHMM.md" snapshot: preamble, the eleven-column table,
// anything after it. Cells are split on unescaped pipes, so a "\|" inside Notes survives, and
// Notes text is never trimmed of anything but its surrounding whitespace.

import { deriveBlocker, deriveDeadlineKind, isEmptyCell, parseDate, parseDeadlineCell, parseScore, parseStatus } from './fields.ts';
import { STAMP_RE, stampToTimestamp } from './dates.ts';
import type { Counts, Snapshot, Task } from './types.ts';
import { FIELDS } from './types.ts';

export const TABLE_HEADER = `| ${FIELDS.join(' | ')} |`;
export const TABLE_RULE = `|${FIELDS.map((f) => '-'.repeat(Math.max(f.length + 2, 3))).join('|')}|`;

/** Split one table line into cells, honouring "\|" as a literal pipe. */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let i = 0;
  const s = line.trim();
  // Drop the leading pipe; the trailing one falls out naturally.
  if (s.startsWith('|')) i = 1;
  for (; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== '' || !s.endsWith('|')) cells.push(cur);
  return cells.map((c) => c.trim());
}

export function stampFromTitle(name: string): string | null {
  const m = STAMP_RE.exec(name);
  return m ? m[0] : null;
}

export function parseCounts(text: string): Counts | undefined {
  // Tolerates the deltas' running-total style: "82 open (+2), 73 done, 2 dropped, 157 total".
  const m = /(\d+)\s+open(?:\s*\([^)]*\))?,\s*(\d+)\s+done(?:\s*\([^)]*\))?,\s*(\d+)\s+dropped(?:\s*\([^)]*\))?,\s*\**\s*(\d+)\s+total/i.exec(text);
  if (!m) return undefined;
  return { open: +m[1]!, done: +m[2]!, dropped: +m[3]!, total: +m[4]! };
}

export function parseNextFreeId(text: string): string | undefined {
  const m = /next free (?:top-level )?ID(?:[^T\n]{0,40})(T-\d+)/i.exec(text);
  return m ? m[1] : undefined;
}

export function rowFromCells(cells: string[], updatedAt: string): Task {
  if (cells.length < FIELDS.length) {
    throw new Error(`Row "${cells[0] ?? ''}" has ${cells.length} cells, expected ${FIELDS.length}`);
  }
  // A Notes cell containing an unescaped pipe would spill into extra cells; glue them back.
  const notesCells = cells.slice(FIELDS.length - 1);
  const notesRaw = notesCells.join(' | ');
  const [id, task, category, u, i, status, recorded, triaged, deadlineCell, done] = cells;
  const dl = parseDeadlineCell(deadlineCell);
  const st = parseStatus(status);
  const notes = isEmptyCell(notesRaw) ? '' : notesRaw;
  const rec = parseDate(recorded);
  if (!rec) throw new Error(`Row ${id} has no Recorded date`);
  return {
    id: id!,
    task: task!,
    category: category!,
    u: parseScore(u),
    i: parseScore(i),
    status: st,
    recorded: rec,
    triaged: parseDate(triaged),
    deadline: dl.deadline,
    deadline_type: dl.deadline_type,
    deadline_kind: deriveDeadlineKind(notes, dl.deadline),
    done: parseDate(done),
    notes,
    blocker: deriveBlocker(st, notes),
    updated_at: updatedAt,
  };
}

export interface ParseSnapshotOptions {
  /** The file title, used for the stamp. Falls back to a "Last synced:" line, then a "# … — stamp" title. */
  filename?: string;
}

export function parseSnapshot(text: string, opts: ParseSnapshotOptions = {}): Snapshot {
  const src = text.replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  const headerIdx = lines.findIndex((l) => l.trim().startsWith('| ID |') && l.includes('| Task |'));
  if (headerIdx < 0) throw new Error('No registry table header found');

  const header = splitRow(lines[headerIdx]!);
  if (header.join('|') !== FIELDS.join('|')) {
    throw new Error(`Unexpected table columns: ${header.join(' | ')}`);
  }

  // Trailing blank lines belong to the layout, not the preamble; the serialiser puts them back.
  const preamble = lines.slice(0, headerIdx).join('\n').replace(/\s+$/, '');
  let stamp =
    (opts.filename && stampFromTitle(opts.filename)) ||
    /Last synced:\s*(\d{4}-\d{2}-\d{2}-\d{4})/.exec(preamble)?.[1] ||
    /^#\s*Task Registry\s*—\s*(\d{4}-\d{2}-\d{2}-\d{4})/m.exec(preamble)?.[1] ||
    null;
  if (!stamp) throw new Error('No stamp found: pass filename or include a "Last synced:" line');
  const updatedAt = stampToTimestamp(stamp);

  const rows: Task[] = [];
  let i = headerIdx + 1;
  // Skip the rule line.
  if (i < lines.length && /^\|?\s*-{2,}/.test(lines[i]!)) i++;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim().startsWith('|')) break;
    const cells = splitRow(line);
    if (!/^T-\d/.test(cells[0] ?? '')) continue;
    rows.push(rowFromCells(cells, updatedAt));
  }
  const postamble = lines.slice(i).join('\n').replace(/^\n+/, '');

  const snapshot: Snapshot = { stamp, preamble, rows, postamble };
  const counts = parseCounts(preamble);
  if (counts) snapshot.counts = counts;
  const next = parseNextFreeId(preamble);
  if (next) snapshot.nextFreeId = next;
  return snapshot;
}

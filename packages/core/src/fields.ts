// Cell-level conversions between the registry's text columns and the typed Task row.
// Shared by the snapshot parser and the delta applier so a "Deadline=SB 2026-09-01" means the
// same thing whether it arrives in a table cell or a delta line.

import type { DeadlineKind, DeadlineType, Score, Status, Task } from './types.ts';
import { DEADLINE_TYPES, SCORES, STATUSES } from './types.ts';

/** The registry writes an em dash for "empty". */
export const EMPTY = '—';

export function isEmptyCell(v: string | null | undefined): boolean {
  const t = (v ?? '').trim();
  return t === '' || t === EMPTY || t === '-' || t.toLowerCase() === 'none';
}

export function parseScore(v: string | null | undefined): Score | null {
  if (isEmptyCell(v)) return null;
  const t = (v ?? '').trim().toUpperCase();
  return (SCORES as readonly string[]).includes(t) ? (t as Score) : null;
}

export function parseStatus(v: string | null | undefined): Status {
  const t = (v ?? '').trim();
  const hit = STATUSES.find((s) => s.toLowerCase() === t.toLowerCase());
  if (!hit) throw new Error(`Unknown status "${t}"`);
  return hit;
}

export function parseDate(v: string | null | undefined): string | null {
  if (isEmptyCell(v)) return null;
  const t = (v ?? '').trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(t);
  return m ? m[1]! : null;
}

/** "SB 2026-09-01" → {type:'SB', date}; "2026-09-01" → DL; "—"/"none" → nulls. */
export function parseDeadlineCell(v: string | null | undefined): {
  deadline: string | null;
  deadline_type: DeadlineType | null;
} {
  if (isEmptyCell(v)) return { deadline: null, deadline_type: null };
  const t = (v ?? '').trim();
  const m = /^(DL|SO|SB)?\s*(\d{4}-\d{2}-\d{2})/i.exec(t);
  if (!m) throw new Error(`Unparseable deadline "${t}"`);
  const type = (m[1] ?? 'DL').toUpperCase() as DeadlineType;
  if (!DEADLINE_TYPES.includes(type)) throw new Error(`Unknown deadline type in "${t}"`);
  return { deadline: m[2]!, deadline_type: type };
}

export function formatDeadlineCell(t: Pick<Task, 'deadline' | 'deadline_type'>): string {
  if (!t.deadline) return EMPTY;
  return `${t.deadline_type ?? 'DL'} ${t.deadline}`;
}

/**
 * Heuristic, documented here and nowhere else: a dated row is "hard" when the word "hard"
 * appears in its Notes within 80 characters of the deadline's ISO date or of the words
 * "deadline", "DL" or "external"; otherwise "self". Undated rows carry no kind.
 * (T-003 "Hard external deadline" → hard; T-086 "DL 2026-09-12 IS NOW HARD" → hard.)
 */
export function deriveDeadlineKind(notes: string, deadline: string | null): DeadlineKind | null {
  if (!deadline) return null;
  const text = notes ?? '';
  const hard = /\bhard\b/gi;
  const anchors: number[] = [];
  const anchorRe = new RegExp(`${deadline}|\\bdeadline\\b|\\bDL\\b|\\bexternal\\b`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(text))) anchors.push(m.index);
  if (anchors.length === 0) return 'self';
  while ((m = hard.exec(text))) {
    const at = m.index;
    if (anchors.some((a) => Math.abs(a - at) <= 80)) return 'hard';
  }
  return 'self';
}

/**
 * A short label for what a Blocked row is waiting on, lifted from Notes. Heuristic: the text
 * after "BLOCKER:", "BLOCKED on", "Blocked on" or "waiting on", cut at the first sentence end
 * and capped at 80 characters. Null for rows that are not Blocked or carry no such phrase.
 */
export function deriveBlocker(status: Status, notes: string): string | null {
  if (status !== 'Blocked') return null;
  const m = /(?:BLOCKER:|blocked on|waiting on)\s*([^.;\n]{3,})/i.exec(notes ?? '');
  if (!m) return null;
  let label = m[1]!.trim().replace(/\*+/g, '');
  if (label.length > 80) label = label.slice(0, 77).trimEnd() + '…';
  return label;
}

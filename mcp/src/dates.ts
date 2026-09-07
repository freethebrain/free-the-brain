/**
 * Date semantics, ported from the Master widget (the same rules the client and
 * packages/core derive from). DL is overdue past its date; SB is overdue past its
 * date only while Inbox or Planned (Active/Blocked past start-by = started); SO is
 * never overdue — dormant before its date, eligible on and after it.
 */
import type { Task } from './types.js';

export function sofiaToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = fromIso.split('-').map(Number);
  const b = toIso.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

export function isoWeekMonday(todayIso: string): string {
  const a = todayIso.split('-').map(Number);
  const t = new Date(Date.UTC(a[0], a[1] - 1, a[2]));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

export type DateStateKind = 'overdue' | 'due' | 'startby' | 'started' | 'starts' | 'dormant' | 'eligible';

export interface DateState {
  kind: DateStateKind;
  /** days from today to the date (negative = past). */
  n: number;
}

export function dateState(row: Pick<Task, 'deadline' | 'deadline_type' | 'status'>, today: string): DateState | null {
  if (!row.deadline) return null;
  const n = daysBetween(today, row.deadline);
  const ty = row.deadline_type ?? 'DL';
  if (ty === 'SO') return n < 0 ? { kind: 'eligible', n } : n === 0 ? { kind: 'starts', n } : { kind: 'dormant', n };
  if (ty === 'SB') {
    if (n < 0) return row.status === 'Inbox' || row.status === 'Planned' ? { kind: 'overdue', n } : { kind: 'started', n };
    return { kind: 'startby', n };
  }
  return n < 0 ? { kind: 'overdue', n } : { kind: 'due', n };
}

export function isOverdue(row: Task, today: string): boolean {
  return dateState(row, today)?.kind === 'overdue';
}

/** Dated within N days and not dormant — the radar/queue "within 14 days" test. */
export function withinDays(row: Task, today: string, days: number): boolean {
  const d = dateState(row, today);
  return !!d && d.n >= 0 && d.n <= days && d.kind !== 'dormant';
}

const inN = (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n}d`);

/** The widget's date chip as text: "12d overdue", "due in 3d", "starts in 5d (dormant)", or "no date". */
export function dateStateText(row: Task, today: string): string {
  const d = dateState(row, today);
  if (!d) return 'no date';
  const ty = row.deadline_type ?? 'DL';
  const hard = ty === 'DL' && row.deadline_kind === 'hard' ? ' · hard' : '';
  const dl = ` (${ty} ${row.deadline})`;
  switch (d.kind) {
    case 'overdue':
      return `${ty === 'SB' ? 'start-by ' : ''}${-d.n}d overdue${hard}${dl}`;
    case 'due':
      return `due ${inN(d.n)}${hard}${dl}`;
    case 'startby':
      return `start by ${inN(d.n)}${dl}`;
    case 'started':
      return `started${dl}`;
    case 'starts':
      return `starts today${dl}`;
    case 'dormant':
      return `starts ${inN(d.n)} (dormant)${dl}`;
    case 'eligible':
      return `eligible ${-d.n}d${dl}`;
  }
}

/** "judged Nd ago" / "judged today" / "never judged". */
export function stalenessText(row: Task, today: string): string {
  if (!row.triaged) return 'never judged';
  const d = -daysBetween(today, row.triaged);
  return d <= 0 ? 'judged today' : `judged ${d}d ago`;
}

export function parentOf(id: string): string | null {
  const i = id.lastIndexOf('.');
  return i < 0 ? null : id.slice(0, i);
}

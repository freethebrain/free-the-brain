// Date semantics ported from the Master widget: day arithmetic, offset dates, the DL/SO/SB state
// machine, the Eisenhower quadrant and the ISO-week Monday. Plus the Europe/Sofia clock helpers
// every file stamp must come from. Pure functions of an explicit `today` so tests are exact.

import type { DeadlineType, Score, Status } from './types.ts';

export const TIMEZONE = 'Europe/Sofia';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Bad ISO date "${iso}"`);
  return [y, m, d];
}

/** Format a UTC-anchored Date as YYYY-MM-DD. */
export function isoOf(dt: Date): string {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Whole days from `today` to `date`: negative when the date has passed. */
export function dleft(today: string, date: string): number {
  const a = parts(today);
  const b = parts(date);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

/** Months first (clamped to the last valid day of the target month), then weeks, then days. */
export function offsetDate(today: string, months: number, weeks: number, days: number): string {
  const [y, m, d] = parts(today);
  const tm = m - 1 + months;
  const ty = y + Math.floor(tm / 12);
  const tmm = ((tm % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tmm + 1, 0)).getUTCDate();
  const dt = new Date(Date.UTC(ty, tmm, Math.min(d, last)));
  dt.setUTCDate(dt.getUTCDate() + weeks * 7 + days);
  return isoOf(dt);
}

/** The Monday of `today`'s ISO week. */
export function cycleMonday(today: string): string {
  const [y, m, d] = parts(today);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return isoOf(t);
}

export type DateStateKind =
  | 'overdue'
  | 'due'
  | 'startby'
  | 'started'
  | 'starts'
  | 'dormant'
  | 'eligible';

export interface DateState {
  k: DateStateKind;
  /** Days left (negative when passed). */
  n: number;
}

export interface Dated {
  deadline: string | null;
  deadline_type: DeadlineType | null;
  status: Status;
}

/**
 * DL: overdue past its date, else due. SB: overdue past its date only while Inbox/Planned, else
 * "started"; before its date "startby". SO: never overdue — dormant before, "starts" on the day,
 * "eligible" after.
 */
export function dstate(row: Dated, today: string): DateState | null {
  if (!row.deadline) return null;
  const n = dleft(today, row.deadline);
  const ty = row.deadline_type ?? 'DL';
  if (ty === 'SO') return n < 0 ? { k: 'eligible', n } : n === 0 ? { k: 'starts', n: 0 } : { k: 'dormant', n };
  if (ty === 'SB') {
    if (n < 0) return row.status === 'Inbox' || row.status === 'Planned' ? { k: 'overdue', n } : { k: 'started', n };
    return { k: 'startby', n };
  }
  return n < 0 ? { k: 'overdue', n } : { k: 'due', n };
}

export function isOverdue(row: Dated, today: string): boolean {
  return dstate(row, today)?.k === 'overdue';
}

/** Dated today or within the next `days` days, dormant start-ons excluded. */
export function inFortnight(row: Dated, today: string, days = 14): boolean {
  const d = dstate(row, today);
  return !!d && d.n >= 0 && d.n <= days && d.k !== 'dormant';
}

/**
 * Whole days since the row's last human triage judgment, or null when it was never judged. The
 * staleness chip ("judged Nd ago" / "never judged") and the ⑤ tier both read from this; a Triaged
 * date in the future (a clock skew) counts as today, never negative.
 */
export function daysSinceTriage(row: { triaged: string | null }, today: string): number | null {
  if (!row.triaged) return null;
  return Math.max(0, -dleft(today, row.triaged));
}

export type Quadrant = 'Do now' | 'Schedule' | 'Minimize' | 'Later' | 'Unjudged';

export function quadrant(u: Score | null, i: Score | null): Quadrant {
  if (!u || !i) return 'Unjudged';
  if (u === 'H' && i === 'H') return 'Do now';
  if (i === 'H') return 'Schedule';
  if (u === 'H') return 'Minimize';
  return 'Later';
}

// ---- Europe/Sofia clock -------------------------------------------------------------------

interface ClockParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

function sofiaParts(at: Date): ClockParts {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Partial<ClockParts> = {};
  for (const p of fmt.formatToParts(at)) {
    if (p.type in { year: 1, month: 1, day: 1, hour: 1, minute: 1, second: 1 }) {
      out[p.type as keyof ClockParts] = p.value;
    }
  }
  return out as ClockParts;
}

/** The UTC offset Europe/Sofia is on at `at`, as "+03:00" / "+02:00". */
export function sofiaOffset(at: Date): string {
  const p = sofiaParts(at);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const diffMin = Math.round((asUtc - at.getTime()) / 60000);
  const sign = diffMin < 0 ? '-' : '+';
  const abs = Math.abs(diffMin);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Today's ISO date in Europe/Sofia. */
export function sofiaToday(at: Date = new Date()): string {
  const p = sofiaParts(at);
  return `${p.year}-${p.month}-${p.day}`;
}

/** A file stamp, YYYY-MM-DD-HHMM, 24-hour, Europe/Sofia — from the clock, never estimated. */
export function sofiaStamp(at: Date = new Date()): string {
  const p = sofiaParts(at);
  return `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}`;
}

/** ISO 8601 timestamp with the Sofia offset, e.g. 2026-09-07T09:20:00+03:00. */
export function sofiaTimestamp(at: Date = new Date()): string {
  const p = sofiaParts(at);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sofiaOffset(at)}`;
}

/** Turn a file stamp (YYYY-MM-DD-HHMM, Sofia wall clock) into an ISO timestamp with offset. */
export function stampToTimestamp(stamp: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/.exec(stamp);
  if (!m) throw new Error(`Bad stamp "${stamp}"`);
  // Two passes: guess the offset from the UTC reading, then re-read at the corrected instant.
  const naive = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  let offset = sofiaOffset(new Date(naive));
  const shift = (o: string) => (o.startsWith('-') ? 1 : -1) * (Number(o.slice(1, 3)) * 60 + Number(o.slice(4, 6)));
  offset = sofiaOffset(new Date(naive + shift(offset) * 60000));
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${offset}`;
}

export const STAMP_RE = /\d{4}-\d{2}-\d{2}-\d{4}/;

export function isStamp(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}-\d{4}$/.test(s);
}

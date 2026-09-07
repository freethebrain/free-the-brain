/**
 * Date and staleness text for the staging lines. The semantics — DL / SO / SB states, day
 * arithmetic, the ISO-week Monday, the Europe/Sofia clock — come from @ftb/core (ADR-2), so this
 * server derives the same states from the same code as the service and the client. What lives
 * here is only how a state reads as text: "12d overdue", "starts in 5d (dormant)", "judged 27d ago".
 */
import { daysSinceTriage, dstate } from '@ftb/core';
import type { Task } from '@ftb/core';

const inN = (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n}d`);

/** The widget's date chip as text: "12d overdue", "due in 3d", "starts in 5d (dormant)", or "no date". */
export function dateStateText(row: Task, today: string): string {
  const d = dstate(row, today);
  if (!d) return 'no date';
  const ty = row.deadline_type ?? 'DL';
  const hard = ty === 'DL' && row.deadline_kind === 'hard' ? ' · hard' : '';
  const dl = ` (${ty} ${row.deadline})`;
  switch (d.k) {
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
  const d = daysSinceTriage(row, today);
  if (d === null) return 'never judged';
  return d === 0 ? 'judged today' : `judged ${d}d ago`;
}

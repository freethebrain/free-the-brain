/**
 * The compact human-readable staging text — the widget's Triage tab as text.
 * Legend first, then one line per row inside each entry; subtask rows indented.
 */
import { dateStateText, stalenessText } from './dates.js';
import type { QueueEntry, QueueResponse, Task } from './types.js';

export const TIER_LABELS: Record<number, string> = {
  1: '① Overdue',
  2: '② Dated within 14 days',
  3: '③ Never judged',
  4: '④ Unverified scores — U/I present, never confirmed by him',
  5: '⑤ Stalest triage',
};

export function legendText(monday: string): string {
  return (
    'Sort order: ' +
    [1, 2, 3, 4, 5].map((t) => TIER_LABELS[t]).join(' · ') +
    `. Rows judged since Monday ${monday.slice(5)} are out of the queue. A branch is one entry; a partially judged branch re-enters for its unjudged rows. Ties by ID.`
  );
}

export function firstSentence(notes: string | null | undefined): string {
  if (!notes) return '';
  const firstLine = notes.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const m = firstLine.match(/^(.*?[.!?])(\s|$)/);
  return (m ? m[1] : firstLine).trim();
}

export function rowLine(row: Task, today: string, indent = 0): string {
  const ui = `${row.u ?? '–'}/${row.i ?? '–'}`;
  const parts = [
    `${row.id} (${row.task})`,
    row.category,
    ui,
    row.status + (row.status === 'Blocked' && row.blocker ? ` on ${row.blocker}` : ''),
    dateStateText(row, today),
    stalenessText(row, today),
  ];
  const note = firstSentence(row.notes);
  if (note) parts.push(note);
  return '  '.repeat(indent) + parts.join(' · ');
}

function depthWithin(entry: QueueEntry, row: Task): number {
  return Math.max(0, row.id.split('.').length - entry.top.id.split('.').length);
}

export function stagingText(q: QueueResponse, today: string): string {
  const chunkNo = q.page + 1;
  const chunks = Math.max(1, Math.ceil(q.total / Math.max(1, q.chunk)));
  const lines: string[] = [];
  lines.push(`TRIAGE STAGE — chunk ${chunkNo} of ${chunks} (${q.chunk} per chunk) — today ${today} · cycle Monday ${q.monday} · ${q.total} entries in the queue`);
  lines.push(legendText(q.monday));
  lines.push('');
  if (q.entries.length === 0) {
    lines.push(chunkNo > chunks ? 'This page is past the end of the queue.' : 'The queue is empty for this cycle.');
    return lines.join('\n');
  }
  let lastTier: number | null = null;
  for (const entry of q.entries) {
    if (entry.tier !== lastTier) {
      lastTier = entry.tier;
      lines.push(TIER_LABELS[entry.tier] ?? `Tier ${entry.tier}`);
    }
    for (const row of entry.rows) lines.push(rowLine(row, today, depthWithin(entry, row)));
  }
  lines.push('');
  lines.push('Judge what you can; untouched rows simply stay in the queue. Judgments are his — record them with triage_record and human_judgment: true only once he has made them.');
  return lines.join('\n');
}

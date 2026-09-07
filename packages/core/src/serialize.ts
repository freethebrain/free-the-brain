// Writes registry files in the archive's exact formats: the eleven-column snapshot table and the
// protocol's delta file. Byte-compatible with what is already in the Drive folder, so a parsed
// snapshot serialises back to the same table lines.

import { EMPTY, formatDeadlineCell } from './fields.ts';
import { TABLE_HEADER, TABLE_RULE } from './parse-snapshot.ts';
import type { Change, Counts, Task } from './types.ts';

/** Escape a cell for the table: pipes become "\|", newlines become a single space. */
export function cell(v: string | null | undefined): string {
  if (v === null || v === undefined) return EMPTY;
  const t = v.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
  return t === '' ? EMPTY : t;
}

export function serializeRow(t: Task): string {
  return `| ${[
    t.id,
    cell(t.task),
    cell(t.category),
    cell(t.u),
    cell(t.i),
    t.status,
    cell(t.recorded),
    cell(t.triaged),
    formatDeadlineCell(t),
    cell(t.done),
    cell(t.notes),
  ].join(' | ')} |`;
}

export function serializeTable(rows: readonly Task[]): string {
  return [TABLE_HEADER, TABLE_RULE, ...rows.map(serializeRow)].join('\n');
}

export function countRows(rows: readonly Task[]): Counts {
  let done = 0;
  let dropped = 0;
  for (const r of rows) {
    if (r.status === 'Done') done++;
    else if (r.status === 'Dropped') dropped++;
  }
  return { open: rows.length - done - dropped, done, dropped, total: rows.length };
}

export interface SnapshotDoc {
  stamp: string;
  preamble: string;
  rows: readonly Task[];
  postamble?: string;
}

/** Preamble (verbatim, given a trailing blank line), table, optional postamble. */
export function serializeSnapshot(doc: SnapshotDoc): string {
  const pre = doc.preamble.replace(/\s+$/, '');
  const parts = [pre ? `${pre}\n\n` : '', serializeTable(doc.rows), '\n'];
  if (doc.postamble && doc.postamble.trim()) parts.push(`\n${doc.postamble.replace(/\s+$/, '')}\n`);
  return parts.join('');
}

/** A minimal, protocol-shaped preamble for a compaction snapshot. */
export function defaultPreamble(args: {
  stamp: string;
  writtenBy: string;
  counts: Counts;
  nextFreeId: string;
  foldedDeltas: readonly string[];
  baseStamp: string;
  extra?: string;
}): string {
  const folded = args.foldedDeltas.length
    ? `This snapshot folds ${args.foldedDeltas.length} delta${args.foldedDeltas.length === 1 ? '' : 's'} into the \`${args.baseStamp}\` base, in stamp order: ${args.foldedDeltas.map((s) => `\`${s}\``).join(', ')}. The delta chain is now empty — the next routine sync writes \`Registry Delta — YYYY-MM-DD-HHMM.md\` against THIS file as its base.`
    : `This snapshot restates the \`${args.baseStamp}\` base with no deltas outstanding. The delta chain is empty.`;
  const c = args.counts;
  return [
    '# Task Registry',
    '',
    `Last synced: ${args.stamp} (Europe/Sofia) — COMPACTION`,
    `Written by: ${args.writtenBy}. Canonical and SOLE data surface; newest title stamp wins. Clock source: server, Europe/Sofia.`,
    '',
    `**COMPACTION.** ${folded}`,
    '',
    `**COUNT — independently verified.** ${c.open} open, ${c.done} done, ${c.dropped} dropped, **${c.total} total.** Verification: ${c.open} + ${c.done} + ${c.dropped} = ${c.open + c.done + c.dropped}, derived by counting the rows of this table. **Next free ID is ${args.nextFreeId}.**`,
    ...(args.extra ? ['', args.extra] : []),
    '',
    '---',
    '',
    `Rows open: ${c.open}. ${c.done} done, ${c.dropped} dropped, all-time. Total ${c.total}.`,
  ].join('\n');
}

// ---- Deltas ------------------------------------------------------------------------------

function flat(v: string): string {
  return v.replace(/\r?\n/g, ' ').trim();
}

/** One CHANGES line. Free-text fields go last so a stray " | " inside them still parses back. */
export function serializeChange(ch: Change): string {
  const segs: string[] = [`${ch.id} (${flat(ch.name)})`];
  if (ch.isNew) segs.push('NEW');
  if (ch.renumberedFrom) segs.push(`RENUMBERED FROM=${ch.renumberedFrom}`);
  const order = ['Task', 'Category', 'U', 'I', 'Status', 'Recorded', 'Triaged', 'Deadline', 'Done'] as const;
  for (const f of order) {
    const v = ch.sets[f];
    if (v !== undefined) segs.push(`${f}=${flat(v)}`);
  }
  if (ch.sets.Notes !== undefined) segs.push(`Notes=${flat(ch.sets.Notes)}`);
  for (const n of ch.noteAppends) segs.push(`note+=${flat(n)}`);
  return segs.join(' | ');
}

export interface DeltaDoc {
  stamp: string;
  /** Base snapshot stamp. */
  baseStamp: string;
  priorDeltas: readonly string[];
  writtenBy: string;
  changes: readonly Change[];
  /** Free prose placed between the header and CHANGES (what this delta is, in a sentence). */
  intro?: string;
  forNextCompaction?: string;
}

export function serializeDelta(doc: DeltaDoc): string {
  const prior = doc.priorDeltas.length ? doc.priorDeltas.join(', ') : '(none)';
  const out = [
    `# Registry Delta — ${doc.stamp}`,
    `Base: Task Registry — ${doc.baseStamp}.md`,
    `Prior deltas: ${prior}`,
    `Written by: ${doc.writtenBy}`,
    '',
    ...(doc.intro ? [doc.intro.trim(), ''] : []),
    '## CHANGES',
    ...doc.changes.map(serializeChange),
    '',
  ];
  if (doc.forNextCompaction && doc.forNextCompaction.trim()) {
    out.push('## FOR THE NEXT COMPACTION', doc.forNextCompaction.trim(), '');
  }
  return out.join('\n');
}

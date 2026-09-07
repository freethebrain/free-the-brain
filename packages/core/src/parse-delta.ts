// Parses a "Registry Delta — YYYY-MM-DD-HHMM.md" file into its header, CHANGES lines and the
// optional FOR THE NEXT COMPACTION section. Tolerant of the header variants seen in the archive
// ("# Registry Delta" vs bare, "## CHANGES" vs "CHANGES", prose between header and changes).

import { STAMP_RE } from './dates.ts';
import type { Change, Delta, SettableField } from './types.ts';
import { SETTABLE_FIELDS } from './types.ts';

const SEP = ' | ';
/** Fields whose values are free text and may legitimately contain " | ". */
const FREE_TEXT: readonly SettableField[] = ['Task', 'Notes'];

function isSettable(name: string): name is SettableField {
  return (SETTABLE_FIELDS as readonly string[]).includes(name);
}

/**
 * Parse one CHANGES line. The " | " separator is reliable; the task name in parentheses is not
 * (it may itself contain parentheses), so the head is everything before the first separator.
 */
export function parseChangeLine(line: string): Change {
  const segs = line.split(SEP);
  const head = segs[0]!.trim();
  const idm = /^(T-\d+(?:\.\d+)*)\s*(.*)$/s.exec(head);
  if (!idm) throw new Error(`Change line does not start with an ID: "${line}"`);
  const id = idm[1]!;
  let name = idm[2]!.trim();
  if (name.startsWith('(') && name.endsWith(')')) name = name.slice(1, -1).trim();

  const change: Change = { id, name, isNew: false, sets: {}, noteAppends: [] };
  // Where a continuation segment (free text containing " | ") should be appended.
  let cont: { kind: 'note'; idx: number } | { kind: 'set'; field: SettableField } | null = null;

  for (const raw of segs.slice(1)) {
    const seg = raw.trim();
    if (seg === '') continue;
    if (/^NEW$/i.test(seg)) {
      change.isNew = true;
      cont = null;
      continue;
    }
    const ren = /^RENUMBERED FROM\s*=\s*(T-[\d.]+)$/i.exec(seg);
    if (ren) {
      change.renumberedFrom = ren[1]!;
      cont = null;
      continue;
    }
    const note = /^note\+=(.*)$/s.exec(seg);
    if (note) {
      change.noteAppends.push(note[1]!.trim());
      cont = { kind: 'note', idx: change.noteAppends.length - 1 };
      continue;
    }
    const set = /^([A-Za-z]+)\s*=(.*)$/s.exec(seg);
    if (set && isSettable(set[1]!)) {
      const field = set[1] as SettableField;
      change.sets[field] = set[2]!.trim();
      cont = FREE_TEXT.includes(field) ? { kind: 'set', field } : null;
      continue;
    }
    // Not a recognised assignment: glue it onto the preceding free-text value if there is one.
    if (cont?.kind === 'note') {
      change.noteAppends[cont.idx] += SEP + seg;
    } else if (cont?.kind === 'set') {
      change.sets[cont.field] += SEP + seg;
    } else {
      throw new Error(`Unrecognised segment "${seg}" in change line for ${id}`);
    }
  }
  return change;
}

const CHANGES_HEAD = /^#*\s*CHANGES\s*:?\s*$/i;
const COMPACTION_HEAD = /^#*\s*FOR THE NEXT COMPACTION\s*:?\s*$/i;

export function parseDelta(text: string, opts: { filename?: string } = {}): Delta {
  const src = text.replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  const warnings: string[] = [];

  const titleLine = lines.find((l) => /Registry Delta\s*—/.test(l)) ?? '';
  const stamp = STAMP_RE.exec(opts.filename ?? '')?.[0] ?? STAMP_RE.exec(titleLine)?.[0];
  if (!stamp) throw new Error('No delta stamp found in filename or title line');

  const baseLine = lines.find((l) => /^Base:/i.test(l.trim()));
  const base = baseLine ? baseLine.replace(/^\s*Base:\s*/i, '').trim() : '';
  if (!base) warnings.push('No Base: line');
  const baseStamp = STAMP_RE.exec(base)?.[0] ?? null;

  const priorLine = lines.find((l) => /^Prior deltas:/i.test(l.trim()));
  const priorDeltas = priorLine ? (priorLine.match(/\d{4}-\d{2}-\d{2}-\d{4}/g) ?? []) : [];
  if (!priorLine) warnings.push('No Prior deltas: line');

  const changesIdx = lines.findIndex((l) => CHANGES_HEAD.test(l.trim()));
  if (changesIdx < 0) throw new Error('No CHANGES section');
  let compIdx = lines.findIndex((l, i) => i > changesIdx && COMPACTION_HEAD.test(l.trim()));
  if (compIdx < 0) compIdx = lines.length;

  const changes: Change[] = [];
  for (let i = changesIdx + 1; i < compIdx; i++) {
    const line = lines[i]!;
    const t = line.trim();
    if (t === '') continue;
    if (/^T-\d/.test(t)) {
      changes.push(parseChangeLine(t));
    } else if (t.startsWith('#')) {
      warnings.push(`Unexpected heading inside CHANGES skipped: "${t}"`);
    } else {
      warnings.push(`Non-change line inside CHANGES skipped: "${t.slice(0, 60)}"`);
    }
  }

  const delta: Delta = { stamp, base, baseStamp, priorDeltas, changes, warnings };
  if (compIdx < lines.length) {
    const body = lines.slice(compIdx + 1).join('\n').trim();
    if (body) delta.forNextCompaction = body;
  }
  return delta;
}

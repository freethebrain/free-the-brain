// Applies delta Changes to rows, field by field. A field not mentioned is unchanged, never
// cleared; NEW adds a row; note+= appends a newline-separated line; Deadline=none clears the date
// only; RENUMBERED FROM moves a row to its new ID. Pure: returns a new array, never mutates input.

import { deriveBlocker, deriveDeadlineKind, isEmptyCell, parseDate, parseDeadlineCell, parseScore, parseStatus } from './fields.ts';
import type { Change, Task } from './types.ts';

export interface ApplyOptions {
  /** Stamped onto every touched row's updated_at. */
  updatedAt: string;
}

export interface ApplyResult {
  rows: Task[];
  warnings: string[];
}

function blankRow(id: string, updatedAt: string): Task {
  return {
    id,
    task: '',
    category: '',
    u: null,
    i: null,
    status: 'Inbox',
    recorded: '',
    triaged: null,
    deadline: null,
    deadline_type: null,
    deadline_kind: null,
    done: null,
    notes: '',
    blocker: null,
    updated_at: updatedAt,
  };
}

/** Apply one change to a copy of `row` (or a blank row for NEW). */
export function applyChange(row: Task, change: Change, updatedAt: string): Task {
  const out: Task = { ...row, updated_at: updatedAt };
  const s = change.sets;
  if (s.Task !== undefined) out.task = s.Task;
  if (s.Category !== undefined) out.category = s.Category;
  if (s.U !== undefined) out.u = parseScore(s.U);
  if (s.I !== undefined) out.i = parseScore(s.I);
  if (s.Status !== undefined) out.status = parseStatus(s.Status);
  if (s.Recorded !== undefined) out.recorded = parseDate(s.Recorded) ?? out.recorded;
  if (s.Triaged !== undefined) out.triaged = parseDate(s.Triaged);
  if (s.Deadline !== undefined) {
    const dl = parseDeadlineCell(s.Deadline);
    out.deadline = dl.deadline;
    out.deadline_type = dl.deadline_type;
  }
  if (s.Done !== undefined) out.done = parseDate(s.Done);
  if (s.Notes !== undefined) out.notes = isEmptyCell(s.Notes) ? '' : s.Notes;
  for (const line of change.noteAppends) {
    if (line === '') continue;
    out.notes = out.notes ? `${out.notes}\n${line}` : line;
  }
  out.deadline_kind = deriveDeadlineKind(out.notes, out.deadline);
  out.blocker = deriveBlocker(out.status, out.notes);
  return out;
}

export function applyChanges(rows: readonly Task[], changes: readonly Change[], opts: ApplyOptions): ApplyResult {
  const byId = new Map<string, Task>(rows.map((r) => [r.id, { ...r }]));
  const order: string[] = rows.map((r) => r.id);
  const warnings: string[] = [];

  for (const ch of changes) {
    let target = byId.get(ch.id);

    if (ch.renumberedFrom && !target) {
      const old = byId.get(ch.renumberedFrom);
      if (old) {
        byId.delete(ch.renumberedFrom);
        target = { ...old, id: ch.id };
        byId.set(ch.id, target);
        order[order.indexOf(ch.renumberedFrom)] = ch.id;
      } else {
        warnings.push(`${ch.id}: RENUMBERED FROM ${ch.renumberedFrom}, but that row does not exist`);
      }
    }

    if (!target) {
      if (!ch.isNew) {
        warnings.push(`${ch.id} (${ch.name}): not in the base and not marked NEW — created anyway`);
      }
      for (const req of ['Task', 'Category', 'Status', 'Recorded'] as const) {
        if (ch.sets[req] === undefined) warnings.push(`${ch.id}: NEW row is missing ${req}`);
      }
      target = blankRow(ch.id, opts.updatedAt);
      if (!ch.sets.Task && ch.name) target.task = ch.name;
      byId.set(ch.id, target);
      order.push(ch.id);
    } else if (ch.isNew) {
      warnings.push(`${ch.id} (${ch.name}): marked NEW but already present — applied as an update`);
    }

    byId.set(ch.id, applyChange(target, ch, opts.updatedAt));
  }

  return { rows: order.map((id) => byId.get(id)!), warnings };
}

/** Rows sorted the way the registry table lists them: by ID, numerically segment by segment. */
export function sortById<T extends { id: string }>(rows: readonly T[]): T[] {
  const key = (id: string) => id.replace(/^T-/, '').split('.').map(Number);
  return [...rows].sort((a, b) => {
    const ka = key(a.id);
    const kb = key(b.id);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      const x = ka[i] ?? -1;
      const y = kb[i] ?? -1;
      if (x !== y) return x - y;
    }
    return 0;
  });
}

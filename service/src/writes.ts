// The single write path. Every mutation is expressed as a core `Change` (the same shape a delta
// line carries), applied to the row with core's applier, and recorded three ways in one D1 batch:
// the row itself, a judgment event, and a pending delta line for the archive writer.

import type { Change, Task } from '@ftb/core';
import { applyChange, sofiaStamp, sofiaTimestamp } from '@ftb/core';
import { judgmentEventStmt, META_KEYS, pendingChangeStmt, readTask, setMetaStmt, upsertTaskStmt, type WriteMeta } from './db.ts';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface RecordedWrite {
  rows: Task[];
  stamp: string;
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

/**
 * Apply and record a list of changes atomically. Changes for the same row are applied in order.
 * Throws if a non-NEW change names a row that does not exist — callers validate first.
 */
export async function recordChanges(
  db: D1Database,
  changes: readonly Change[],
  meta: Omit<WriteMeta, 'created_at'>,
  clock: Clock = systemClock,
): Promise<RecordedWrite> {
  const at = clock.now();
  const createdAt = sofiaTimestamp(at);
  const stamp = sofiaStamp(at);
  const stmts: D1PreparedStatement[] = [];
  const touched = new Map<string, Task>();

  for (const ch of changes) {
    let row = touched.get(ch.id) ?? (await readTask(db, ch.id));
    if (!row) {
      if (!ch.isNew) throw new Error(`Unknown task ${ch.id}`);
      row = blankRow(ch.id, createdAt);
      if (!ch.sets.Task && ch.name) row.task = ch.name;
    }
    const next = applyChange(row, ch, createdAt);
    touched.set(ch.id, next);
    stmts.push(upsertTaskStmt(db, next));
    stmts.push(judgmentEventStmt(db, ch.id, ch, { ...meta, created_at: createdAt }));
    stmts.push(pendingChangeStmt(db, ch, createdAt));
  }
  stmts.push(setMetaStmt(db, META_KEYS.currentStamp, stamp));
  await db.batch(stmts);
  return { rows: [...touched.values()], stamp };
}

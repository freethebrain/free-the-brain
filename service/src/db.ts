// Thin D1 access layer: rows in and out of the `tasks` table, the `meta` key/value store, the
// judgment event log and the pending-change log. Everything else in the service goes through here
// so the SQL lives in one file.

import type { Change, Task } from '@ftb/core';
import { sortById } from '@ftb/core';

export interface Env {
  DB: D1Database;
  /** Comma-separated browser origins allowed to call the API (see the CORS note in app.ts). Unset = localhost only. */
  CORS_ORIGINS?: string;
  /**
   * Optional machine bearer token (a Worker secret). When set, a request carrying
   * `Authorization: Bearer <MACHINE_TOKEN>` is accepted as the machine actor named by
   * MACHINE_ACTOR; any other bearer is 401. Unset = bearers are refused; browsers come through
   * Cloudflare Access either way. See the machine-auth note in app.ts.
   */
  MACHINE_TOKEN?: string;
  /** The actor recorded for machine-token requests that name none. Default "gt-relay". */
  MACHINE_ACTOR?: string;
}

export const META_KEYS = {
  currentStamp: 'current_stamp',
  deltaCount: 'delta_count',
  lastSnapshotStamp: 'last_snapshot_stamp',
  priorDeltas: 'prior_deltas',
} as const;

const TASK_COLUMNS = [
  'id',
  'task',
  'category',
  'u',
  'i',
  'status',
  'recorded',
  'triaged',
  'deadline',
  'deadline_type',
  'deadline_kind',
  'done',
  'notes',
  'blocker',
  'updated_at',
] as const;

export const UPSERT_TASK_SQL = `INSERT OR REPLACE INTO tasks (${TASK_COLUMNS.join(', ')}) VALUES (${TASK_COLUMNS.map(() => '?').join(', ')})`;

export function taskValues(t: Task): (string | null)[] {
  return TASK_COLUMNS.map((c) => t[c] ?? null);
}

export function upsertTaskStmt(db: D1Database, t: Task): D1PreparedStatement {
  return db.prepare(UPSERT_TASK_SQL).bind(...taskValues(t));
}

export async function readAllTasks(db: D1Database): Promise<Task[]> {
  const res = await db.prepare(`SELECT ${TASK_COLUMNS.join(', ')} FROM tasks`).all<Task>();
  return sortById(res.results);
}

export async function readTask(db: D1Database, id: string): Promise<Task | null> {
  const row = await db.prepare(`SELECT ${TASK_COLUMNS.join(', ')} FROM tasks WHERE id = ?`).bind(id).first<Task>();
  return row ?? null;
}

export async function countTasks(db: D1Database): Promise<{ open: number; done: number; dropped: number; total: number }> {
  const res = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN status NOT IN ('Done','Dropped') THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END) AS done,
         SUM(CASE WHEN status = 'Dropped' THEN 1 ELSE 0 END) AS dropped,
         COUNT(*) AS total
       FROM tasks`,
    )
    .first<{ open: number | null; done: number | null; dropped: number | null; total: number }>();
  return { open: res?.open ?? 0, done: res?.done ?? 0, dropped: res?.dropped ?? 0, total: res?.total ?? 0 };
}

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export function setMetaStmt(db: D1Database, key: string, value: string): D1PreparedStatement {
  return db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').bind(key, value);
}

export async function readPriorDeltas(db: D1Database): Promise<string[]> {
  const raw = await getMeta(db, META_KEYS.priorDeltas);
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export interface WriteMeta {
  actor: string;
  source: string;
  human_judgment: boolean;
  note?: string | null;
  created_at: string;
}

export function judgmentEventStmt(db: D1Database, taskId: string, change: Change, m: WriteMeta): D1PreparedStatement {
  return db
    .prepare('INSERT INTO judgments (task_id, actor, source, human_judgment, changes_json, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(taskId, m.actor, m.source, m.human_judgment ? 1 : 0, JSON.stringify(change), m.note ?? null, m.created_at);
}

export function pendingChangeStmt(db: D1Database, change: Change, createdAt: string): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO pending_changes (task_id, task_name, is_new, renumbered_from, sets_json, note_appends_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(change.id, change.name, change.isNew ? 1 : 0, change.renumberedFrom ?? null, JSON.stringify(change.sets), JSON.stringify(change.noteAppends), createdAt);
}

interface PendingRow {
  id: number;
  task_id: string;
  task_name: string;
  is_new: number;
  renumbered_from: string | null;
  sets_json: string;
  note_appends_json: string;
  created_at: string;
}

export async function readPendingChanges(db: D1Database): Promise<Change[]> {
  const res = await db.prepare('SELECT * FROM pending_changes ORDER BY id').all<PendingRow>();
  return res.results.map((r) => {
    const ch: Change = {
      id: r.task_id,
      name: r.task_name,
      isNew: r.is_new === 1,
      sets: JSON.parse(r.sets_json) as Change['sets'],
      noteAppends: JSON.parse(r.note_appends_json) as string[],
    };
    if (r.renumbered_from) ch.renumberedFrom = r.renumbered_from;
    return ch;
  });
}

export function clearPendingStmt(db: D1Database): D1PreparedStatement {
  return db.prepare('DELETE FROM pending_changes');
}

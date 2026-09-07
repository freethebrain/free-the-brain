-- 0001_init: the Registry Service schema.
-- tasks      — one row per registry row, columns matching the Task shape in docs/api-contract.md.
-- judgments  — append-only event log of every write (who, how, what changed).
-- pending_changes — delta lines not yet flushed to the Drive archive; the archive writer folds
--                   them into the next "Registry Delta — …" file and clears the table.
-- meta       — key/value: current_stamp, delta_count, last_snapshot_stamp, prior_deltas (JSON).

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  task          TEXT NOT NULL,
  category      TEXT NOT NULL,
  u             TEXT,
  i             TEXT,
  status        TEXT NOT NULL,
  recorded      TEXT NOT NULL,
  triaged       TEXT,
  deadline      TEXT,
  deadline_type TEXT,
  deadline_kind TEXT,
  done          TEXT,
  notes         TEXT NOT NULL DEFAULT '',
  blocker       TEXT,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS judgments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id        TEXT NOT NULL,
  actor          TEXT NOT NULL,
  source         TEXT NOT NULL,
  human_judgment INTEGER NOT NULL DEFAULT 0,
  changes_json   TEXT NOT NULL,
  note           TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS judgments_task ON judgments(task_id);

CREATE TABLE IF NOT EXISTS pending_changes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id          TEXT NOT NULL,
  task_name        TEXT NOT NULL,
  is_new           INTEGER NOT NULL DEFAULT 0,
  renumbered_from  TEXT,
  sets_json        TEXT NOT NULL,
  note_appends_json TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

// The REAL Registry Service (service/src/app.ts) running on a worker thread, so that the Apps
// Script under test — whose UrlFetchApp.fetch is synchronous — can block on it with Atomics.wait
// while Hono's async handlers run here. D1 is stood in for by node:sqlite behind the four D1
// methods the service uses (prepare/bind/first/all/batch); the SQL is the service's own.
//
// Loaded by Node directly (not through vitest), which is why this file sticks to syntax Node's
// type stripping accepts: no enums, no parameter properties, explicit .ts import specifiers.

import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import { createApp } from '../../../service/src/app.ts';

interface SeedRow {
  id: string;
  task: string;
  category: string;
  u: string | null;
  i: string | null;
  status: string;
  recorded: string;
  triaged: string | null;
  deadline: string | null;
  deadline_type: string | null;
  deadline_kind: string | null;
  done: string | null;
  notes: string;
  blocker: string | null;
  updated_at: string;
}

interface WorkerInput {
  migrationSql: string;
  seed: SeedRow[];
  stamp: string;
  env: Record<string, string>;
  nowIso: string;
}

const input = workerData as WorkerInput;

// ---- D1 over node:sqlite ---------------------------------------------------------------------

type Param = string | number | null;

class D1Stmt {
  private readonly db: DatabaseSync;
  private readonly sql: string;
  private readonly params: Param[];
  constructor(db: DatabaseSync, sql: string, params: Param[] = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params: Param[]): D1Stmt {
    return new D1Stmt(this.db, this.sql, params);
  }
  async first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as T | undefined;
    return row ?? null;
  }
  async all<T>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
    const results = this.db.prepare(this.sql).all(...this.params) as T[];
    return { results, success: true, meta: {} };
  }
  async run(): Promise<{ success: true; meta: Record<string, unknown> }> {
    this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: {} };
  }
  runSync(): void {
    this.db.prepare(this.sql).run(...this.params);
  }
}

class FakeD1 {
  readonly db: DatabaseSync;
  constructor() {
    this.db = new DatabaseSync(':memory:');
  }
  prepare(sql: string): D1Stmt {
    return new D1Stmt(this.db, sql);
  }
  async batch(stmts: D1Stmt[]): Promise<{ success: true }[]> {
    this.db.exec('BEGIN');
    try {
      for (const s of stmts) s.runSync();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return stmts.map(() => ({ success: true }));
  }
  exec(sql: string): void {
    this.db.exec(sql);
  }
}

const TASK_COLUMNS = ['id', 'task', 'category', 'u', 'i', 'status', 'recorded', 'triaged', 'deadline', 'deadline_type', 'deadline_kind', 'done', 'notes', 'blocker', 'updated_at'] as const;

function seed(d1: FakeD1): void {
  d1.exec('DELETE FROM tasks; DELETE FROM judgments; DELETE FROM pending_changes; DELETE FROM meta;');
  const ins = d1.db.prepare(`INSERT OR REPLACE INTO tasks (${TASK_COLUMNS.join(', ')}) VALUES (${TASK_COLUMNS.map(() => '?').join(', ')})`);
  for (const r of input.seed) ins.run(...TASK_COLUMNS.map((c) => r[c] ?? null));
  const meta = d1.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  meta.run('current_stamp', input.stamp);
  meta.run('last_snapshot_stamp', input.stamp);
  meta.run('prior_deltas', '[]');
  meta.run('delta_count', '0');
}

const d1 = new FakeD1();
d1.exec(input.migrationSql);
seed(d1);

const clockAt = new Date(input.nowIso);
const app = createApp({ clock: { now: () => clockAt } });
const env = { DB: d1 as unknown as D1Database, ...input.env };

// ---- the wire: postMessage in, SharedArrayBuffer out ------------------------------------------

interface HttpMsg {
  kind: 'http';
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  sab: SharedArrayBuffer;
}
interface SqlMsg {
  kind: 'sql';
  sql: string;
  params: Param[];
  sab: SharedArrayBuffer;
}
interface ResetMsg {
  kind: 'reset';
  sab: SharedArrayBuffer;
}
type Msg = HttpMsg | SqlMsg | ResetMsg;

function reply(sab: SharedArrayBuffer, payload: unknown): void {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const header = new Int32Array(sab, 0, 2);
  const data = new Uint8Array(sab, 8);
  if (bytes.length > data.length) throw new Error(`reply of ${bytes.length} bytes exceeds the ${data.length}-byte buffer`);
  data.set(bytes);
  header[1] = bytes.length;
  Atomics.store(header, 0, 1);
  Atomics.notify(header, 0);
}

parentPort!.on('message', async (msg: Msg) => {
  try {
    if (msg.kind === 'http') {
      const init: RequestInit = { method: msg.method, headers: msg.headers };
      if (msg.body !== null && msg.method !== 'GET' && msg.method !== 'HEAD') init.body = msg.body;
      const res = await app.fetch(new Request(msg.url, init), env);
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      reply(msg.sab, { status: res.status, headers, text: await res.text() });
    } else if (msg.kind === 'sql') {
      const rows = d1.db.prepare(msg.sql).all(...msg.params);
      reply(msg.sab, { rows });
    } else if (msg.kind === 'reset') {
      seed(d1);
      reply(msg.sab, { ok: true });
    }
  } catch (e) {
    reply(msg.sab, { error: String((e as Error)?.stack ?? e) });
  }
});

parentPort!.postMessage({ kind: 'ready' });

// Seeds the database from the Drive archive: newest snapshot + later deltas, resolved by core.
// Two consumers — the Node script (scripts/import.ts) renders the statements as SQL text for
// `wrangler d1 execute`; tests and any in-worker import run them as prepared statements.

import type { RegistryFile, ResolvedRegistry } from '@ftb/core';
import { resolveRegistry, sofiaTimestamp } from '@ftb/core';
import { META_KEYS, taskValues, UPSERT_TASK_SQL } from './db.ts';

export interface Statement {
  sql: string;
  params: (string | number | null)[];
}

export interface ImportPlan {
  registry: ResolvedRegistry;
  statements: Statement[];
}

export function planImport(files: readonly RegistryFile[], at: Date = new Date()): ImportPlan {
  const registry = resolveRegistry(files);
  const now = sofiaTimestamp(at);
  const statements: Statement[] = [
    { sql: 'DELETE FROM pending_changes', params: [] },
    { sql: 'DELETE FROM tasks', params: [] },
  ];
  for (const row of registry.rows) statements.push({ sql: UPSERT_TASK_SQL, params: taskValues(row) });
  const deltaStamps = registry.deltas.map((d) => d.stamp);
  const meta: [string, string][] = [
    [META_KEYS.lastSnapshotStamp, registry.baseStamp],
    [META_KEYS.priorDeltas, JSON.stringify(deltaStamps)],
    [META_KEYS.deltaCount, String(deltaStamps.length)],
    [META_KEYS.currentStamp, registry.stamp],
  ];
  for (const [k, v] of meta) statements.push({ sql: 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', params: [k, v] });
  statements.push({
    sql: 'INSERT INTO judgments (task_id, actor, source, human_judgment, changes_json, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    params: [
      '*',
      'import',
      'import',
      0,
      JSON.stringify({ rows: registry.rows.length, base: registry.baseStamp, deltas: deltaStamps, warnings: registry.warnings }),
      `Imported ${registry.rows.length} rows from snapshot ${registry.baseStamp} + ${deltaStamps.length} deltas`,
      now,
    ],
  });
  return { registry, statements };
}

export async function runImport(db: D1Database, files: readonly RegistryFile[], at: Date = new Date()): Promise<ImportPlan> {
  const plan = planImport(files, at);
  await db.batch(plan.statements.map((s) => db.prepare(s.sql).bind(...s.params)));
  return plan;
}

/** Render a statement as literal SQL (single quotes doubled) for `wrangler d1 execute --file`. */
export function toSqlText(stmt: Statement): string {
  let k = 0;
  const sql = stmt.sql.replace(/\?/g, () => {
    const v = stmt.params[k++];
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    return `'${v.replace(/'/g, "''")}'`;
  });
  return `${sql};`;
}

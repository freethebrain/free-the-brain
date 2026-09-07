// Resolves the current registry from a folder listing: newest snapshot by title stamp, then every
// delta stamped later than it, applied oldest first. This is the protocol's READ procedure, so
// the import script, the service and the tests all read the archive the same way.

import { applyChanges } from './apply-delta.ts';
import { stampToTimestamp } from './dates.ts';
import { parseDelta } from './parse-delta.ts';
import { parseSnapshot, stampFromTitle } from './parse-snapshot.ts';
import type { Delta, Snapshot, Task } from './types.ts';

export interface RegistryFile {
  name: string;
  content: string;
}

export const SNAPSHOT_TITLE = /^Task Registry — \d{4}-\d{2}-\d{2}-\d{4}\.md$/;
export const DELTA_TITLE = /^Registry Delta — \d{4}-\d{2}-\d{2}-\d{4}\.md$/;

export function isSnapshotName(name: string): boolean {
  return SNAPSHOT_TITLE.test(name);
}

export function isDeltaName(name: string): boolean {
  return DELTA_TITLE.test(name);
}

export interface ResolvedRegistry {
  /** The base snapshot's stamp. */
  baseStamp: string;
  /** The stamp of the newest file applied (base or last delta). */
  stamp: string;
  snapshot: Snapshot;
  deltas: Delta[];
  rows: Task[];
  warnings: string[];
}

export function resolveRegistry(files: readonly RegistryFile[]): ResolvedRegistry {
  const snaps = files.filter((f) => isSnapshotName(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  const newest = snaps[snaps.length - 1];
  if (!newest) throw new Error('No snapshot ("Task Registry — YYYY-MM-DD-HHMM.md") found');
  const snapshot = parseSnapshot(newest.content, { filename: newest.name });
  const baseStamp = snapshot.stamp;

  const deltas = files
    .filter((f) => isDeltaName(f.name) && stampFromTitle(f.name)! > baseStamp)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => parseDelta(f.content, { filename: f.name }));

  const warnings: string[] = [];
  let rows = snapshot.rows;
  let stamp = baseStamp;
  for (const d of deltas) {
    if (d.baseStamp && d.baseStamp !== baseStamp) {
      warnings.push(`Delta ${d.stamp} names base ${d.baseStamp}, but the newest snapshot is ${baseStamp}`);
    }
    for (const w of d.warnings) warnings.push(`Delta ${d.stamp}: ${w}`);
    const res = applyChanges(rows, d.changes, { updatedAt: stampToTimestamp(d.stamp) });
    for (const w of res.warnings) warnings.push(`Delta ${d.stamp}: ${w}`);
    rows = res.rows;
    stamp = d.stamp;
  }
  return { baseStamp, stamp, snapshot, deltas, rows, warnings };
}

// The Drive archive writer. Builds the next "Registry Delta — …" from the pending change log, or a
// full "Task Registry — …" snapshot on compaction, byte-compatible with the protocol. It returns
// {filename, content}; putting the file into the Drive folder is a separate step (see README).

import type { Change, Task } from '@ftb/core';
import { countRows, defaultPreamble, nextFreeId, serializeDelta, serializeSnapshot, sofiaStamp } from '@ftb/core';
import { clearPendingStmt, countTasks, getMeta, META_KEYS, readAllTasks, readPendingChanges, readPriorDeltas, setMetaStmt } from './db.ts';
import type { Clock } from './writes.ts';
import { systemClock } from './writes.ts';

export const WRITTEN_BY = 'Free the Brain service';
export const COMPACT_EVERY = 5;

export interface ArchiveFile {
  filename: string;
  content: string;
  stamp: string;
  kind: 'delta' | 'snapshot';
}

export interface PendingView extends ArchiveFile {
  changes: number;
  delta_count: number;
  compact_due: boolean;
}

function compactionNote(rows: readonly Task[], deltaCount: number): string {
  const c = countRows(rows);
  return `Counts after this delta: ${c.open} open, ${c.done} done, ${c.dropped} dropped, ${c.total} total. Next free top-level ID is ${nextFreeId(rows)}. ${deltaCount} delta${deltaCount === 1 ? '' : 's'} on the current base${deltaCount >= COMPACT_EVERY ? ' — compaction threshold met' : ''}.`;
}

async function baseStamp(db: D1Database): Promise<string> {
  const s = await getMeta(db, META_KEYS.lastSnapshotStamp);
  if (!s) throw new Error('meta.last_snapshot_stamp is unset — import the registry first');
  return s;
}

/** The delta the writer would emit right now, without touching state. */
export async function buildPendingDelta(db: D1Database, clock: Clock = systemClock, stampOverride?: string): Promise<PendingView> {
  const changes = await readPendingChanges(db);
  const prior = await readPriorDeltas(db);
  const base = await baseStamp(db);
  const rows = await readAllTasks(db);
  const stamp = stampOverride ?? sofiaStamp(clock.now());
  const deltaCount = Number((await getMeta(db, META_KEYS.deltaCount)) ?? '0');
  const content = serializeDelta({
    stamp,
    baseStamp: base,
    priorDeltas: prior,
    writtenBy: `${WRITTEN_BY}. Clock source: server, Europe/Sofia.`,
    intro: `${changes.length} change line${changes.length === 1 ? '' : 's'} recorded through the service since the previous archive write.`,
    changes,
    forNextCompaction: compactionNote(rows, deltaCount + 1),
  });
  return {
    filename: `Registry Delta — ${stamp}.md`,
    content,
    stamp,
    kind: 'delta',
    changes: changes.length,
    delta_count: deltaCount,
    compact_due: deltaCount >= COMPACT_EVERY,
  };
}

/** A full snapshot of the current rows, with an independently verified COUNT line. */
export async function buildSnapshot(db: D1Database, clock: Clock = systemClock, stampOverride?: string): Promise<ArchiveFile> {
  const rows = await readAllTasks(db);
  const stamp = stampOverride ?? sofiaStamp(clock.now());
  const counted = countRows(rows);
  const sqlCount = await countTasks(db);
  const agree = counted.open === sqlCount.open && counted.done === sqlCount.done && counted.dropped === sqlCount.dropped && counted.total === sqlCount.total;
  if (!agree) throw new Error(`Row count mismatch: table ${JSON.stringify(counted)} vs SQL ${JSON.stringify(sqlCount)}`);
  const prior = await readPriorDeltas(db);
  const base = await baseStamp(db);
  const pending = await readPendingChanges(db);
  const extra = [
    `**VERIFICATION.** The count above was derived twice — once by counting the serialised rows and once by SQL over the tasks table — and the two agree. Compacted by ${WRITTEN_BY}.`,
    pending.length ? `${pending.length} pending change line${pending.length === 1 ? '' : 's'} not yet written as a delta are folded into this snapshot directly.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const preamble = defaultPreamble({ stamp, writtenBy: WRITTEN_BY, counts: counted, nextFreeId: nextFreeId(rows), foldedDeltas: prior, baseStamp: base, extra });
  return { filename: `Task Registry — ${stamp}.md`, content: serializeSnapshot({ stamp, preamble, rows }), stamp, kind: 'snapshot' };
}

/**
 * Emit the pending delta, or a snapshot when `compact` is set, and advance the archive state:
 * a delta appends its stamp to prior_deltas and bumps delta_count; a snapshot resets both and
 * becomes the new base. Pending changes are cleared either way.
 */
export async function flush(db: D1Database, opts: { compact?: boolean } = {}, clock: Clock = systemClock): Promise<ArchiveFile> {
  const stamp = sofiaStamp(clock.now());
  const prior = await readPriorDeltas(db);
  const pendingCount = (await readPendingChanges(db)).length;
  if (!opts.compact && pendingCount === 0) throw new NothingPending('No pending changes to write');
  const lastArchive = [await baseStamp(db), ...prior].sort().pop()!;
  if (lastArchive >= stamp) {
    // Never reuse a stamp: two archive files inside one minute would collide on the filename.
    throw new StampCollision(`Stamp ${stamp} is not newer than the last archive file ${lastArchive}; wait a minute`);
  }
  if (opts.compact) {
    const file = await buildSnapshot(db, clock, stamp);
    await db.batch([
      clearPendingStmt(db),
      setMetaStmt(db, META_KEYS.lastSnapshotStamp, stamp),
      setMetaStmt(db, META_KEYS.priorDeltas, '[]'),
      setMetaStmt(db, META_KEYS.deltaCount, '0'),
      setMetaStmt(db, META_KEYS.currentStamp, stamp),
    ]);
    return file;
  }
  const view = await buildPendingDelta(db, clock, stamp);
  await db.batch([
    clearPendingStmt(db),
    setMetaStmt(db, META_KEYS.priorDeltas, JSON.stringify([...prior, stamp])),
    setMetaStmt(db, META_KEYS.deltaCount, String(view.delta_count + 1)),
    setMetaStmt(db, META_KEYS.currentStamp, stamp),
  ]);
  return { filename: view.filename, content: view.content, stamp, kind: 'delta' };
}

export class NothingPending extends Error {}
export class StampCollision extends Error {}

export type { Change };

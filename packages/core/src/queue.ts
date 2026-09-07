// The five-tier triage queue and the deadline radar, ported from the Master widget so every
// surface derives the same order from the same rows. Pure functions of (rows, today).

import { cycleMonday, dleft, dstate, isOverdue } from './dates.ts';
import type { Task } from './types.ts';
import { CLOSED_STATUSES } from './types.ts';

export function isOpen(t: Task): boolean {
  return !CLOSED_STATUSES.includes(t.status);
}

export function parentOf(id: string): string | null {
  const i = id.lastIndexOf('.');
  return i < 0 ? null : id.slice(0, i);
}

export function depthOf(id: string): number {
  return id.split('.').length - 1;
}

export type Tier = 1 | 2 | 3 | 4 | 5;

/** [tier, secondary key (days for 1–2, a date string for 3–5), id]. */
export type QueueKey = [Tier, number | string, string];

export const TIER_NAMES: Record<Tier, string> = {
  1: '① Overdue',
  2: '② Dated within 14 days',
  3: '③ Never judged',
  4: '④ Unverified scores — U/I present, never confirmed',
  5: '⑤ Stalest triage',
};

export function rowTier(r: Task, today: string, days = 14): QueueKey {
  const d = dstate(r, today);
  if (d && d.k === 'overdue') return [1, d.n, r.id];
  if (d && d.n <= days && d.k !== 'dormant' && d.k !== 'started') return [2, d.n, r.id];
  if (!r.u && !r.i) return [3, r.recorded, r.id];
  if (!r.triaged) return [4, r.recorded, r.id];
  return [5, r.triaged, r.id];
}

export interface QueueEntry {
  top: Task;
  /** The top row followed by its open descendants, depth-first in ID order. */
  rows: Task[];
  tier: Tier;
  key: QueueKey;
}

function cmpKey(a: QueueKey, b: QueueKey): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] < b[1]) return -1;
  if (a[1] > b[1]) return 1;
  return a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0;
}

/**
 * Rows triaged on or after this week's Monday are out. A branch — a top-level open row plus its
 * open descendants (an orphan whose parent is closed or excluded counts as top-level) — is one
 * entry, and its tier is the best any of its rows reaches. Ties by ID.
 */
export function buildQueue(rows: readonly Task[], today: string, days = 14): QueueEntry[] {
  const monday = cycleMonday(today);
  const live = rows.filter((r) => isOpen(r) && !(r.triaged && r.triaged >= monday));
  const set = new Set(live.map((r) => r.id));
  const tops = live.filter((r) => {
    const p = parentOf(r.id);
    return !p || !set.has(p);
  });
  const byId = (a: Task, b: Task) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const entries = tops.map((t) => {
    const branch: Task[] = [t];
    const grab = (p: Task) => {
      live
        .filter((r) => parentOf(r.id) === p.id)
        .sort(byId)
        .forEach((c) => {
          branch.push(c);
          grab(c);
        });
    };
    grab(t);
    let best: QueueKey | null = null;
    for (const r of branch) {
      const k = rowTier(r, today, days);
      if (!best || k[0] < best[0] || (k[0] === best[0] && k[1] < best[1])) best = k;
    }
    return { top: t, rows: branch, tier: best![0], key: best! };
  });
  entries.sort((a, b) => cmpKey(a.key, b.key) || (a.top.id < b.top.id ? -1 : 1));
  return entries;
}

export function chunkQueue(entries: readonly QueueEntry[], chunk: number, page: number): QueueEntry[] {
  const size = Math.max(1, chunk);
  const start = Math.max(0, page) * size;
  return entries.slice(start, start + size);
}

export interface Radar {
  overdue: Task[];
  today_tomorrow: Task[];
  fortnight: Task[];
  passed_not_overdue: Task[];
  further: Task[];
  dormant: Task[];
  undated: Task[];
}

/** The Radar sections from the API contract, over open rows, each sorted by date then ID. */
export function buildRadar(rows: readonly Task[], today: string, days = 14): Radar {
  const open = rows.filter(isOpen);
  const byDate = (a: Task, b: Task) => {
    const x = a.deadline ? dleft(today, a.deadline) : 9999;
    const y = b.deadline ? dleft(today, b.deadline) : 9999;
    return x - y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  };
  const pick = (f: (t: Task) => boolean) => open.filter(f).sort(byDate);
  const st = (t: Task) => dstate(t, today);
  return {
    overdue: pick((t) => isOverdue(t, today)),
    today_tomorrow: pick((t) => {
      const d = st(t);
      return !!d && d.n >= 0 && d.n <= 1 && d.k !== 'dormant';
    }),
    fortnight: pick((t) => {
      const d = st(t);
      return !!d && d.n > 1 && d.n <= days && d.k !== 'dormant';
    }),
    passed_not_overdue: pick((t) => {
      const d = st(t);
      return !!d && (d.k === 'eligible' || d.k === 'started');
    }),
    further: pick((t) => {
      const d = st(t);
      return !!d && d.n > days;
    }),
    dormant: pick((t) => {
      const d = st(t);
      return !!d && d.k === 'dormant' && d.n <= days;
    }),
    undated: pick((t) => !t.deadline),
  };
}

/** Next free top-level ID: one past the highest number ever used. Gaps are never reused. */
export function nextFreeId(rows: readonly { id: string }[]): string {
  let max = 0;
  for (const r of rows) {
    const n = Number(r.id.replace(/^T-/, '').split('.')[0]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `T-${String(max + 1).padStart(3, '0')}`;
}

/** The three IDs a triage surface reserves for capture rows. */
export function reservedIds(rows: readonly { id: string }[], count = 3): string[] {
  const first = Number(nextFreeId(rows).slice(2));
  return Array.from({ length: count }, (_, k) => `T-${String(first + k).padStart(3, '0')}`);
}

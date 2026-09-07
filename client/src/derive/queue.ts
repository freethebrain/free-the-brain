/* Triage: derive the queue fresh from REGISTRY state (pending judgments do not reshuffle it).
   Rows with a Triaged date on or after the current ISO week's Monday are excluded. A branch is one
   entry — a top-level row plus its open descendants — and an entry's tier is the best tier any of its
   rows reaches, so a subtask's own overdue date pulls the branch up. Tiers: ① overdue, most overdue
   first · ② dated within 14 days, soonest first (eligible SO included, dormant SO excluded) · ③ never
   judged, oldest Recorded first · ④ scores present but never Triaged, oldest Recorded first ·
   ⑤ stalest Triaged first. Ties by ID. */
import { REG } from "../data/registry";
import type { Row } from "../data/types";
import { cycleMonday, dstate } from "./dates";
import { parentOf } from "./tree";

export type TierKey = [number, number | string, string];

export interface QueueEntry {
  top: Row;
  rows: Row[];
  key: TierKey;
}

export function rowTier(r: Row, today: string = REG.TODAY): TierKey {
  const e = { u: r.u, i: r.i, st: r.st, dl: r.dl, ty: r.ty || (r.dl ? "DL" : "") } as const;
  const d = dstate(e, today);
  if (d && d.k === "overdue") return [1, d.n, r.id];
  if (d && d.n <= 14 && d.k !== "dormant" && d.k !== "started") return [2, d.n, r.id];
  if (!r.u && !r.i) return [3, r.rec, r.id];
  if (!r.tri) return [4, r.rec, r.id];
  return [5, r.tri, r.id];
}

export function buildQueue(rows: Row[] = REG.ROWS, today: string = REG.TODAY): QueueEntry[] {
  const MONDAY = cycleMonday(today);
  const live = rows.filter((r) => !(r.tri && r.tri >= MONDAY));
  const set = new Set(live.map((r) => r.id));
  const tops = live.filter((r) => !parentOf(r.id) || !set.has(parentOf(r.id) as string));
  const entries = tops.map((t) => {
    const rows: Row[] = [t];
    const grab = (p: Row): void =>
      live
        .filter((r) => parentOf(r.id) === p.id)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .forEach((c) => {
          rows.push(c);
          grab(c);
        });
    grab(t);
    let best: TierKey | null = null;
    rows.forEach((r) => {
      const k = rowTier(r, today);
      if (!best || k[0] < best[0] || (k[0] === best[0] && k[1] < best[1])) best = k;
    });
    return { top: t, rows: rows, key: best as unknown as TierKey };
  });
  entries.sort(
    (a, b) =>
      a.key[0] - b.key[0] ||
      (a.key[1] < b.key[1] ? -1 : a.key[1] > b.key[1] ? 1 : 0) ||
      (a.top.id < b.top.id ? -1 : 1),
  );
  return entries;
}

/** Branches (top-level rows) that carry a Triaged date within the cycle. */
export function judgedThisCycle(rows: Row[] = REG.ROWS, today: string = REG.TODAY): number {
  const MONDAY = cycleMonday(today);
  const s = new Set<string>();
  rows.forEach((r) => {
    if (r.tri && r.tri >= MONDAY) {
      let t = r.id,
        p: string | null;
      while ((p = parentOf(t)) && rows.some((x) => x.id === p)) t = p;
      s.add(t);
    }
  });
  return s.size;
}

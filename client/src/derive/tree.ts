/* Branch helpers: parents, folding, and the Portfolio's branch-first sort
   (date proximity, undated last, ties by ID; children after their parent, by ID). */
import { REG } from "../data/registry";
import type { Row } from "../data/types";
import { dleft } from "./dates";
import { eff } from "./effective";
import { view } from "../state";

export function parentOf(id: string): string | null {
  const i = id.lastIndexOf(".");
  return i < 0 ? null : id.slice(0, i);
}
export function hasKids(id: string, rows: Row[] = REG.ROWS): boolean {
  return rows.some((r) => parentOf(r.id) === id);
}
export function match(r: Row, q: string): boolean {
  return (
    !q ||
    (r.id + " " + r.task + " " + r.cat + " " + r.st + " " + (r.note || "") + " " + (r.blk || ""))
      .toLowerCase()
      .includes(q)
  );
}

/** Drop subtasks when Hide subtasks is on, and rows under a folded branch. */
export function visibleTree(rs: Row[]): Row[] {
  const out: Row[] = [];
  rs.forEach((r) => {
    if (view.hideSubs && r.d > 0) return;
    let p = parentOf(r.id);
    while (p) {
      if (view.branchClosed[p] && rs.some((x) => x.id === p)) {
        return;
      }
      p = parentOf(p);
    }
    out.push(r);
  });
  return out;
}

export function branchSort(rs: Row[], today: string = REG.TODAY): Row[] {
  const set = new Set(rs.map((r) => r.id));
  const tops = rs.filter((r) => !parentOf(r.id) || !set.has(parentOf(r.id) as string));
  const key = (r: Row): [number, string] => {
    const e = eff(r);
    return [e.dl ? dleft(e.dl, today) : 9999, r.id];
  };
  tops.sort((a, b) => {
    const ka = key(a),
      kb = key(b);
    return ka[0] - kb[0] || (ka[1] < kb[1] ? -1 : 1);
  });
  const out: Row[] = [];
  const attach = (t: Row): void => {
    out.push(t);
    rs.filter((r) => parentOf(r.id) === t.id)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .forEach(attach);
  };
  tops.forEach(attach);
  return out;
}

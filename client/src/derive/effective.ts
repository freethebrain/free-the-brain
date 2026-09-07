/* effective view of a row = registry state with this session's pending judgment laid over it */
import { STATUS } from "../constants";
import type { DateKind, DateType, Row, Score, Status } from "../data/types";
import { P, dlValue } from "../editor/pending";

export interface Eff {
  u: Score | null;
  i: Score | null;
  st: Status;
  dl: string;
  ty: DateType | "";
  closing: boolean;
  kind?: DateKind | "";
}

export function eff(r: Row): Eff {
  const s = P[r.id];
  const e: Eff = { u: r.u, i: r.i, st: r.st, dl: r.dl, ty: r.ty || (r.dl ? "DL" : ""), closing: false };
  if (!s) return e;
  if (s.u) e.u = s.u;
  if (s.i) e.i = s.i;
  if (s.st) {
    e.st = STATUS[s.st] as Status;
    if (s.st >= 4) e.closing = true;
  }
  if (s.dm === 1) {
    e.dl = dlValue(s);
    e.ty = s.ty;
  }
  if (s.dm === 2) {
    e.dl = "";
    e.ty = "";
  }
  return e;
}

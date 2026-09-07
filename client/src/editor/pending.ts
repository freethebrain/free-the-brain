/* The one pending store. Every judgment made anywhere — any tab, any row — lands here, keyed by row id,
   and is laid over the displayed state until Send. Judgments are pending until sent, individually
   undoable by tapping the same control again, and clearable in bulk. */
import type { DateType, Score } from "../data/types";
import { offsetDate } from "../derive/dates";

export interface Pending {
  u: Score | null;
  i: Score | null;
  /** index into STATUS: 0 none, 1 Planned, 2 Active, 3 Blocked, 4 Done, 5 Dropped */
  st: number;
  /** date mode: 0 keep, 1 move, 2 no date */
  dm: number;
  m: number;
  w: number;
  d: number;
  /** absolute date from the picker, overrides the offsets */
  abs: string | null;
  ty: DateType;
  /** clarification note */
  nt: string;
}

/** pending judgments by id */
export const P: Record<string, Pending> = {};

export function blank(): Pending {
  return { u: null, i: null, st: 0, dm: 0, m: 0, w: 0, d: 0, abs: null, ty: "DL", nt: "" };
}
export function pend(id: string): Pending {
  return P[id] || (P[id] = blank());
}
export function judgedId(id: string): boolean {
  const s = P[id];
  return !!(s && (s.u || s.i || s.st > 0 || s.dm > 0 || s.abs || (s.nt && s.nt.trim())));
}
export function dlValue(s: Pending): string {
  return s.abs || offsetDate(s.m, s.w, s.d);
}
export function pendingCount(): number {
  return Object.keys(P).filter(judgedId).length;
}
export function clearPending(): void {
  Object.keys(P).forEach((k) => delete P[k]);
}

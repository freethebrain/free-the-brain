/* The injection block, made mutable. The template baked STAMP / TODAY / RESERVED / NEXTNUM / ROWS / DONE
   in at staging time; the app loads them at start-up (and again after a successful send) and every
   derive/render module reads them from here. */
import type { DoneRow, Injection, Row } from "./types";

export const REG: Injection = {
  STAMP: "YYYY-MM-DD-HHMM",
  TODAY: "1970-01-01",
  RESERVED: [],
  NEXTNUM: 0,
  ROWS: [],
  DONE: [],
};

/** Replace the loaded registry in place, so every module holding `REG` sees the new state. */
export function setRegistry(next: Injection): void {
  REG.STAMP = next.STAMP;
  REG.TODAY = next.TODAY;
  REG.RESERVED = next.RESERVED.slice();
  REG.NEXTNUM = next.NEXTNUM;
  REG.ROWS = next.ROWS.slice();
  REG.DONE = next.DONE.slice();
}

export function findRow(id: string): Row | undefined {
  return REG.ROWS.find((x) => x.id === id);
}
export function findDone(id: string): DoneRow | undefined {
  return REG.DONE.find((x) => x.id === id);
}

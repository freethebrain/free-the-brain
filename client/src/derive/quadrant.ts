/* Eisenhower quadrant, derived from U/I. Unscored rows are "q0" — Unjudged — a design position:
   they belong to the triage queue, and pretending they have a quadrant would be fabrication. */
import type { Score } from "../data/types";

export type QuadKey = "q0" | "q1" | "q2" | "q3" | "q4";

export function quadK(e: { u: Score | null | undefined; i: Score | null | undefined }): QuadKey {
  if (!e.u || !e.i) return "q0";
  if (e.u === "H" && e.i === "H") return "q1";
  if (e.i === "H") return "q2";
  if (e.u === "H") return "q3";
  return "q4";
}

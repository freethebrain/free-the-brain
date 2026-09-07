/* Date semantics, ported verbatim from the template and typed.
   Every function takes `today` explicitly (defaulting to the loaded registry's TODAY) so the
   semantics are testable without a DOM: offsets count from the staging day, months first,
   clamped to month end, then weeks, then days. */
import { REG } from "../data/registry";
import type { DateType, Status } from "../data/types";

export function iso(dt: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return dt.getFullYear() + "-" + p(dt.getMonth() + 1) + "-" + p(dt.getDate());
}

export function offsetDate(m: number, w: number, d: number, today: string = REG.TODAY): string {
  const b = today.split("-").map(Number);
  const tm = b[1] - 1 + m,
    ty = b[0] + Math.floor(tm / 12),
    tmm = ((tm % 12) + 12) % 12;
  const last = new Date(ty, tmm + 1, 0).getDate();
  const dt = new Date(ty, tmm, Math.min(b[2], last));
  dt.setDate(dt.getDate() + w * 7 + d);
  return iso(dt);
}

/** Days from today to `dl` — negative when past. */
export function dleft(dl: string, today: string = REG.TODAY): number {
  const a = today.split("-"),
    b = dl.split("-");
  return Math.round(
    (Date.UTC(+b[0], +b[1] - 1, +b[2]) - Date.UTC(+a[0], +a[1] - 1, +a[2])) / 86400000,
  );
}

/** Monday of the current ISO week (the triage cycle), derived from the calendar, never stored. */
export function cycleMonday(today: string = REG.TODAY): string {
  const a = today.split("-").map(Number);
  const t = new Date(Date.UTC(a[0], a[1] - 1, a[2]));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

/** ISO-week Monday of any date (used by the Done tab's grouping). */
export function weekOf(d: string): string {
  const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day);
  return t.toISOString().slice(0, 10);
}

/** The minimum a date-state check needs to know about a row. */
export interface Dated {
  dl: string;
  ty: DateType | "";
  st: Status | string;
}

export type DateStateKind = "eligible" | "starts" | "dormant" | "overdue" | "started" | "startby" | "due";
export interface DateState {
  k: DateStateKind;
  n: number;
}

/* type-aware date state: DL overdue past date; SB overdue only while Inbox/Planned; SO never overdue, dormant before its date */
export function dstate(e: Dated, today: string = REG.TODAY): DateState | null {
  if (!e.dl) return null;
  const n = dleft(e.dl, today),
    ty = e.ty || "DL";
  if (ty === "SO") return n < 0 ? { k: "eligible", n: n } : n === 0 ? { k: "starts", n: 0 } : { k: "dormant", n: n };
  if (ty === "SB") {
    if (n < 0) return e.st === "Inbox" || e.st === "Planned" ? { k: "overdue", n: n } : { k: "started", n: n };
    return { k: "startby", n: n };
  }
  return n < 0 ? { k: "overdue", n: n } : { k: "due", n: n };
}
export function isOverdue(e: Dated, today: string = REG.TODAY): boolean {
  const d = dstate(e, today);
  return !!(d && d.k === "overdue");
}
export function inFortnight(e: Dated, today: string = REG.TODAY): boolean {
  const d = dstate(e, today);
  return !!(d && d.n >= 0 && d.n <= 14 && d.k !== "dormant");
}

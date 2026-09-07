/* Deadline reminders — local notifications for hard DL deadlines, 3 days and 1 day before, at 09:00
   Europe/Sofia, matching the calendar reminder convention (1h/3h/1d/3d) at the two spans a phone
   notification is useful for.

   The planner is a pure function of (rows, today[, now]) so it is testable without a device; the
   scheduler is cancel-then-schedule so re-running it after every registry load is idempotent — the
   phone always carries exactly the reminders the current registry implies, never a stale one for a
   deadline that moved or a row that closed. On the web the scheduler is a no-op. */
import type { DateKind, DateType } from "../data/types";
import { isNative, quietly } from "./platform";

export const REMINDER_DAYS: readonly number[] = [3, 1];
export const REMINDER_HOUR = 9;
export const REMINDER_TZ = "Europe/Sofia";

/** The minimum a row needs to carry to be planned. `Row` satisfies it. */
export interface DeadlineRow {
  id: string;
  task: string;
  dl: string;
  ty: DateType | "";
  kind: DateKind | "";
  st: string;
}

export interface PlannedNotification {
  /** 31-bit stable id derived from row id + span, so a re-plan yields the same ids. */
  id: number;
  rowId: string;
  daysBefore: number;
  /** ISO date the reminder fires on (Sofia calendar). */
  fireDate: string;
  /** The instant: 09:00 Europe/Sofia on fireDate. */
  fireAt: Date;
  title: string;
  body: string;
}

/** FNV-1a over a short string, masked to a positive 32-bit int (Android notification ids are int32). */
export function notificationId(rowId: string, daysBefore: number): number {
  const s = rowId + "|" + daysBefore;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h & 0x7fffffff) || 1;
}

/** ISO date `days` days after (negative: before) `iso`, in the proleptic calendar, timezone-free. */
export function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The wall clock in `tz` at instant `at`, expressed as a UTC millisecond number for arithmetic. */
function wallClockUTC(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const g = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
}

/** The instant at which `tz` reads `isoDate hour:minute` — DST-correct (two fixed-point passes). */
export function zonedInstant(isoDate: string, hour: number, minute = 0, tz: string = REMINDER_TZ): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  const want = Date.UTC(y, m - 1, d, hour, minute, 0);
  let utc = want;
  for (let i = 0; i < 2; i++) utc += want - wallClockUTC(new Date(utc), tz);
  return new Date(utc);
}

/** True for a row whose deadline is a hard DL — the only kind a reminder is scheduled for. */
export function isHardDeadline(r: DeadlineRow): boolean {
  if (!r.dl || r.st === "Done" || r.st === "Dropped") return false;
  if (r.kind !== "hard") return false;
  return r.ty === "DL" || r.ty === "";
}

function spanLabel(n: number): string {
  return n === 1 ? "tomorrow" : "in " + n + " days";
}

/**
 * Plan the reminders the registry implies.
 * @param rows   open rows (closed ones are skipped anyway)
 * @param today  ISO date in Europe/Sofia; reminders dated before today are never planned
 * @param now    when given, reminders whose instant has already passed are dropped too
 */
export function planDeadlineNotifications(rows: readonly DeadlineRow[], today: string, now?: Date): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  for (const r of rows) {
    if (!isHardDeadline(r)) continue;
    for (const n of REMINDER_DAYS) {
      const fireDate = shiftDate(r.dl, -n);
      if (fireDate < today) continue;
      const fireAt = zonedInstant(fireDate, REMINDER_HOUR, 0);
      if (now && fireAt.getTime() <= now.getTime()) continue;
      out.push({
        id: notificationId(r.id, n),
        rowId: r.id,
        daysBefore: n,
        fireDate,
        fireAt,
        title: "Due " + spanLabel(n) + " · " + r.id,
        body: r.task + " — deadline " + r.dl,
      });
    }
  }
  out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime() || (a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0));
  return out;
}

/**
 * Native only: cancel every pending reminder and schedule the current plan. Returns the number
 * scheduled (0 on the web, or when notification permission is refused).
 */
export async function rescheduleDeadlineNotifications(rows: readonly DeadlineRow[], today: string, now: Date = new Date()): Promise<number> {
  if (!isNative()) return 0;
  let scheduled = 0;
  await quietly(async () => {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const plan = planDeadlineNotifications(rows, today, now);
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) {
      await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    }
    if (!plan.length) return;
    /* Ask for permission only when there is something to remind about. */
    let perm = await LocalNotifications.checkPermissions();
    if (perm.display === "prompt" || perm.display === "prompt-with-rationale") perm = await LocalNotifications.requestPermissions();
    if (perm.display !== "granted") return;
    await LocalNotifications.schedule({
      notifications: plan.map((p) => ({
        id: p.id,
        title: p.title,
        body: p.body,
        schedule: { at: p.fireAt, allowWhileIdle: true },
        extra: { rowId: p.rowId, daysBefore: p.daysBefore },
      })),
    });
    scheduled = plan.length;
  }, "reschedule deadline notifications");
  return scheduled;
}

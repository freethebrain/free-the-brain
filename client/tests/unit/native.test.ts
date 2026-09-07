import { describe, expect, it, vi } from "vitest";
import {
  REMINDER_DAYS,
  isHardDeadline,
  notificationId,
  planDeadlineNotifications,
  shiftDate,
  zonedInstant,
  type DeadlineRow,
} from "../../src/native/notifications";
import { shareToCaptureText } from "../../src/native/share";

const T = "2026-09-07"; // a Monday, Sofia on summer time (UTC+3)

function row(p: Partial<DeadlineRow> & { id: string }): DeadlineRow {
  return { task: "Task " + p.id, dl: "", ty: "DL", kind: "hard", st: "Planned", ...p };
}

describe("zonedInstant — 09:00 Europe/Sofia as a UTC instant, across DST", () => {
  it("is 06:00Z on summer time", () => {
    expect(zonedInstant("2026-09-10", 9).toISOString()).toBe("2026-09-10T06:00:00.000Z");
  });
  it("is 07:00Z on winter time", () => {
    expect(zonedInstant("2026-12-10", 9).toISOString()).toBe("2026-12-10T07:00:00.000Z");
  });
  it("handles the day the clocks change (last Sunday of October 2026 is the 25th)", () => {
    expect(zonedInstant("2026-10-25", 9).toISOString()).toBe("2026-10-25T07:00:00.000Z");
    expect(zonedInstant("2026-10-24", 9).toISOString()).toBe("2026-10-24T06:00:00.000Z");
  });
});

describe("shiftDate / notificationId", () => {
  it("shifts across month and year ends, timezone-free", () => {
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2027-01-02", -3)).toBe("2026-12-30");
    expect(shiftDate("2028-03-01", -1)).toBe("2028-02-29");
  });
  it("is stable, positive, int32 and distinct per (row, span)", () => {
    const a = notificationId("T-087", 1);
    expect(a).toBe(notificationId("T-087", 1));
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(0x7fffffff);
    expect(a).not.toBe(notificationId("T-087", 3));
    expect(a).not.toBe(notificationId("T-087.1", 1));
  });
});

describe("isHardDeadline — only a hard DL earns a reminder", () => {
  it("accepts hard DL (and an untyped date, which the widget reads as DL)", () => {
    expect(isHardDeadline(row({ id: "T-001", dl: "2026-09-20" }))).toBe(true);
    expect(isHardDeadline(row({ id: "T-002", dl: "2026-09-20", ty: "" }))).toBe(true);
  });
  it("rejects self-imposed and agreed dates, SO/SB dates, undated and closed rows", () => {
    expect(isHardDeadline(row({ id: "T-003", dl: "2026-09-20", kind: "self" }))).toBe(false);
    expect(isHardDeadline(row({ id: "T-004", dl: "2026-09-20", kind: "agreed" }))).toBe(false);
    expect(isHardDeadline(row({ id: "T-005", dl: "2026-09-20", ty: "SO" }))).toBe(false);
    expect(isHardDeadline(row({ id: "T-006", dl: "2026-09-20", ty: "SB" }))).toBe(false);
    expect(isHardDeadline(row({ id: "T-007", dl: "" }))).toBe(false);
    expect(isHardDeadline(row({ id: "T-008", dl: "2026-09-20", st: "Done" }))).toBe(false);
    expect(isHardDeadline(row({ id: "T-009", dl: "2026-09-20", kind: "" }))).toBe(false);
  });
});

describe("planDeadlineNotifications — 3 days and 1 day before, 09:00 Sofia, only in the future", () => {
  it("plans both reminders for a deadline well ahead", () => {
    const plan = planDeadlineNotifications([row({ id: "T-087", task: "Play upload", dl: "2026-09-20" })], T);
    expect(plan.map((p) => [p.daysBefore, p.fireDate])).toEqual([
      [3, "2026-09-17"],
      [1, "2026-09-19"],
    ]);
    expect(plan[0].fireAt.toISOString()).toBe("2026-09-17T06:00:00.000Z");
    expect(plan[0].id).toBe(notificationId("T-087", 3));
    expect(plan[0].title).toBe("Due in 3 days · T-087");
    expect(plan[1].title).toBe("Due tomorrow · T-087");
    expect(plan[1].body).toBe("Play upload — deadline 2026-09-20");
  });
  it("drops the 3-day reminder when it is already behind today, keeps the 1-day one", () => {
    const plan = planDeadlineNotifications([row({ id: "T-010", dl: "2026-09-09" })], T);
    expect(plan.map((p) => p.daysBefore)).toEqual([1]);
    expect(plan[0].fireDate).toBe("2026-09-08");
  });
  it("keeps a reminder dated today until 09:00 has passed", () => {
    const rows = [row({ id: "T-011", dl: "2026-09-08" })]; // 1-day reminder fires today 09:00 Sofia = 06:00Z
    expect(planDeadlineNotifications(rows, T).map((p) => p.daysBefore)).toEqual([1]);
    expect(planDeadlineNotifications(rows, T, new Date("2026-09-07T05:59:00Z")).length).toBe(1);
    expect(planDeadlineNotifications(rows, T, new Date("2026-09-07T06:00:00Z")).length).toBe(0);
  });
  it("plans nothing for overdue deadlines, non-hard dates or closed rows", () => {
    const rows = [
      row({ id: "T-012", dl: "2026-09-01" }),
      row({ id: "T-013", dl: "2026-09-30", kind: "self" }),
      row({ id: "T-014", dl: "2026-09-30", ty: "SO" }),
      row({ id: "T-015", dl: "2026-09-30", st: "Dropped" }),
    ];
    expect(planDeadlineNotifications(rows, T)).toEqual([]);
  });
  it("orders by firing instant, then by row id, and is deterministic", () => {
    const rows = [row({ id: "T-020", dl: "2026-09-12" }), row({ id: "T-018", dl: "2026-09-10" }), row({ id: "T-019", dl: "2026-09-12" })];
    const plan = planDeadlineNotifications(rows, T);
    expect(plan.map((p) => p.rowId + "/" + p.daysBefore)).toEqual(["T-018/3", "T-018/1", "T-019/3", "T-020/3", "T-019/1", "T-020/1"]);
    expect(planDeadlineNotifications(rows, T)).toEqual(plan);
    expect(REMINDER_DAYS).toEqual([3, 1]);
  });
});

describe("shareToCaptureText — one clean line for a capture row", () => {
  it("collapses whitespace and returns null for nothing", () => {
    expect(shareToCaptureText({ text: "  Call   the\n plumber  " })).toBe("Call the plumber");
    expect(shareToCaptureText({ text: "" })).toBeNull();
    expect(shareToCaptureText({ text: null })).toBeNull();
    expect(shareToCaptureText(null)).toBeNull();
  });
  it("prefixes a bare URL with its subject, when the sharing app sent one", () => {
    expect(shareToCaptureText({ text: "https://example.org/x", subject: "Read this" })).toBe("Read this — https://example.org/x");
    expect(shareToCaptureText({ text: "Read this https://example.org/x", subject: "Read this" })).toBe("Read this https://example.org/x");
    expect(shareToCaptureText({ text: "https://example.org/x", subject: "https://example.org/x" })).toBe("https://example.org/x");
  });
});

describe("the adapter on the plain web — every entry point is a no-op that never throws", () => {
  it("reports the web platform", async () => {
    const n = await import("../../src/native/index");
    expect(n.isNative()).toBe(false);
    expect(n.platform()).toBe("web");
  });
  it("schedules nothing and stores nothing", async () => {
    const n = await import("../../src/native/index");
    expect(await n.rescheduleDeadlineNotifications([row({ id: "T-030", dl: "2026-09-30" })], T)).toBe(0);
    await n.setToken("abc");
    expect(await n.getToken()).toBeNull();
    await n.clearToken();
  });
  it("receives no shares and calls no listener", async () => {
    const n = await import("../../src/native/index");
    expect(await n.consumeSharedText()).toBeNull();
    const cb = vi.fn();
    n.onSharedText(cb);
    await new Promise((r) => setTimeout(r, 10));
    expect(cb).not.toHaveBeenCalled();
  });
  it("leaves haptics, status bar and splash alone (no DOM, no matchMedia needed)", async () => {
    const n = await import("../../src/native/index");
    expect(() => n.tapFeedback()).not.toThrow();
    expect(() => n.successFeedback()).not.toThrow();
    expect(() => n.applyStatusBar()).not.toThrow();
    expect(() => n.applyStatusBar(true)).not.toThrow();
    expect(() => n.watchTheme()).not.toThrow();
    expect(() => n.hideSplash()).not.toThrow();
  });
});

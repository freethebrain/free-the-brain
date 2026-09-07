import { describe, expect, it } from "vitest";
import { cycleMonday, dleft, dstate, inFortnight, isOverdue, offsetDate, weekOf } from "../../src/derive/dates";

const T = "2026-09-07"; // a Monday

describe("offsetDate — months first, clamped to month end, then weeks, then days", () => {
  it("returns today for zero offsets", () => {
    expect(offsetDate(0, 0, 0, T)).toBe("2026-09-07");
  });
  it("adds days and weeks", () => {
    expect(offsetDate(0, 0, 3, T)).toBe("2026-09-10");
    expect(offsetDate(0, 1, 0, T)).toBe("2026-09-14");
    expect(offsetDate(0, 2, 3, T)).toBe("2026-09-24");
  });
  it("adds months and rolls the year", () => {
    expect(offsetDate(1, 0, 0, T)).toBe("2026-10-07");
    expect(offsetDate(4, 0, 0, T)).toBe("2027-01-07");
    expect(offsetDate(12, 0, 0, T)).toBe("2027-09-07");
  });
  it("clamps to the last valid day of the target month before adding weeks and days", () => {
    expect(offsetDate(1, 0, 0, "2026-01-31")).toBe("2026-02-28");
    expect(offsetDate(1, 0, 0, "2028-01-31")).toBe("2028-02-29"); // leap year
    expect(offsetDate(1, 0, 1, "2026-01-31")).toBe("2026-03-01"); // clamp, then +1 day
    expect(offsetDate(2, 0, 0, "2026-12-31")).toBe("2027-02-28");
    expect(offsetDate(1, 1, 0, "2026-03-31")).toBe("2026-05-07"); // 30 April, then a week
  });
});

describe("dleft / cycleMonday / weekOf", () => {
  it("counts days from today, negative in the past", () => {
    expect(dleft("2026-09-07", T)).toBe(0);
    expect(dleft("2026-09-08", T)).toBe(1);
    expect(dleft("2026-09-03", T)).toBe(-4);
    expect(dleft("2026-08-25", T)).toBe(-13);
  });
  it("derives the ISO week's Monday from the calendar", () => {
    expect(cycleMonday("2026-09-07")).toBe("2026-09-07");
    expect(cycleMonday("2026-09-13")).toBe("2026-09-07"); // Sunday
    expect(cycleMonday("2026-09-14")).toBe("2026-09-14");
    expect(weekOf("2026-08-31")).toBe("2026-08-31");
    expect(weekOf("2026-09-05")).toBe("2026-08-31");
  });
});

describe("dstate — DL / SO / SB", () => {
  it("DL is overdue past its date, due otherwise", () => {
    expect(dstate({ dl: "2026-09-03", ty: "DL", st: "Planned" }, T)).toEqual({ k: "overdue", n: -4 });
    expect(dstate({ dl: "2026-09-07", ty: "DL", st: "Planned" }, T)).toEqual({ k: "due", n: 0 });
    expect(dstate({ dl: "2026-09-20", ty: "DL", st: "Active" }, T)).toEqual({ k: "due", n: 13 });
  });
  it("an empty type is treated as DL", () => {
    expect(dstate({ dl: "2026-09-03", ty: "", st: "Inbox" }, T)).toEqual({ k: "overdue", n: -4 });
  });
  it("SB is overdue past its date only while Inbox or Planned; Active/Blocked show started", () => {
    expect(dstate({ dl: "2026-09-01", ty: "SB", st: "Planned" }, T)).toEqual({ k: "overdue", n: -6 });
    expect(dstate({ dl: "2026-09-01", ty: "SB", st: "Inbox" }, T)).toEqual({ k: "overdue", n: -6 });
    expect(dstate({ dl: "2026-08-30", ty: "SB", st: "Active" }, T)).toEqual({ k: "started", n: -8 });
    expect(dstate({ dl: "2026-08-30", ty: "SB", st: "Blocked" }, T)).toEqual({ k: "started", n: -8 });
    expect(dstate({ dl: "2026-09-10", ty: "SB", st: "Planned" }, T)).toEqual({ k: "startby", n: 3 });
  });
  it("SO is never overdue: dormant before, starts on the day, eligible after", () => {
    expect(dstate({ dl: "2026-09-15", ty: "SO", st: "Inbox" }, T)).toEqual({ k: "dormant", n: 8 });
    expect(dstate({ dl: "2026-09-07", ty: "SO", st: "Inbox" }, T)).toEqual({ k: "starts", n: 0 });
    expect(dstate({ dl: "2026-09-01", ty: "SO", st: "Active" }, T)).toEqual({ k: "eligible", n: -6 });
  });
  it("undated rows have no state", () => {
    expect(dstate({ dl: "", ty: "", st: "Planned" }, T)).toBeNull();
  });
});

describe("isOverdue / inFortnight follow the type rules", () => {
  it("only the overdue kind counts as overdue", () => {
    expect(isOverdue({ dl: "2026-09-03", ty: "DL", st: "Planned" }, T)).toBe(true);
    expect(isOverdue({ dl: "2026-09-01", ty: "SO", st: "Planned" }, T)).toBe(false);
    expect(isOverdue({ dl: "2026-08-30", ty: "SB", st: "Active" }, T)).toBe(false);
    expect(isOverdue({ dl: "2026-08-30", ty: "SB", st: "Planned" }, T)).toBe(true);
  });
  it("dormant start-ons are held out of the fourteen-day count; eligible and start-by are in", () => {
    expect(inFortnight({ dl: "2026-09-15", ty: "SO", st: "Inbox" }, T)).toBe(false);
    expect(inFortnight({ dl: "2026-09-07", ty: "SO", st: "Inbox" }, T)).toBe(true);
    expect(inFortnight({ dl: "2026-09-10", ty: "SB", st: "Planned" }, T)).toBe(true);
    expect(inFortnight({ dl: "2026-09-21", ty: "DL", st: "Planned" }, T)).toBe(true);
    expect(inFortnight({ dl: "2026-09-22", ty: "DL", st: "Planned" }, T)).toBe(false);
    expect(inFortnight({ dl: "2026-09-03", ty: "DL", st: "Planned" }, T)).toBe(false);
  });
});

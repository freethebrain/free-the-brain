import { describe, expect, it } from "vitest";
import type { Row } from "../../src/data/types";
import { buildQueue, judgedThisCycle, rowTier } from "../../src/derive/queue";

const T = "2026-09-07"; // Monday — the cycle starts today

function row(p: Partial<Row> & { id: string }): Row {
  return {
    task: "task " + p.id,
    cat: "Personal / Admin",
    u: null,
    i: null,
    st: "Planned",
    rec: "2026-08-01",
    tri: "",
    dl: "",
    ty: "",
    kind: "",
    d: (p.id.match(/\./g) || []).length,
    note: "",
    blk: null,
    ...p,
  };
}

describe("rowTier — the five tiers", () => {
  it("① overdue, keyed by days overdue (most overdue first)", () => {
    expect(rowTier(row({ id: "T-1", dl: "2026-09-03", ty: "DL" }), T)).toEqual([1, -4, "T-1"]);
    expect(rowTier(row({ id: "T-2", dl: "2026-09-01", ty: "SB", st: "Planned" }), T)).toEqual([1, -6, "T-2"]);
  });
  it("② dated within 14 days, soonest first — eligible SO included, dormant SO and started SB excluded", () => {
    expect(rowTier(row({ id: "T-3", dl: "2026-09-09", ty: "DL", u: "M", i: "H", tri: "2026-08-31" }), T)).toEqual([2, 2, "T-3"]);
    expect(rowTier(row({ id: "T-4", dl: "2026-09-07", ty: "SO" }), T)).toEqual([2, 0, "T-4"]);
    expect(rowTier(row({ id: "T-5", dl: "2026-09-01", ty: "SO", st: "Active" }), T)).toEqual([2, -6, "T-5"]);
    // dormant SO falls through to the score-based tiers
    expect(rowTier(row({ id: "T-6", dl: "2026-09-15", ty: "SO", rec: "2026-08-30" }), T)).toEqual([3, "2026-08-30", "T-6"]);
    // started SB (Active past its start-by) falls through as well
    expect(rowTier(row({ id: "T-7", dl: "2026-08-30", ty: "SB", st: "Active", u: "M", i: "H", tri: "2026-08-25" }), T)).toEqual([5, "2026-08-25", "T-7"]);
    // beyond 14 days is not tier 2
    expect(rowTier(row({ id: "T-8", dl: "2026-09-22", ty: "DL", u: "M", i: "M", tri: "2026-09-02" }), T)).toEqual([5, "2026-09-02", "T-8"]);
  });
  it("③ never judged (no scores), oldest Recorded first", () => {
    expect(rowTier(row({ id: "T-9", rec: "2026-07-10" }), T)).toEqual([3, "2026-07-10", "T-9"]);
  });
  it("④ scores present but never Triaged — proposed, not confirmed", () => {
    expect(rowTier(row({ id: "T-10", u: "H", i: "M", rec: "2026-08-05", tri: "" }), T)).toEqual([4, "2026-08-05", "T-10"]);
    expect(rowTier(row({ id: "T-11", u: "H", i: null, rec: "2026-08-05", tri: null }), T)).toEqual([4, "2026-08-05", "T-11"]);
  });
  it("⑤ stalest triage first", () => {
    expect(rowTier(row({ id: "T-12", u: "L", i: "L", tri: "2026-06-10" }), T)).toEqual([5, "2026-06-10", "T-12"]);
  });
});

describe("buildQueue — branches, exclusion by cycle, ordering", () => {
  const rows: Row[] = [
    row({ id: "T-20", u: "L", i: "L", tri: "2026-06-10" }), // tier 5, stalest
    row({ id: "T-21", u: "M", i: "M", tri: "2026-08-20" }), // tier 5
    row({ id: "T-21.1", dl: "2026-09-03", ty: "DL", u: "M", i: "M", tri: "2026-08-20" }), // subtask overdue -> pulls the branch to tier 1
    row({ id: "T-22", rec: "2026-07-01" }), // tier 3
    row({ id: "T-23", rec: "2026-06-01" }), // tier 3, older
    row({ id: "T-24", u: "H", i: "H", tri: "2026-09-07" }), // judged this cycle -> excluded
    row({ id: "T-25", dl: "2026-09-08", ty: "DL", u: "H", i: "H", tri: "2026-08-01" }), // tier 2
    row({ id: "T-26.1", u: "H", i: "M", rec: "2026-08-05" }), // orphan subtask (parent closed) -> its own entry, tier 4
    row({ id: "T-27", dl: "2026-08-25", ty: "DL", u: "H", i: "M", tri: "2026-07-30" }), // tier 1, 13d overdue
  ];
  const Q = buildQueue(rows, T);

  it("excludes rows triaged on or after the cycle's Monday", () => {
    expect(Q.map((e) => e.top.id)).not.toContain("T-24");
  });
  it("treats a branch as one entry and lets a subtask's date pull the branch up", () => {
    const e = Q.find((x) => x.top.id === "T-21");
    expect(e).toBeDefined();
    expect(e!.rows.map((r) => r.id)).toEqual(["T-21", "T-21.1"]);
    expect(e!.key[0]).toBe(1);
  });
  it("surfaces an orphan subtask as a top-level entry", () => {
    expect(Q.map((e) => e.top.id)).toContain("T-26.1");
  });
  it("orders by tier, then by the tier key, then by id", () => {
    expect(Q.map((e) => e.top.id)).toEqual([
      "T-27", // ① -13
      "T-21", // ① -4 (via T-21.1)
      "T-25", // ② +1
      "T-23", // ③ recorded 06-01
      "T-22", // ③ recorded 07-01
      "T-26.1", // ④
      "T-20", // ⑤ triaged 06-10
    ]);
  });
  it("counts branches judged this cycle", () => {
    expect(judgedThisCycle(rows, T)).toBe(1);
  });
});

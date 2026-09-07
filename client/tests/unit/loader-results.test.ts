import { beforeEach, describe, expect, it } from "vitest";
import { depthOf, extractBlocker, fromEnvelope, nextNumAfter, pickMode, toRow } from "../../src/data/loader";
import { REG, setRegistry } from "../../src/data/registry";
import type { ApiTask } from "../../src/data/types";
import { eff } from "../../src/derive/effective";
import { P, clearPending, pend } from "../../src/editor/pending";
import { buildResults } from "../../src/results/build";
import { view } from "../../src/state";

const api = (p: Partial<ApiTask> & { id: string }): ApiTask => ({
  task: "task " + p.id,
  category: "Art College",
  u: null,
  i: null,
  status: "Planned",
  recorded: "2026-08-01",
  triaged: null,
  deadline: null,
  deadline_type: null,
  deadline_kind: null,
  done: null,
  notes: "",
  blocker: null,
  updated_at: "2026-09-07T09:00:00+03:00",
  ...p,
});

describe("loader — API shape to widget row shape", () => {
  it("depth is the number of dots in the id", () => {
    expect(depthOf("T-021")).toBe(0);
    expect(depthOf("T-021.1")).toBe(1);
    expect(depthOf("T-021.1.3")).toBe(2);
  });
  it("extracts a blocker label from 'waiting on' / 'blocked on' in the notes", () => {
    expect(extractBlocker("Waiting on the landlord's reply about the winter rate. Chased once.")).toBe("the landlord's reply about the winter rate");
    expect(extractBlocker("Blocked on the bank's back office; they said 10 working days.")).toBe("the bank's back office");
    expect(extractBlocker("Nothing to see here.")).toBeNull();
    expect(extractBlocker(null)).toBeNull();
  });
  it("maps fields, prefers the API's blocker, and only labels Blocked rows", () => {
    const r = toRow(api({ id: "T-5.1", status: "Blocked", notes: "Waiting on Sasho for the key.", blocker: "Sasho", deadline: "2026-09-12", deadline_type: "SB", deadline_kind: "self", triaged: "2026-09-01", u: "H", i: "M" }));
    expect(r).toMatchObject({ id: "T-5.1", cat: "Art College", u: "H", i: "M", st: "Blocked", rec: "2026-08-01", tri: "2026-09-01", dl: "2026-09-12", ty: "SB", kind: "self", d: 1, blk: "Sasho" });
    const p = toRow(api({ id: "T-6", status: "Planned", notes: "Waiting on nobody, this is a note." }));
    expect(p.blk).toBeNull();
    expect(p.tri).toBe("");
    expect(p.dl).toBe("");
    expect(p.ty).toBe("");
  });
  it("splits an envelope into open rows and done rows and derives NEXTNUM", () => {
    const inj = fromEnvelope(
      {
        stamp: "2026-09-07-0900",
        today: "2026-09-07",
        reserved: ["T-122", "T-123", "T-124"],
        rows: [api({ id: "T-1" }), api({ id: "T-2", status: "Done", done: "2026-09-05" }), api({ id: "T-3", status: "Dropped" })],
      },
      "2026-09-07",
    );
    expect(inj.ROWS.map((r) => r.id)).toEqual(["T-1"]);
    expect(inj.DONE).toEqual([{ id: "T-2", task: "task T-2", cat: "Art College", done: "2026-09-05" }]);
    expect(inj.NEXTNUM).toBe(125);
    expect(nextNumAfter([], "T-050")).toBe(51);
  });
  it("picks the mode from ?src, else from hostname", () => {
    expect(pickMode({ search: "?src=fixture", hostname: "app.example.com" })).toBe("fixture");
    expect(pickMode({ search: "?src=api", hostname: "localhost" })).toBe("api");
    expect(pickMode({ search: "", hostname: "app.example.com" })).toBe("api");
    expect(pickMode({ search: "", hostname: "localhost" })).toBe("fixture");
  });
});

describe("buildResults — the output contract", () => {
  beforeEach(() => {
    clearPending();
    view.capVals = [];
    view.extra = [];
    setRegistry({
      STAMP: "2026-08-31-1137",
      TODAY: "2026-09-07",
      RESERVED: ["T-101", "T-102", "T-103"],
      NEXTNUM: 104,
      ROWS: [
        toRow(api({ id: "T-041", task: "chase Ian", status: "Inbox" })),
        toRow(api({ id: "T-052", task: "book dentist", deadline: "2026-09-20", deadline_type: "DL" })),
        toRow(api({ id: "T-060", task: "untouched" })),
      ],
      DONE: [{ id: "T-070", task: "x", cat: "Art College", done: "2026-08-20" }],
    });
  });

  it("emits nothing for untouched rows and the placeholder when nothing is judged", () => {
    expect(buildResults()).toBe("TRIAGE — Master widget — 2026-09-07 (staged from 2026-08-31-1137)\n(nothing judged yet)");
  });

  it("serialises scores, status, a typed moved date, a cleared date, notes, reopen lines and captures", () => {
    const a = pend("T-041");
    a.u = "H";
    a.i = "M";
    a.st = 1;
    a.dm = 1;
    a.ty = "SB";
    a.w = 1;
    a.d = 1;
    a.nt = " free text ";
    pend("T-052").dm = 2;
    const d = pend("T-070");
    d.st = 1;
    d.nt = "why";
    view.capVals = ["", "captured line"];
    expect(buildResults()).toBe(
      [
        "TRIAGE — Master widget — 2026-09-07 (staged from 2026-08-31-1137)",
        "T-041 (chase Ian): U=H I=M status=Planned deadline=SB 2026-09-15 note: free text",
        "T-052 (book dentist): deadline=no date",
        "T-070 (x): REOPEN status=Planned note: why",
        "",
        "NEW TASKS:",
        "T-102: captured line",
      ].join("\n"),
    );
  });

  it("lays pending judgments over the effective view", () => {
    const s = pend("T-052");
    s.st = 4;
    const e = eff(REG.ROWS[1]);
    expect(e.st).toBe("Done");
    expect(e.closing).toBe(true);
    s.dm = 2;
    expect(eff(REG.ROWS[1]).dl).toBe("");
    expect(P["T-052"]).toBeDefined();
  });
});

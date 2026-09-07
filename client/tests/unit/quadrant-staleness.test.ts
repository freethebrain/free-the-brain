import { describe, expect, it } from "vitest";
import { quadK } from "../../src/derive/quadrant";
import { staleness } from "../../src/derive/staleness";

describe("quadK — H/H Do now; I=H Schedule; U=H Minimize; otherwise Later; no scores Unjudged", () => {
  it("derives the four quadrants", () => {
    expect(quadK({ u: "H", i: "H" })).toBe("q1");
    expect(quadK({ u: "M", i: "H" })).toBe("q2");
    expect(quadK({ u: "L", i: "H" })).toBe("q2");
    expect(quadK({ u: "H", i: "M" })).toBe("q3");
    expect(quadK({ u: "H", i: "L" })).toBe("q3");
    expect(quadK({ u: "M", i: "M" })).toBe("q4");
    expect(quadK({ u: "L", i: "L" })).toBe("q4");
  });
  it("a missing score on either axis is Unjudged, never a fabricated quadrant", () => {
    expect(quadK({ u: null, i: null })).toBe("q0");
    expect(quadK({ u: "H", i: null })).toBe("q0");
    expect(quadK({ u: null, i: "H" })).toBe("q0");
  });
});

describe("staleness — quiet under 7 days, amber at 21 or never", () => {
  const T = "2026-09-07";
  it("never judged is old", () => {
    expect(staleness({ tri: null }, T)).toEqual({ txt: "never judged", old: true });
    expect(staleness({ tri: "" }, T)).toEqual({ txt: "never judged", old: true });
  });
  it("recent judgments are quiet", () => {
    expect(staleness({ tri: "2026-09-07" }, T)).toEqual({ txt: "judged today", old: false });
    expect(staleness({ tri: "2026-09-04" }, T)).toEqual({ txt: "judged 3d ago", old: false });
    expect(staleness({ tri: "2026-09-01" }, T)).toEqual({ txt: "judged 6d ago", old: false });
  });
  it("7–20 days is shown but not amber; 21+ is amber", () => {
    expect(staleness({ tri: "2026-08-31" }, T)).toEqual({ txt: "judged 7d ago", old: false });
    expect(staleness({ tri: "2026-08-18" }, T)).toEqual({ txt: "judged 20d ago", old: false });
    expect(staleness({ tri: "2026-08-17" }, T)).toEqual({ txt: "judged 21d ago", old: true });
    expect(staleness({ tri: "2026-06-10" }, T)).toEqual({ txt: "judged 89d ago", old: true });
  });
});

/* Constants from the template, verbatim. */
import type { DateType } from "./data/types";

export const CATS: Record<string, { h: number; s: string; tier: string }> = {
  "Art College": { h: 45, s: "85%", tier: "Wealth engine" },
  "Real Estate": { h: 145, s: "52%", tier: "Burn deleter" },
  "Freelance Videoediting": { h: 28, s: "78%", tier: "Income floor" },
  "Website Projects": { h: 214, s: "70%", tier: "Asymmetric bet" },
  "Best Moments": { h: 358, s: "68%", tier: "Bridge income" },
  "Research & Side Projects": { h: 270, s: "55%", tier: "Capability stack" },
  "Personal / Admin": { h: 220, s: "12%", tier: "Life & admin" },
};
export const ORDER = Object.keys(CATS);
export const FALLBACK_CAT = { h: 220, s: "10%" };

export type TabId = "portfolio" | "radar" | "eisen" | "wait" | "done" | "triage";
export const TABS: [TabId, string][] = [
  ["portfolio", "Portfolio"],
  ["radar", "Radar"],
  ["eisen", "Eisenhower"],
  ["wait", "Waiting"],
  ["done", "Done"],
  ["triage", "Triage"],
];
export const HINTS: Record<TabId, string> = {
  portfolio:
    "Cards follow the Earning Hierarchy, top tier first. Tap a card to open it; tap a task to judge it — U, I, status, date, a note. ▸ folds a branch. The circle marks a task done in one tap.",
  radar:
    "Dates first — the system's own rule is to trust dates over stale scores. DL = finish by, SB = start by, SO = start on (dormant until then).",
  eisen:
    "Quadrants derive from recorded U/I — and from anything you've judged this session, marked pending. Unjudged rows are the triage queue's tier 3, not a fifth priority.",
  wait: "Everything with a named external blocker, grouped by who you are waiting on. Waiting time counts from capture.",
  done: "The motivation archive. Every row here is something that no longer exists as a problem.",
  triage:
    "The queue, five branches at a time, in the standing sort order. Judge what you can; untouched rows simply stay in the queue. Send results whenever you like — it carries every judgment from every tab.",
};
export const STATUS = ["—", "Planned", "Active", "Blocked", "Done", "Dropped"] as const;
export const MODES = ["keep", "move", "no date"] as const;
export const TYPES: DateType[] = ["DL", "SO", "SB"];
export const TYNAME: Record<DateType, string> = { DL: "deadline", SO: "start-on", SB: "start-by" };
export const TIERS: Record<number, string> = {
  1: "① Overdue",
  2: "② Dated within 14 days",
  3: "③ Never judged",
  4: "④ Unverified scores — U/I present, never confirmed by you",
  5: "⑤ Stalest triage",
};
export const CAPS: Record<"m" | "w" | "d", number> = { m: 12, w: 4, d: 31 };
export const CHUNK = 5;
export const QNAME: Record<string, string> = { q1: "Do now", q2: "Schedule", q3: "Minimize", q4: "Later", q0: "Unjudged" };

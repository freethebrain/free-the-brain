/* ---- Send results — the same output contract as the triage widgets, plus the date-type prefix;
   untouched rows produce nothing. ----
   TRIAGE — Master widget — YYYY-MM-DD (staged from …)
   T-nnn (task name): U=H I=M status=Planned deadline=SB 2026-09-01 note: free text
   T-nnn (task name): deadline=no date
   T-nnn (task name): REOPEN status=Planned note: free text

   NEW TASKS:
   T-0nn: captured line
   Absent fields mean unchanged, deadline=no date clears the date only, note: is always last. */
import { STATUS } from "../constants";
import { REG } from "../data/registry";
import { P, dlValue, judgedId } from "../editor/pending";
import { view } from "../state";

export function buildResults(): string {
  const L = ["TRIAGE — Master widget — " + REG.TODAY + " (staged from " + REG.STAMP + ")"];
  REG.ROWS.forEach((r) => {
    const s = P[r.id];
    if (!judgedId(r.id)) return;
    const p: string[] = [];
    if (s.u) p.push("U=" + s.u);
    if (s.i) p.push("I=" + s.i);
    if (s.st) p.push("status=" + STATUS[s.st]);
    if (s.dm === 1) p.push("deadline=" + s.ty + " " + dlValue(s));
    if (s.dm === 2) p.push("deadline=no date");
    if (s.nt && s.nt.trim()) p.push("note: " + s.nt.trim());
    L.push(r.id + " (" + r.task + "): " + p.join(" "));
  });
  REG.DONE.forEach((r) => {
    const s = P[r.id];
    if (!judgedId(r.id)) return;
    const p: string[] = [];
    if (s.st) p.push("status=" + STATUS[s.st]);
    if (s.nt && s.nt.trim()) p.push("note: " + s.nt.trim());
    L.push(r.id + " (" + r.task + "): REOPEN " + p.join(" "));
  });
  const caps = REG.RESERVED.concat(view.extra)
    .map((id, n) => [id, view.capVals[n]] as [string, string | undefined])
    .filter((x) => x[1] && x[1].trim());
  if (caps.length) {
    L.push("", "NEW TASKS:");
    caps.forEach((c) => L.push(c[0] + ": " + (c[1] as string).trim()));
  }
  if (L.length === 1) L.push("(nothing judged yet)");
  return L.join("\n");
}

/** Number of judgment lines a results text carries (rows plus captures), for the "Recorded n" line. */
export function countJudgments(): number {
  const rows = Object.keys(P).filter(judgedId).length;
  const caps = REG.RESERVED.concat(view.extra).filter((_id, n) => view.capVals[n] && view.capVals[n].trim()).length;
  return rows + caps;
}

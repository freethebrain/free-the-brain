/* Waiting — every Blocked row grouped by named external party, with "waiting up to Nd" counted from
   capture. A blocked row with no named blocker is grouped under a label that says so — an unnamed
   blocker is a triage gap, and the widget is allowed to say that much. */
import { REG } from "../data/registry";
import type { Row } from "../data/types";
import { dleft } from "../derive/dates";
import { eff } from "../derive/effective";
import { match } from "../derive/tree";
import { esc } from "./html";
import { itemHTML } from "./item";

export function renderWait(host: HTMLElement, q: string): void {
  const rs = REG.ROWS.filter((r) => eff(r).st === "Blocked").filter((r) => match(r, q));
  if (!rs.length) {
    host.innerHTML = '<div class="empty">Nothing is waiting on anyone. Rare — enjoy it.</div>';
    return;
  }
  const groups: Record<string, Row[]> = {};
  rs.forEach((r) => {
    const k = r.blk || "Unnamed blocker — worth naming at the next triage";
    (groups[k] = groups[k] || []).push(r);
  });
  Object.keys(groups).forEach((k) => {
    const g = groups[k];
    const div = document.createElement("div");
    const worst = Math.max.apply(
      null,
      g.map((r) => -dleft(r.rec)),
    );
    div.innerHTML =
      '<div class="who">' + esc(k) + ' <span class="c">· ' + g.length + " task" + (g.length > 1 ? "s" : "") + " · waiting up to " + worst + "d</span></div>" +
      '<div class="flat">' + g.map((r) => itemHTML(r, { dot: true, stale: false })).join("") + "</div>";
    host.appendChild(div);
  });
}

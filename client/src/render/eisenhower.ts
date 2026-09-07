/* Eisenhower — four bands with coloured spines plus a fifth, Unjudged, for rows carrying no scores. */
import { REG } from "../data/registry";
import { isOverdue } from "../derive/dates";
import { eff } from "../derive/effective";
import { quadK, type QuadKey } from "../derive/quadrant";
import { match } from "../derive/tree";
import { view } from "../state";
import { itemHTML } from "./item";

export function renderEisen(host: HTMLElement, q: string): void {
  const BANDS: [QuadKey, string, string, string][] = [
    ["q1", "Do now", "Urgent and important", "var(--q1)"],
    ["q2", "Schedule", "Important, not urgent", "var(--q2)"],
    ["q3", "Minimize", "Urgent, not important", "var(--q3)"],
    ["q4", "Later", "Neither urgent nor important", "var(--q4)"],
    ["q0", "Unjudged", "No scores yet — owned by the triage queue", "var(--q0)"],
  ];
  BANDS.forEach((b) => {
    const rs = REG.ROWS.filter((r) => quadK(eff(r)) === b[0])
      .filter((r) => match(r, q))
      .filter((r) => !(view.hideSubs && r.d > 0));
    const band = document.createElement("div");
    band.className = "band";
    band.style.setProperty("--bc", b[3]);
    const od = rs.filter((r) => isOverdue(eff(r))).length;
    band.innerHTML =
      '<div class="bhead"><div class="bname">' + b[1] + ' <span class="bcount">' + rs.length + "</span></div>" +
      '<div class="bsub">' + b[2] + (od ? ' · <span style="color:var(--red)">' + od + " overdue</span>" : "") + "</div></div>" +
      (rs.length
        ? '<div class="flat">' + rs.map((r) => itemHTML(r, { dot: true })).join("") + "</div>"
        : '<div class="empty">Nothing here' + (q ? " matching the filter" : "") + ".</div>");
    host.appendChild(band);
  });
}

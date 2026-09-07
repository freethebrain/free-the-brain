/* Portfolio — home. Seven category cards ordered by the Earning Hierarchy, top tier first. Each card:
   open count, overdue count, next dated task, a thin status-mix bar. Cards open on tap; a live filter
   auto-opens matching cards. */
import { CATS, ORDER } from "../constants";
import { REG } from "../data/registry";
import { dleft, isOverdue } from "../derive/dates";
import { eff } from "../derive/effective";
import { branchSort, match, visibleTree } from "../derive/tree";
import { view } from "../state";
import { itemHTML } from "./item";

export function renderPortfolio(host: HTMLElement, q: string): void {
  const grid = document.createElement("div");
  grid.className = "grid";
  ORDER.forEach((cat) => {
    const all = REG.ROWS.filter((r) => r.cat === cat),
      rs = all.filter((r) => match(r, q));
    if (q && !rs.length) return;
    const cc = CATS[cat];
    const od = all.filter((r) => isOverdue(eff(r))).length;
    const nxt = all
      .map((r) => ({ r: r, e: eff(r) }))
      .filter((x) => x.e.dl && dleft(x.e.dl) >= 0)
      .sort((a, b) => dleft(a.e.dl) - dleft(b.e.dl))[0];
    const n = (s: string) => all.filter((r) => eff(r).st === s).length;
    const open = view.cardOpen[cat] || !!q;
    const shown = visibleTree(branchSort(q ? rs : all));
    const card = document.createElement("div");
    card.className = "cardc" + (open ? " open" : "");
    card.style.setProperty("--h", String(cc.h));
    card.style.setProperty("--s", cc.s);
    card.innerHTML =
      '<div class="chead" data-cat="' + cat + '">' +
      '<div class="crow1"><span class="swatch"></span><span class="cname">' + cat + '</span><span class="tier">' + cc.tier + "</span></div>" +
      '<div class="crow2"><span><b>' + all.length + "</b> open</span>" +
      (od ? '<span class="warn">' + od + " overdue</span>" : "") +
      (nxt ? "<span>next: <b>" + nxt.e.dl.slice(5) + "</b> " + nxt.r.id + "</span>" : "<span>no dated tasks</span>") + "</div>" +
      '<div class="bar"><span class="sA" style="width:' + (100 * n("Active")) / all.length + '%"></span>' +
      '<span class="sP" style="width:' + (100 * n("Planned")) / all.length + '%"></span>' +
      '<span class="sB" style="width:' + (100 * n("Blocked")) / all.length + '%"></span>' +
      '<span class="sI" style="width:' + (100 * n("Inbox")) / all.length + '%"></span></div></div>' +
      '<div class="list">' + shown.map((r) => itemHTML(r, { tree: true })).join("") + "</div>";
    grid.appendChild(card);
  });
  host.appendChild(grid);
}

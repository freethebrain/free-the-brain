/* Done — the motivation archive. Headline counters (this week / this month / all-time, plus
   "closing when sent"), then every closed row grouped by week, newest first. Rows carry a reduced
   editor — reopen as Planned, Active, Blocked or Dropped, with a reason — which emits a REOPEN line. */
import { CATS, FALLBACK_CAT, STATUS } from "../constants";
import { REG } from "../data/registry";
import { weekOf } from "../derive/dates";
import { eff } from "../derive/effective";
import { P, blank, judgedId } from "../editor/pending";
import { view } from "../state";
import { esc, escA } from "./html";

export function renderDone(host: HTMLElement, q: string): void {
  const TODAY = REG.TODAY,
    DONE = REG.DONE;
  const rs = DONE.filter((r) => !q || (r.id + " " + r.task + " " + r.cat).toLowerCase().includes(q))
    .slice()
    .sort((a, b) => (a.done < b.done ? 1 : -1));
  const wk = weekOf;
  const thisMon = wk(TODAY);
  const tw = DONE.filter((r) => wk(r.done) === thisMon).length;
  const tm = DONE.filter((r) => r.done.slice(0, 7) === TODAY.slice(0, 7)).length;
  const closing = REG.ROWS.filter((r) => eff(r).closing).length;
  const sum = document.createElement("div");
  sum.className = "dsum";
  sum.innerHTML =
    '<div><div class="dnum">' + tw + '</div><div class="dlab">this week</div></div>' +
    '<div><div class="dnum">' + tm + '</div><div class="dlab">this month</div></div>' +
    '<div><div class="dnum">' + DONE.length + '</div><div class="dlab">all-time</div></div>' +
    (closing ? '<div><div class="dnum" style="color:var(--teal)">+' + closing + '</div><div class="dlab">closing when sent</div></div>' : "");
  host.appendChild(sum);
  const note = document.createElement("p");
  note.className = "dnote";
  note.textContent = "Grouped by week, newest first. Every line here used to be an open loop.";
  host.appendChild(note);
  let cur = "";
  let wrap: HTMLDivElement | null = null;
  rs.forEach((r) => {
    const w = wk(r.done);
    if (w !== cur) {
      cur = w;
      const h = document.createElement("div");
      h.className = "wk";
      const lab = w === thisMon ? "This week" : "Week of " + w.slice(8) + "." + w.slice(5, 7);
      h.innerHTML = '<div class="shead">' + lab + "</div>";
      host.appendChild(h);
      wrap = document.createElement("div");
      wrap.className = "flat";
      host.appendChild(wrap);
    }
    const cc = CATS[r.cat] || FALLBACK_CAT;
    const sD = P[r.id] || blank();
    (wrap as HTMLDivElement).innerHTML +=
      '<div class="item' + (view.expand[r.id] ? " exp" : "") + (judgedId(r.id) ? " judged" : "") + '" data-id="' + r.id + '">' +
      '<div class="i1" data-tgl="' + r.id + '">' +
      '<span class="dodate">' + r.done.slice(8) + "." + r.done.slice(5, 7) + "</span>" +
      '<span class="catdot" style="--h:' + cc.h + ";--s:" + cc.s + '"></span>' +
      '<span class="tid">' + r.id + '</span><span class="iname">' + esc(r.task) + "</span>" +
      '<span class="ir" data-ir="' + r.id + '">' + (judgedId(r.id) ? '<span class="pendchip">reopening</span>' : "") + "</span></div>" +
      '<div class="det"><div class="meta">' + r.cat + " · closed " + r.done + "</div>" +
      '<div class="ed"><div class="stwrap"><span class="stlab">reopen as</span><span class="chip now">now Done</span>' +
      [1, 2, 3, 5].map((n) => '<div class="chip c' + n + (sD.st === n ? " on" : "") + '" data-st="' + r.id + '" data-v="' + n + '">' + STATUS[n] + "</div>").join("") +
      '</div><input class="clar" type="text" data-nt="' + r.id + '" placeholder="Why is it reopening? (optional)" value="' + escA(sD.nt) + '"></div></div></div>';
  });
}

/* ---- in-place updates. A judgment must never rebuild the element under the cursor:
   that was the vanishing-row bug. syncRow touches only the row's chrome (classes, the
   right-hand chip cluster, the quadrant label) — never the editor the click came from.
   List membership and ordering are deliberately NOT recomputed, so the list holds still
   while it is being judged; switching tab or reopening a card re-derives everything. ---- */
import { QNAME } from "../constants";
import { findRow } from "../data/registry";
import { eff } from "../derive/effective";
import { quadK } from "../derive/quadrant";
import { staleness } from "../derive/staleness";
import { dateChip, statusClass } from "../render/item";
import { updateChrome } from "../render/index";
import { save } from "../persist/store";
import { P, blank, judgedId, pend } from "./pending";

export function syncRow(id: string): void {
  const s = P[id] || blank();
  document.querySelectorAll<HTMLElement>('.item[data-id="' + id + '"]').forEach((it) => {
    const judged = judgedId(id);
    it.classList.toggle("judged", judged);
    it.classList.toggle("closing", s.st >= 4);
    const dt = it.querySelector('.done-t[data-done="' + id + '"]');
    if (dt) {
      dt.classList.toggle("on", s.st === 4);
      dt.classList.toggle("drop", s.st === 5);
    }
    const r = findRow(id);
    const ir = it.querySelector<HTMLElement>('.ir[data-ir="' + id + '"]');
    if (ir && r) {
      const e = eff(r);
      e.kind = r.kind;
      const st = staleness(r),
        sc = statusClass(e.st);
      ir.innerHTML =
        dateChip(e) +
        '<span class="mini ' + sc + '">' + e.st + "</span>" +
        (judged ? '<span class="pendchip">pending</span>' : "") +
        '<span class="stalechip' + (st.old ? " old" : "") + '">' + st.txt + "</span>";
    } else if (ir) {
      ir.innerHTML = judged ? '<span class="pendchip">reopening</span>' : "";
    }
    const qd = it.querySelector<HTMLElement>('.qd[data-qd="' + id + '"]');
    if (qd && r) {
      const k = quadK({ u: s.u || r.u, i: s.i || r.i });
      qd.className = "qd " + k;
      qd.dataset.qd = id;
      qd.textContent = QNAME[k];
    }
  });
}

/** Set (or, tapping the same chip again, unset) the pending status of a row. */
export function setSt(id: string, n: number): void {
  const s = pend(id);
  s.st = s.st === n ? 0 : n;
  save();
  document.querySelectorAll<HTMLElement>('.chip[data-st="' + id + '"]').forEach((c) => c.classList.toggle("on", +(c.dataset.v as string) === s.st));
  syncRow(id);
  updateChrome();
}

/* The shared row item — one line collapsed, everything on tap: full note, category, derived quadrant,
   recorded date, dated field with its type, blocker if any, the editor, and the copy button. */
import { CATS, FALLBACK_CAT, QNAME } from "../constants";
import type { Row } from "../data/types";
import { dstate } from "../derive/dates";
import { eff, type Eff } from "../derive/effective";
import { quadK } from "../derive/quadrant";
import { staleness } from "../derive/staleness";
import { hasKids } from "../derive/tree";
import { P, judgedId } from "../editor/pending";
import { view } from "../state";
import { editorHTML } from "./editor";
import { esc } from "./html";

export function dateChip(e: Eff): string {
  const d = dstate(e);
  if (!d) return "";
  const hard = e.ty === "DL" && e.kind === "hard" ? " · hard" : "";
  const inN = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : "in " + n + "d");
  switch (d.k) {
    case "overdue":
      return '<span class="mini od">' + (e.ty === "SB" ? "start-by " : "") + -d.n + "d overdue</span>";
    case "due":
      return '<span class="mini due">due ' + inN(d.n) + hard + "</span>";
    case "startby":
      return '<span class="mini due">start by ' + inN(d.n) + "</span>";
    case "started":
      return '<span class="mini so">started · SB ' + e.dl.slice(5) + "</span>";
    case "starts":
      return '<span class="mini so">starts today</span>';
    case "dormant":
      return '<span class="mini so">starts ' + inN(d.n) + "</span>";
    case "eligible":
      return '<span class="mini so">eligible ' + -d.n + "d</span>";
  }
  return "";
}

export function statusClass(st: string): string {
  return st === "Blocked" ? "stB" : st === "Active" ? "stA" : st === "Inbox" ? "stI" : "";
}

export interface ItemOpts {
  tree?: boolean;
  dot?: boolean;
  forceOpen?: boolean;
  stale?: boolean;
}

export function itemHTML(r: Row, opts?: ItemOpts): string {
  opts = opts || {};
  const cc = CATS[r.cat] || FALLBACK_CAT;
  const e = eff(r);
  e.kind = r.kind;
  const st = staleness(r);
  const ex = opts.forceOpen || view.expand[r.id];
  const jd = judgedId(r.id);
  const sc = statusClass(e.st);
  const kids = opts.tree && hasKids(r.id);
  return (
    '<div class="item' + (r.d && opts.tree ? " subrow" : "") + (ex ? " exp" : "") + (st.old ? " aged" : "") + (jd ? " judged" : "") + (e.closing ? " closing" : "") + '" data-id="' + r.id + '"' +
    ' style="--h:' + cc.h + ";--s:" + cc.s + '">' +
    '<div class="i1" data-tgl="' + r.id + '">' +
    (opts.tree ? (kids ? '<span class="chev" data-br="' + r.id + '">' + (view.branchClosed[r.id] ? "▸" : "▾") + "</span>" : '<span class="chev"></span>') : "") +
    (opts.dot ? '<span class="catdot" style="--h:' + cc.h + ";--s:" + cc.s + '"></span>' : "") +
    '<span class="done-t' + (P[r.id] && P[r.id].st === 4 ? " on" : "") + (P[r.id] && P[r.id].st === 5 ? " drop" : "") + '" data-done="' + r.id + '" title="Mark done — tap again to undo"></span>' +
    '<span class="tid">' + r.id + '</span><span class="iname">' + esc(r.task) + "</span>" +
    '<span class="ir" data-ir="' + r.id + '">' + dateChip(e) + '<span class="mini ' + sc + '">' + e.st + "</span>" +
    (jd ? '<span class="pendchip">pending</span>' : "") +
    (opts.stale !== false ? '<span class="stalechip' + (st.old ? " old" : "") + '">' + st.txt + "</span>" : "") +
    "</span></div>" +
    '<div class="det">' + (r.note ? esc(r.note) : "No note on this row.") +
    '<div class="meta">' + r.cat + " · now " + (r.u || "–") + "/" + (r.i || "–") + " · " + QNAME[quadK(r)] + " · recorded " + r.rec + (r.dl ? " · " + (r.ty || "DL") + " " + r.dl : "") + (r.blk ? " · waiting on " + esc(r.blk) : "") + "</div>" +
    editorHTML(r, e) +
    '<button class="copy" data-copy="' + r.id + '">Copy "' + r.id + ' (…)" for a chat</button></div></div>'
  );
}

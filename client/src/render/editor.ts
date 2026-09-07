/* editor — the triage controls, inside the expanded row: U and I strips, five explicit status chips
   with the row's present status as a dashed "now" marker, the date line with its DL / SO / SB type
   toggle (always visible in move mode, defaulting to DL), and the clarification field. */
import { MODES, QNAME, STATUS, TYNAME, TYPES } from "../constants";
import type { DateType, Row } from "../data/types";
import type { Eff } from "../derive/effective";
import { quadK } from "../derive/quadrant";
import { P, blank, dlValue } from "../editor/pending";
import { esc, escA } from "./html";

export function tyHint(t: DateType): string {
  return (
    TYNAME[t] +
    " — " +
    (t === "DL"
      ? "finish by this date"
      : t === "SO"
        ? "dormant until this date, never overdue"
        : "begin by this date; overdue only while Inbox or Planned")
  );
}

export function editorHTML(r: Row, _e: Eff): string {
  const s = P[r.id] || blank();
  const qk = quadK({ u: s.u || r.u, i: s.i || r.i });
  const curLab = r.dl ? r.ty || "DL" : "date";
  return (
    '<div class="ed">' +
    '<div class="ctrl"><div class="strip"><span class="axl">U</span>' +
    ["H", "M", "L"]
      .map((v) => '<div class="sq' + (s.u === v ? " on" : "") + '" data-id="' + r.id + '" data-ax="u" data-v="' + v + '">' + v + "</div>")
      .join("") +
    '</div><div class="strip"><span class="axl">I</span>' +
    ["H", "M", "L"]
      .map((v) => '<div class="sq' + (s.i === v ? " on" : "") + '" data-id="' + r.id + '" data-ax="i" data-v="' + v + '">' + v + "</div>")
      .join("") +
    '</div><span class="qd ' + qk + '" data-qd="' + r.id + '">' + QNAME[qk] + "</span></div>" +
    '<div class="stwrap"><span class="stlab">status</span><span class="chip now">now ' + esc(r.st) + "</span>" +
    [1, 2, 3, 4, 5]
      .map((n) => '<div class="chip c' + n + (s.st === n ? " on" : "") + '" data-st="' + r.id + '" data-v="' + n + '">' + (n === 4 ? "✓ " : "") + STATUS[n] + "</div>")
      .join("") +
    "</div>" +
    '<div class="dlline' + (s.dm === 1 ? " move" : "") + '" data-dlline="' + r.id + '"><span class="dllab">' + esc(curLab) + "</span>" +
    '<div class="dlmode' + (s.dm ? " m" + s.dm : "") + '" data-dm="' + r.id + '">' + MODES[s.dm] + "</div>" +
    '<div class="dlx">' +
    '<div class="tyg">' +
    TYPES.map((t) => '<div class="ty' + (s.ty === t ? " on" : "") + '" data-ty="' + r.id + '" data-v="' + t + '">' + t + "</div>").join("") +
    "</div>" +
    '<span class="numlab">M</span><input class="num" type="number" inputmode="numeric" min="0" max="12" data-id="' + r.id + '" data-f="m" value="' + s.m + '">' +
    '<span class="numlab">W</span><input class="num" type="number" inputmode="numeric" min="0" max="4" data-id="' + r.id + '" data-f="w" value="' + s.w + '">' +
    '<span class="numlab">D</span><input class="num" type="number" inputmode="numeric" min="0" max="31" data-id="' + r.id + '" data-f="d" value="' + s.d + '">' +
    '<span class="arrow">→</span><input class="dlpick" type="date" data-id="' + r.id + '" value="' + dlValue(s) + '">' +
    '<span class="tyhint" data-tyh="' + r.id + '">' + tyHint(s.ty) + "</span></div></div>" +
    '<input class="clar" type="text" data-nt="' + r.id + '" placeholder="Clarification (optional) — travels with the results" value="' + escA(s.nt) + '">' +
    "</div>"
  );
}

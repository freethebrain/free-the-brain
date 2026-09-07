/* ---- persistence: unsent judgments survive a reopen; keyed by the staging stamp so a fresh instance
   never inherits stale ones. Falls back to session memory where the viewer blocks local storage. ---- */
import { REG } from "../data/registry";
import { P, blank, judgedId } from "../editor/pending";
import { view } from "../state";

export const STORE_PREFIX = "pto-master-pending::";
export function storeKey(): string {
  return STORE_PREFIX + REG.STAMP;
}

let storeOK = true;
export function storageAvailable(): boolean {
  return storeOK;
}

export function save(): void {
  if (!storeOK) return;
  try {
    localStorage.setItem(
      storeKey(),
      JSON.stringify({ P: P, capVals: view.capVals, extra: view.extra, ts: new Date().toISOString() }),
    );
  } catch (e) {
    storeOK = false;
    setNotice("Local storage is not available in this viewer — judgments are kept for this session only.", false);
  }
}

export function restore(): void {
  try {
    const raw = localStorage.getItem(storeKey());
    if (!raw) return;
    const o = JSON.parse(raw);
    Object.keys(o.P || {}).forEach((k) => {
      P[k] = Object.assign(blank(), o.P[k]);
    });
    view.capVals = o.capVals || [];
    view.extra = o.extra || [];
    const n = Object.keys(P).filter(judgedId).length + view.capVals.filter((v) => v && v.trim()).length;
    if (n)
      setNotice(
        "Restored <b>" + n + "</b> unsent judgment" + (n > 1 ? "s" : "") + " from " + (o.ts || "").replace("T", " ").slice(0, 16) + ".",
        true,
      );
  } catch (e) {
    storeOK = false;
  }
}

export function setNotice(html: string, withClear: boolean): void {
  const el = document.getElementById("notice") as HTMLElement;
  el.className = "notice on";
  el.innerHTML = "<span>" + html + "</span>" + (withClear ? '<button class="tbtn" id="noticeclear">Clear them</button>' : "");
}
export function hideNotice(): void {
  (document.getElementById("notice") as HTMLElement).className = "notice";
}

/** Forget every pending judgment and capture, in memory and in storage. Does not touch the DOM. */
export function forgetPending(): void {
  Object.keys(P).forEach((k) => delete P[k]);
  view.capVals = [];
  view.extra = [];
  try {
    localStorage.removeItem(storeKey());
  } catch (e) {
    /* nothing to remove, or storage blocked */
  }
}

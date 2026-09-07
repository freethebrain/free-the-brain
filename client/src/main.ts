/* Boot and events. Event delegation on document, keyed by the template's data-attributes, so the
   editor controls work inside any row on any tab without per-element listeners. */
import "./styles.css";
import { CAPS, MODES, type TabId } from "./constants";
import { loadRegistry, pickMode, type Mode } from "./data/loader";
import { REG, findRow, setRegistry } from "./data/registry";
import { offsetDate } from "./derive/dates";
import { pend } from "./editor/pending";
import { setSt, syncRow } from "./editor/sync";
import { forgetPending, hideNotice, restore, save, setNotice } from "./persist/store";
import { render, updateChrome } from "./render/index";
import { tyHint } from "./render/editor";
import { buildResults, countJudgments } from "./results/build";
import { NOTE_RECORDED, copyText, setCopyState, setExportNote, showExportPanel, submitResults } from "./results/send";
import { view } from "./state";
import {
  applyStatusBar,
  consumeSharedText,
  hideSplash,
  onSharedText,
  rescheduleDeadlineNotifications,
  successFeedback,
  tapFeedback,
  watchTheme,
} from "./native/index";

const $ = (id: string) => document.getElementById(id) as HTMLElement;
let mode: Mode = pickMode();

function clearAll(): void {
  forgetPending();
  hideNotice();
  $("exp").style.display = "none";
  $("quickstate").textContent = "";
  render();
}

function addRow(): void {
  const box = $("addbox") as HTMLInputElement | null,
    v = box ? box.value.trim() : "";
  view.extra.push("T-" + String(REG.NEXTNUM + view.extra.length).padStart(3, "0"));
  if (v) view.capVals[REG.RESERVED.length + view.extra.length - 1] = v;
  save();
  render();
}

/* One capture store, reached three ways: the Triage tab's rows, the share sheet, and the "+ Capture"
   box in the controls row. Text lands in the first empty capture slot — reserved IDs first, then
   extras — and is recorded only when he sends, like any other capture. Returns the slot index. */
function captureInto(text: string): number {
  const ids = REG.RESERVED.concat(view.extra);
  let n = ids.findIndex((_id, i) => !(view.capVals[i] && view.capVals[i].trim()));
  if (n < 0) {
    view.extra.push("T-" + String(REG.NEXTNUM + view.extra.length).padStart(3, "0"));
    n = ids.length;
  }
  view.capVals[n] = text;
  save();
  return n;
}

/* Text shared into the app (Android share sheet) lands in a capture row on the Triage tab. */
function prefillCapture(text: string): void {
  const n = captureInto(text);
  view.tab = "triage";
  render();
  const box = document.querySelector<HTMLInputElement>('[data-cap="' + n + '"]');
  if (box) box.focus();
}

/* The one-tap capture box: reachable on every tab, one input, Enter adds a row. The tab does not
   change — capture must cost one line and nothing else. */
function toggleQuickCapture(): void {
  const box = $("quickcap");
  const on = box.style.display !== "flex";
  box.style.display = on ? "flex" : "none";
  $("capbtn").classList.toggle("on", on);
  if (on) ($("quickbox") as HTMLInputElement).focus();
}

function quickCapture(): void {
  const input = $("quickbox") as HTMLInputElement;
  const v = input.value.trim();
  if (!v) return;
  const n = captureInto(v);
  const id = REG.RESERVED.concat(view.extra)[n];
  input.value = "";
  $("quickstate").textContent = id + " captured · pending until sent";
  tapFeedback();
  if (view.tab === "triage") render();
  else updateChrome();
  input.focus();
}

/* After every registry load the phone's reminders are re-derived from the rows (no-op on the web). */
function afterRegistryLoad(): void {
  void rescheduleDeadlineNotifications(REG.ROWS, REG.TODAY);
}

/* ---- events ---- */
document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const cp = t.closest<HTMLElement>(".copy");
  if (cp) {
    const id = cp.dataset.copy as string;
    const r = findRow(id);
    const txt = id + " (" + (r ? r.task : "") + ")";
    const ta = document.createElement("textarea");
    ta.value = txt;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (err) {
      /* execCommand unavailable */
    }
    document.body.removeChild(ta);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(txt)
        .then(() => {
          cp.textContent = "Copied ✓";
        })
        .catch(() => {
          cp.textContent = ok ? "Copied ✓" : "Copy blocked — long-press the ID above";
        });
    } else cp.textContent = ok ? "Copied ✓" : "Copy blocked — long-press the ID above";
    setTimeout(() => {
      cp.textContent = 'Copy "' + id + ' (…)" for a chat';
    }, 1600);
    return;
  }
  const sq = t.closest<HTMLElement>(".sq");
  if (sq) {
    const id = sq.dataset.id as string,
      ax = sq.dataset.ax as "u" | "i",
      v = sq.dataset.v as "H" | "M" | "L",
      s = pend(id);
    s[ax] = s[ax] === v ? null : v;
    tapFeedback();
    save();
    (sq.parentNode as HTMLElement).querySelectorAll<HTMLElement>(".sq").forEach((x) => x.classList.toggle("on", x.dataset.v === s[ax]));
    syncRow(id);
    updateChrome();
    return;
  }
  const chip = t.closest<HTMLElement>(".chip[data-st]");
  if (chip) {
    tapFeedback();
    setSt(chip.dataset.st as string, +(chip.dataset.v as string));
    return;
  }
  const dtg = t.closest<HTMLElement>(".done-t");
  if (dtg) {
    tapFeedback();
    setSt(dtg.dataset.done as string, 4);
    return;
  }
  const dm = t.closest<HTMLElement>(".dlmode");
  if (dm) {
    const id = dm.dataset.dm as string,
      s = pend(id);
    s.dm = (s.dm + 1) % 3;
    tapFeedback();
    save();
    dm.textContent = MODES[s.dm];
    dm.className = "dlmode" + (s.dm ? " m" + s.dm : "");
    const ln = document.querySelector('.dlline[data-dlline="' + id + '"]');
    if (ln) ln.classList.toggle("move", s.dm === 1);
    syncRow(id);
    updateChrome();
    return;
  }
  const ty = t.closest<HTMLElement>(".ty");
  if (ty) {
    const id = ty.dataset.ty as string,
      s = pend(id);
    s.ty = ty.dataset.v as "DL" | "SO" | "SB";
    tapFeedback();
    save();
    (ty.parentNode as HTMLElement).querySelectorAll<HTMLElement>(".ty").forEach((x) => x.classList.toggle("on", x.dataset.v === s.ty));
    const h = document.querySelector('.tyhint[data-tyh="' + id + '"]');
    if (h) h.textContent = tyHint(s.ty);
    syncRow(id);
    updateChrome();
    return;
  }
  if (t.closest(".ed")) return; /* clicks inside the editor never toggle the row */
  const br = t.closest<HTMLElement>(".chev[data-br]");
  if (br) {
    const id = br.dataset.br as string;
    view.branchClosed[id] = !view.branchClosed[id];
    render();
    return;
  }
  const tg = t.closest<HTMLElement>("[data-tgl]");
  if (tg && view.tab !== "triage") {
    const id = tg.dataset.tgl as string;
    view.expand[id] = !view.expand[id];
    const it = tg.closest(".item");
    if (it) it.classList.toggle("exp", !!view.expand[id]);
    return;
  }
  const ch = t.closest<HTMLElement>(".chead");
  if (ch) {
    const cat = ch.dataset.cat as string;
    view.cardOpen[cat] = !view.cardOpen[cat];
    render();
    return;
  }
  const tb = t.closest<HTMLElement>(".tab");
  if (tb) {
    view.tab = tb.dataset.tab as TabId;
    render();
    return;
  }
  if (t.id === "prevchunk") {
    view.chunkIdx = Math.max(0, view.chunkIdx - 1);
    render();
    return;
  }
  if (t.id === "nextchunk") {
    view.chunkIdx++;
    render();
    return;
  }
  if (t.id === "hidejudged") {
    view.hideJudged = !view.hideJudged;
    render();
    return;
  }
  if (t.id === "addbtn") {
    addRow();
    return;
  }
  if (t.id === "capbtn") {
    toggleQuickCapture();
    return;
  }
  if (t.id === "noticeclear") {
    clearAll();
    return;
  }
});

document.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.cap !== undefined) {
    view.capVals[+t.dataset.cap] = t.value;
    save();
    updateChrome();
    return;
  }
  if (t.dataset.nt !== undefined) {
    pend(t.dataset.nt).nt = t.value;
    save();
    syncRow(t.dataset.nt);
    updateChrome();
    return;
  }
  if (t.classList.contains("dlpick")) {
    const id = t.dataset.id as string;
    const s = pend(id);
    if (t.value) {
      s.abs = t.value;
      s.m = 0;
      s.w = 0;
      s.d = 0;
      const bx = t.closest(".dlline") as HTMLElement;
      (["m", "w", "d"] as const).forEach((f) => {
        const el = bx.querySelector<HTMLInputElement>('[data-f="' + f + '"]');
        if (el) el.value = "0";
      });
    }
    save();
    syncRow(id);
    updateChrome();
    return;
  }
  if (t.dataset.f) {
    const id = t.dataset.id as string;
    const s = pend(id),
      f = t.dataset.f as "m" | "w" | "d";
    let v = parseInt(t.value, 10);
    if (isNaN(v) || v < 0) v = 0;
    if (v > CAPS[f]) v = CAPS[f];
    s[f] = v;
    s.abs = null;
    const pick = (t.closest(".dlline") as HTMLElement).querySelector<HTMLInputElement>(".dlpick");
    if (pick) pick.value = offsetDate(s.m, s.w, s.d);
    if (String(v) !== t.value) t.value = String(v);
    save();
    syncRow(id);
    updateChrome();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const id = (e.target as HTMLElement).id;
  if (id === "addbox") addRow();
  if (id === "quickbox") quickCapture();
});

$("subtoggle").onclick = () => {
  view.hideSubs = !view.hideSubs;
  render();
};
$("clearbtn").onclick = () => {
  if (confirm("Discard every unsent judgment and capture in this widget?")) clearAll();
};
$("q").addEventListener("input", render);

/* Send results: the export panel always; the service first when in api mode. */
$("sendbtn").onclick = async () => {
  const txt = buildResults();
  const exp = showExportPanel(txt);
  if (exp.scrollIntoView) exp.scrollIntoView({ behavior: "smooth", block: "start" });
  if (mode !== "api" || countJudgments() === 0) {
    copyText(txt);
    return;
  }
  setCopyState("Sending to the registry service…");
  const btn = $("sendbtn") as HTMLButtonElement;
  btn.disabled = true;
  const out = await submitResults(txt);
  btn.disabled = false;
  if (out.ok) {
    let line = "Recorded " + out.applied + " judgment" + (out.applied === 1 ? "" : "s") + " · delta " + (out.stamp || "(no stamp returned)");
    if (out.rejected.length) line += " · " + out.rejected.length + " rejected: " + out.rejected.map((x) => x.id + " (" + x.reason + ")").join(", ");
    forgetPending();
    hideNotice();
    successFeedback();
    try {
      setRegistry(await loadRegistry(mode));
      setProvenance();
      afterRegistryLoad();
    } catch (e) {
      line += " · reload failed: " + ((e as Error).message || String(e));
    }
    render();
    setCopyState(line);
    setExportNote(NOTE_RECORDED);
  } else {
    /* Never lose judgments on a failed send: the store is untouched; hand the text over by clipboard instead. */
    copyText(txt, "Send failed — " + (out.error || "unknown error") + ". Judgments kept. ");
  }
};
$("copybtn").onclick = () => {
  copyText(($("exptext") as HTMLTextAreaElement).value);
};

function setProvenance(): void {
  $("prov").textContent =
    "Staged from Task Registry — " + REG.STAMP + " · judgments are pending until sent" + (mode === "api" ? " · live" : " · fixture");
}

async function boot(): Promise<void> {
  try {
    setRegistry(await loadRegistry(mode));
  } catch (e) {
    if (mode === "api") {
      /* An unreachable service is not a reason to show nothing: fall back to the fixture and say so. */
      mode = "fixture";
      setRegistry(await loadRegistry(mode));
      setNotice("The registry service could not be reached (" + ((e as Error).message || String(e)) + ") — showing the fixture instead.", false);
    } else throw e;
  }
  setProvenance();
  restore();
  render();
  document.body.dataset.ready = "1";
  /* Native shell (every call is a no-op on the web): splash off once something is on screen, status
     bar icons matched to the theme, reminders re-derived, and any text the app was opened with by
     the share sheet placed in a capture row. */
  hideSplash();
  applyStatusBar();
  watchTheme();
  afterRegistryLoad();
  const shared = await consumeSharedText();
  if (shared) prefillCapture(shared);
  onSharedText(prefillCapture);
}

boot().catch((e) => {
  $("host").innerHTML = '<div class="empty">Could not load the registry: ' + String((e as Error).message || e) + "</div>";
});

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js").catch(() => {
      /* the app works without the service worker */
    });
  });
}

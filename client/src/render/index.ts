/* The full render: tab bar, the active tab into #host, then the summary line, hint and toolbar chrome.
   A full render is the ONLY place list membership and ordering recompute — never from inside a
   judgment (see editor/sync.ts). */
import { HINTS, TABS } from "../constants";
import { REG } from "../data/registry";
import { inFortnight, isOverdue } from "../derive/dates";
import { eff } from "../derive/effective";
import { buildQueue } from "../derive/queue";
import { pendingCount } from "../editor/pending";
import { view } from "../state";
import { renderDone } from "./done";
import { renderEisen } from "./eisenhower";
import { renderPortfolio } from "./portfolio";
import { renderRadar } from "./radar";
import { renderTriage } from "./triage";
import { renderWait } from "./waiting";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

/** Capture rows with something written in them. */
export function captureCount(): number {
  return REG.RESERVED.concat(view.extra).filter((_id, n) => view.capVals[n] && view.capVals[n].trim()).length;
}

/** The parts of the chrome that a judgment changes: summary line, Send count, Clear visibility. */
export function updateChrome(): void {
  const pendN = pendingCount();
  const od = REG.ROWS.filter((r) => isOverdue(eff(r))).length;
  const t14 = REG.ROWS.filter((r) => inFortnight(eff(r))).length;
  const blocked = REG.ROWS.filter((r) => eff(r).st === "Blocked").length;
  $("sum").innerHTML =
    "<b>" + REG.ROWS.length + "</b> open · <b>" + od + "</b> overdue · <b>" + t14 + "</b> dated within 14 days · <b>" + blocked + "</b> waiting on others" +
    (pendN ? ' · <b class="pend">' + pendN + '</b> <span class="pend">judged this session, unsent</span>' : "");
  const capN = captureCount();
  $("sendn").textContent = pendN + capN ? String(pendN + capN) : "";
  $("clearbtn").style.display = pendN + capN ? "" : "none";
}

export function render(): void {
  const q = ($("q") as HTMLInputElement).value.trim().toLowerCase();
  const tb = $("tabbar");
  tb.innerHTML = "";
  TABS.forEach((t) => {
    const b = document.createElement("div");
    b.className = "tab" + (t[0] === "triage" ? " triage" : "") + (view.tab === t[0] ? " on" : "");
    b.dataset.tab = t[0];
    const n: number | "" =
      t[0] === "done"
        ? REG.DONE.length
        : t[0] === "wait"
          ? REG.ROWS.filter((r) => eff(r).st === "Blocked").length
          : t[0] === "portfolio"
            ? REG.ROWS.length
            : t[0] === "triage"
              ? buildQueue().length
              : "";
    b.innerHTML = t[1] + (n !== "" ? '<span class="n">' + n + "</span>" : "");
    tb.appendChild(b);
  });
  const host = $("host");
  host.innerHTML = "";
  if (view.tab === "portfolio") renderPortfolio(host, q);
  else if (view.tab === "radar") renderRadar(host, q);
  else if (view.tab === "eisen") renderEisen(host, q);
  else if (view.tab === "wait") renderWait(host, q);
  else if (view.tab === "done") renderDone(host, q);
  else renderTriage(host, q);
  updateChrome();
  $("hint").textContent = HINTS[view.tab];
  const st = $("subtoggle");
  st.className = "tbtn" + (view.hideSubs ? " on" : "");
  st.textContent = view.hideSubs ? "Show subtasks" : "Hide subtasks";
  st.style.display = view.tab === "triage" ? "none" : "";
}

/* Triage — the standing queue, five branches at a time, in the five-tier sort order, with
   Prev / Next chunk. Capture rows with reserved IDs sit at its foot. */
import { CHUNK, TIERS } from "../constants";
import { REG } from "../data/registry";
import { cycleMonday } from "../derive/dates";
import { buildQueue, judgedThisCycle, type QueueEntry } from "../derive/queue";
import { match } from "../derive/tree";
import { judgedId } from "../editor/pending";
import { view } from "../state";
import { escA } from "./html";
import { itemHTML } from "./item";

export function renderTriage(host: HTMLElement, q: string): void {
  const MONDAY = cycleMonday();
  const Q = buildQueue();
  const chunks: QueueEntry[][] = [];
  for (let i = 0; i < Q.length; i += CHUNK) chunks.push(Q.slice(i, i + CHUNK));
  if (view.chunkIdx >= chunks.length) view.chunkIdx = Math.max(0, chunks.length - 1);
  const leg = document.createElement("p");
  leg.className = "legend";
  leg.innerHTML =
    "<b>Sort order:</b> " +
    [1, 2, 3, 4, 5].map((t) => TIERS[t]).join(" &nbsp;·&nbsp; ") +
    ". Rows judged since Monday " + MONDAY.slice(5) +
    " are out of the queue. A branch is one entry; a partially judged branch re-enters for its unjudged rows.";
  host.appendChild(leg);
  const cyc = judgedThisCycle();
  const sessJ = Q.filter((en) => en.rows.some((r) => judgedId(r.id))).length;
  const nav = document.createElement("div");
  nav.className = "chunknav";
  nav.innerHTML =
    '<button class="tbtn" id="prevchunk"' + (view.chunkIdx === 0 ? " disabled" : "") + ">‹ Prev</button>" +
    '<span class="lab">Chunk ' + (chunks.length ? view.chunkIdx + 1 : 0) + " of " + chunks.length + "</span>" +
    '<button class="tbtn" id="nextchunk"' + (view.chunkIdx >= chunks.length - 1 ? " disabled" : "") + ">Next chunk ›</button>" +
    '<span class="sub">' + Q.length + " entries in the queue · " + cyc + " branches judged this cycle · " + sessJ + " touched this session</span>" +
    '<button class="tbtn' + (view.hideJudged ? " on" : "") + '" id="hidejudged">' + (view.hideJudged ? "Show judged" : "Hide judged") + "</button>";
  host.appendChild(nav);
  const ch = chunks[view.chunkIdx] || [];
  let lastTier: number | null = null;
  let wrap: HTMLDivElement | null = null;
  let shown = 0;
  ch.forEach((en) => {
    if (view.hideJudged && judgedId(en.top.id)) return;
    const rows = en.rows.filter((r) => match(r, q));
    if (!rows.length) return;
    if (en.key[0] !== lastTier) {
      lastTier = en.key[0];
      const lab = document.createElement("div");
      lab.className = "seclabel";
      lab.textContent = TIERS[lastTier];
      host.appendChild(lab);
      wrap = document.createElement("div");
      wrap.className = "flat";
      host.appendChild(wrap);
    }
    (wrap as HTMLDivElement).innerHTML += rows.map((r) => itemHTML(r, { tree: true, forceOpen: true })).join("");
    shown++;
  });
  if (!shown) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = chunks.length ? "Every entry in this chunk is judged — take the next one." : "The queue is empty for this cycle.";
    host.appendChild(e);
  }
  const cap = document.createElement("div");
  cap.className = "capbox";
  cap.innerHTML =
    '<div class="shead">Capture <span class="c">· reserved IDs, consumed only if you write something</span></div>' +
    REG.RESERVED.concat(view.extra)
      .map((id, n) => '<div class="caprow"><span class="capid">' + id + '</span><input type="text" data-cap="' + n + '" placeholder="New task…" value="' + escA(view.capVals[n] || "") + '"></div>')
      .join("") +
    '<div class="addrow"><input type="text" id="addbox" placeholder="Another capture row…"><button class="tbtn" id="addbtn">Add</button></div>';
  host.appendChild(cap);
}

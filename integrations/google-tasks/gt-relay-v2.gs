/**
 * GT relay v2 — Google Tasks ⇄ Task Registry
 * 2026-09-07 · for FtB's Personal Task Organization system · owner row T-094.
 * Revises v1 (2026-09-03) per the Free the Brain production plan and its reassessment.
 *
 * TWO LANES, each with a pluggable endpoint so the Registry Service can replace Drive without
 * touching the Google Tasks side:
 *
 *   INBOUND   Google Tasks (the list Gemini dictates into) ──► registry capture
 *             target "drive"   : writes  GT Inbox — YYYY-MM-DD-HHMM.md  into the Task Registry folder;
 *                                Claude ingests it per the Capture Protocol addendum.
 *             target "service" : POSTs the same rows to the Registry Service capture endpoint
 *                                with source "gtasks" — Inbox rows only, no scores, covenant-safe.
 *
 *   OUTBOUND  registry rows carrying a date ──► a SEPARATE Google Tasks list, so they surface in
 *             Google Calendar's task lane.
 *             source "drive"   : reads the newest  GT Outbox — YYYY-MM-DD-HHMM.md  (written by Claude,
 *                                full state of every open dated row).
 *             source "service" : GETs the radar/dated-rows endpoint of the Registry Service.
 *             Upserts one task per T-id (title "T-nnn · name", due = the date, notes carry pto:T-nnn).
 *             A row that leaves the set (closed, undated, dropped) has its task marked completed.
 *
 * LOOP GUARD — the two lanes never touch the same list. Inbound reads ONLY the dictation list and
 * additionally skips anything whose notes contain "pto:". Outbound writes ONLY the deadlines list.
 * A misconfiguration that makes the two lists identical throws before anything runs.
 *
 * MODE is cursor: inbound tasks are left exactly as dictated; the script remembers which IDs it has
 * exported. Nothing is ever deleted, in Google Tasks or in Drive.
 *
 * Durability order: the Drive file (or the service call) succeeds BEFORE any cursor is advanced.
 *
 * Run by hand, once, in this order:  discoverLists()  →  set CONFIG.SOURCE_LIST  →  testRun()  →
 *                                    relay()  →  installTrigger()  →  status()
 * Setup: Apps Script editor → Services (+) → Tasks API. Secrets (service URL, token) go into
 * Project Settings → Script Properties, never into this file.
 */

const CONFIG = {
  FOLDER_ID: "1yZabLPGJAkxeu748rA89swQLDoFuMRu8",   // Task Registry folder — the archive, per the plan
  TZ: "Europe/Sofia",

  SOURCE_LIST: "",              // the list Gemini dictates into — run discoverLists() and set the EXACT title
  OUTBOUND_LIST: "PTO deadlines", // created if missing; the reverse lane writes here and only here

  INBOUND_TARGET: "drive",      // "drive" now · "service" after the flip
  OUTBOUND_SOURCE: "drive",     // "drive" now · "service" after the flip

  INBOX_PREFIX: "GT Inbox — ",  // never starts with "Task Registry" or "Registry Delta"
  OUTBOX_PREFIX: "GT Outbox — ",

  MAX_TASKS: 100,
  TRIGGER_MINUTES: 15,
  ALERT_ON_ERROR: true
};

// Script Properties keys (set in the editor, not here): SERVICE_BASE_URL, SERVICE_TOKEN
// Service endpoints, BY ROLE — the executor verifies the real paths in service/ before switching:
const SERVICE = {
  capturePath: "/capture",      // POST  { rows:[{task, notes, source:"gtasks", actor:"gt-relay"}] }
  datedRowsPath: "/radar"       // GET   → [{ id, task, deadline, deadline_type, status }]  (open rows with a date)
};

// ================================================================ entry points

function relay() {
  const errors = [];
  let inSummary = "", outSummary = "";
  try { inSummary = inbound_(false).summary; } catch (e) { errors.push("INBOUND: " + (e.stack || e)); }
  try { outSummary = outbound_(false).summary; } catch (e) { errors.push("OUTBOUND: " + (e.stack || e)); }
  props_().setProperty("last_run", stamp_());
  const report = ["in:  " + (inSummary || "failed"), "out: " + (outSummary || "failed")].join("\n");
  Logger.log(report);
  if (errors.length) {
    const msg = "GT relay v2 — errors at " + stamp_() + "\n\n" + errors.join("\n\n");
    Logger.log(msg);
    if (CONFIG.ALERT_ON_ERROR) MailApp.sendEmail(Session.getEffectiveUser().getEmail(), "GT relay error", msg);
    throw new Error(errors.join(" | "));
  }
  return report;
}

function testRun() {
  guardLists_();
  const a = inbound_(true), b = outbound_(true);
  const s = ["DRY RUN", "in:  " + a.summary, a.preview ? a.preview : "", "out: " + b.summary, b.preview ? b.preview : ""].filter(Boolean).join("\n");
  Logger.log(s);
  return s;
}

function discoverLists() {
  const lists = Tasks.Tasklists.list().items || [];
  const out = ["Google Tasks lists on this account (" + lists.length + "):"];
  lists.forEach(l => {
    const res = Tasks.Tasks.list(l.id, { showCompleted: false, showHidden: false, maxResults: 50 });
    const items = (res.items || []).filter(t => t.title && t.title.trim());
    items.sort((x, y) => (y.updated || "").localeCompare(x.updated || ""));
    out.push("");
    out.push('• "' + l.title + '" — ' + items.length + " open · newest: " + items.slice(0, 3).map(t => '"' + t.title + '" (' + (t.updated || "").slice(0, 10) + ")").join(", "));
  });
  out.push("");
  out.push('Set CONFIG.SOURCE_LIST to the exact title of the list Gemini dictates into. It must NOT be "' + CONFIG.OUTBOUND_LIST + '".');
  const s = out.join("\n");
  Logger.log(s);
  return s;
}

function status() {
  const p = props_();
  const map = JSON.parse(p.getProperty("outbound_map") || "{}");
  const s = [
    "inbound: " + (CONFIG.SOURCE_LIST || "(UNSET — run discoverLists)") + " → " + CONFIG.INBOUND_TARGET,
    "outbound: " + CONFIG.OUTBOUND_SOURCE + " → list \"" + CONFIG.OUTBOUND_LIST + "\"",
    "last run: " + (p.getProperty("last_run") || "never"),
    "last inbound export: " + (p.getProperty("last_inbound") || "never") + " · file: " + (p.getProperty("last_inbox_file") || "none"),
    "inbound IDs remembered: " + JSON.parse(p.getProperty("exported_ids") || "[]").length,
    "last outbox processed: " + (p.getProperty("last_outbox_stamp") || "none") + " · rows mirrored: " + Object.keys(map).length,
    "trigger installed: " + (ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === "relay") ? "yes" : "no")
  ].join("\n");
  Logger.log(s);
  return s;
}

function installTrigger() {
  guardLists_();
  if (!CONFIG.SOURCE_LIST) throw new Error("CONFIG.SOURCE_LIST is unset — run discoverLists() first.");
  uninstallTrigger();
  ScriptApp.newTrigger("relay").timeBased().everyMinutes(CONFIG.TRIGGER_MINUTES).create();
  const s = "Trigger installed: relay() every " + CONFIG.TRIGGER_MINUTES + " minutes.";
  Logger.log(s);
  return s;
}

function uninstallTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "relay").forEach(t => ScriptApp.deleteTrigger(t));
}

// ================================================================ inbound lane

function inbound_(dryRun) {
  guardLists_();
  if (!CONFIG.SOURCE_LIST) return { summary: "skipped — CONFIG.SOURCE_LIST is unset (run discoverLists)" };
  const props = props_();
  const listId = listIdByTitle_(CONFIG.SOURCE_LIST, false);
  const exported = new Set(JSON.parse(props.getProperty("exported_ids") || "[]"));
  const all = listOpenTasks_(listId).filter(t => !/pto:/i.test(t.notes || ""));   // loop guard
  const fresh = all.filter(t => !exported.has(t.id));
  if (!fresh.length) return { summary: "nothing new (" + all.length + " open in the list)" };

  const stamp = stamp_();
  const rows = fresh.map(t => ({
    gtId: t.id, title: clean_(t.title), seen: (t.updated || "").slice(0, 10),
    due: t.due ? t.due.slice(0, 10) : "", parent: t.parent || "", notes: clean_(t.notes || "")
  }));

  if (dryRun) return { summary: "would export " + rows.length + " task(s) via " + CONFIG.INBOUND_TARGET, preview: renderInbox_(rows, stamp) };

  let where;
  if (CONFIG.INBOUND_TARGET === "service") {
    where = postToService_(SERVICE.capturePath, { rows: rows.map(r => ({
      task: r.title, source: "gtasks", actor: "gt-relay",
      notes: "dictated via Gemini · gt:" + r.gtId + " · seen " + r.seen + (r.due ? " · gt-due " + r.due : "") + (r.notes ? " · " + r.notes : "")
    })) });
  } else {
    const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
    let name = CONFIG.INBOX_PREFIX + stamp + ".md";
    if (folder.getFilesByName(name).hasNext()) name = CONFIG.INBOX_PREFIX + stamp + "-b.md";
    folder.createFile(name, renderInbox_(rows, stamp), MimeType.PLAIN_TEXT);
    where = name;
    props.setProperty("last_inbox_file", name);
  }
  // cursor advances only after the write succeeded
  fresh.forEach(t => exported.add(t.id));
  props.setProperty("exported_ids", JSON.stringify(Array.from(exported).slice(-2000)));
  props.setProperty("last_inbound", stamp);
  return { summary: "exported " + rows.length + " task(s) → " + where };
}

function renderInbox_(rows, stamp) {
  const L = [];
  L.push("# GT Inbox — " + stamp);
  L.push('Source: Google Tasks list "' + CONFIG.SOURCE_LIST + '" · relay v2 · mode: cursor');
  L.push("Written by: Apps Script relay running as " + Session.getEffectiveUser().getEmail() + ". Clock source: script, " + CONFIG.TZ + ".");
  L.push("Ingest rule: each line becomes one capture row — Status=Inbox, Recorded=the ingesting session's date, Notes carry the gt: id and the seen date; gt-due becomes a DL marked self-imposed unless the text says otherwise; gt-parent makes a dotted subtask of the row captured from that parent. Record this file's stamp in the ingesting delta so it is never ingested twice.");
  L.push("");
  L.push("## TASKS (" + rows.length + ")");
  rows.forEach(r => {
    const p = ["[gt:" + r.gtId + "]", r.title, "seen=" + r.seen];
    if (r.due) p.push("gt-due=" + r.due);
    if (r.parent) p.push("gt-parent=" + r.parent);
    if (r.notes) p.push("notes=" + r.notes);
    L.push("- " + p.join(" | "));
  });
  L.push("");
  return L.join("\n");
}

// ================================================================ outbound lane

function outbound_(dryRun) {
  guardLists_();
  const props = props_();
  let rows, sourceStamp;
  if (CONFIG.OUTBOUND_SOURCE === "service") {
    rows = getFromService_(SERVICE.datedRowsPath).map(r => ({ id: r.id, task: r.task, type: r.deadline_type || "DL", date: (r.deadline || "").slice(0, 10), status: r.status }))
                .filter(r => r.date && !/^(Done|Dropped)$/.test(r.status));
    sourceStamp = "service " + stamp_();
  } else {
    const f = newestOutbox_();
    if (!f) return { summary: "no GT Outbox file yet — nothing to mirror" };
    sourceStamp = f.stamp;
    if (!dryRun && props.getProperty("last_outbox_stamp") === f.stamp) return { summary: "outbox " + f.stamp + " already mirrored" };
    rows = parseOutbox_(f.file.getBlob().getDataAsString("UTF-8"));
  }

  const map = JSON.parse(props.getProperty("outbound_map") || "{}");   // T-id → gtask id
  const want = {}; rows.forEach(r => { want[r.id] = r; });
  const toUpsert = rows, toComplete = Object.keys(map).filter(id => !want[id]);

  if (dryRun) {
    return { summary: "would mirror " + toUpsert.length + " dated row(s) from " + sourceStamp + ", complete " + toComplete.length + " that left the set",
             preview: toUpsert.slice(0, 15).map(r => "  " + outTitle_(r) + " → due " + r.date).join("\n") + (toUpsert.length > 15 ? "\n  …" : "") };
  }

  const listId = listIdByTitle_(CONFIG.OUTBOUND_LIST, true);
  let upserted = 0, completed = 0;
  toUpsert.forEach(r => {
    const body = { title: outTitle_(r), due: r.date + "T00:00:00.000Z", status: "needsAction",
                   notes: "pto:" + r.id + " · " + r.type + " " + r.date + " · " + r.status + " · mirrored from " + sourceStamp + "\nDo not edit here — the registry is the source." };
    if (map[r.id]) {
      try { Tasks.Tasks.patch(body, listId, map[r.id]); upserted++; return; } catch (e) { /* task gone — recreate below */ }
    }
    const created = Tasks.Tasks.insert(body, listId);
    map[r.id] = created.id; upserted++;
  });
  toComplete.forEach(id => {
    try { Tasks.Tasks.patch({ status: "completed" }, listId, map[id]); } catch (e) { /* already gone */ }
    delete map[id]; completed++;
  });
  props.setProperty("outbound_map", JSON.stringify(map));
  props.setProperty("last_outbox_stamp", sourceStamp);
  return { summary: "mirrored " + upserted + " dated row(s) from " + sourceStamp + ", completed " + completed };
}

function outTitle_(r) {
  const pre = r.type === "SB" ? "start by · " : r.type === "SO" ? "start on · " : "";
  return pre + r.id + " · " + r.task;
}

function newestOutbox_() {
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const it = folder.getFiles();
  let best = null;
  while (it.hasNext()) {
    const f = it.next(), n = f.getName();
    if (n.indexOf(CONFIG.OUTBOX_PREFIX) !== 0) continue;
    const st = n.slice(CONFIG.OUTBOX_PREFIX.length).replace(/\.md$/, "");
    if (!best || st > best.stamp) best = { file: f, stamp: st };
  }
  return best;
}

/** Outbox line grammar, one open dated row per line:
 *    - T-086 | Start recycling with Georgi at the Art College | DL | 2026-09-12 | Planned
 *  Type is DL, SO or SB. Full state each time — a row missing from the newest outbox has left the set. */
function parseOutbox_(text) {
  const rows = [];
  text.split(/\r?\n/).forEach(line => {
    const m = line.match(/^-\s*(T-[\d.]+)\s*\|\s*(.+?)\s*\|\s*(DL|SO|SB)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(\w+)\s*$/);
    if (m) rows.push({ id: m[1], task: m[2], type: m[3], date: m[4], status: m[5] });
  });
  return rows;
}

// ================================================================ service adapters (used after the flip)

function postToService_(path, payload) {
  const base = props_().getProperty("SERVICE_BASE_URL"), token = props_().getProperty("SERVICE_TOKEN");
  if (!base || !token) throw new Error("SERVICE_BASE_URL / SERVICE_TOKEN not set in Script Properties.");
  const res = UrlFetchApp.fetch(base + path, { method: "post", contentType: "application/json", payload: JSON.stringify(payload),
    headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error("service " + path + " → " + res.getResponseCode() + " " + res.getContentText().slice(0, 300));
  return "service " + path + " (" + res.getResponseCode() + ")";
}

function getFromService_(path) {
  const base = props_().getProperty("SERVICE_BASE_URL"), token = props_().getProperty("SERVICE_TOKEN");
  if (!base || !token) throw new Error("SERVICE_BASE_URL / SERVICE_TOKEN not set in Script Properties.");
  const res = UrlFetchApp.fetch(base + path, { headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error("service " + path + " → " + res.getResponseCode());
  return JSON.parse(res.getContentText());
}

// ================================================================ helpers

function guardLists_() {
  if (CONFIG.SOURCE_LIST && CONFIG.SOURCE_LIST === CONFIG.OUTBOUND_LIST)
    throw new Error("SOURCE_LIST and OUTBOUND_LIST are the same list — that would loop. Refusing to run.");
}

function listIdByTitle_(title, createIfMissing) {
  const lists = Tasks.Tasklists.list().items || [];
  const hit = lists.find(l => l.title === title);
  if (hit) return hit.id;
  if (createIfMissing) return Tasks.Tasklists.insert({ title: title }).id;
  throw new Error('Tasks list "' + title + '" not found. Lists here: ' + lists.map(l => l.title).join(", "));
}

function listOpenTasks_(listId) {
  const out = []; let pageToken = null;
  do {
    const res = Tasks.Tasks.list(listId, { showCompleted: false, showHidden: false, maxResults: CONFIG.MAX_TASKS, pageToken: pageToken });
    (res.items || []).forEach(t => { if (t.title && t.title.trim()) out.push(t); });
    pageToken = res.nextPageToken;
  } while (pageToken);
  out.sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0) || String(a.position).localeCompare(String(b.position)));
  return out;
}

function clean_(s) { return String(s || "").replace(/\r?\n+/g, " / ").replace(/\|/g, "¦").replace(/\s+/g, " ").trim(); }
function stamp_() { return Utilities.formatDate(new Date(), CONFIG.TZ, "yyyy-MM-dd-HHmm"); }
function props_() { return PropertiesService.getScriptProperties(); }

# GT relay v2 — fit assessment against the Registry Service

*2026-09-07. Assesses `gt-relay-v2.gs` (designed in another session, owner row T-094) against `service/` and `docs/api-contract.md`, proves the findings with `test/relay.test.ts`, and records what was changed on the service side to make its "service" lane land. Handed over; the script stays with its owning session.*

## Headline verdict

**Install v2 as-is for the two Drive lanes now — yes, with two conditions.** The Drive lanes do what the brief says: dictated tasks become one `GT Inbox — <stamp>.md` per run in the documented grammar, the cursor moves only after the file exists, a `GT Outbox` file is mirrored into a separate `PTO deadlines` list with due dates and `pto:T-` notes, and the loop guards hold (all proven below, against the script itself). The conditions: (1) fix the install brief's step 6 — its test row `T-TEST` does not match the outbox grammar and the executor will report a false failure; (2) know that the cursor design hits an Apps Script quota at roughly 260 lifetime dictations, and plan the v2.2 fix before then.

**Do not flip the SERVICE lane on v2.** Its adapter was written blind to the real contract and every one of its four assumptions is wrong (paths, payload, response shape, auth). The service is now ready for it — bearer, `/dated`, `{ rows }` tolerated — and `gt-relay-v2.1.gs` is the same script with only the SERVICE block corrected; the service-lane test passes on v2.1 and fails on v2, in the ways listed below.

## 1. Service-lane mismatches (v2 SERVICE block vs the real contract)

| # | The script assumes | The service actually | Effect on v2, flipped | Fixed by |
|---|---|---|---|---|
| M1 | `capturePath: "/capture"` | `POST /api/v1/capture` | 404 on every run → error mail every 15 min, nothing captured, cursor never moves (proven: *v2 … origin: both lanes 404*) | v2.1 path |
| M2 | payload `{ rows:[{task, notes, source, actor}] }` | `{ items:[{task, category?, notes?}], actor, source }` | Was 400 `items must be a non-empty array`. The service now normalises `rows` → `items` (first row's actor/source stand in) and answers `normalized_from: "rows"`; so with a base URL that already ends in `/api/v1`, v2's inbound lands (proven: *v2 … origin + /api/v1*). Still deprecated. | service (c) + v2.1 payload |
| M3 | `datedRowsPath: "/radar"` returns a flat array | `/radar` returns seven sections; no flat array existed | `getFromService_(...).map is not a function` → outbound throws every run (proven). | service (b): `GET /api/v1/dated` = exactly `[{id, task, deadline, deadline_type, status}]`, open dated rows, date order; v2.1 path |
| M4 | `Authorization: Bearer <SERVICE_TOKEN>` is checked by the service | v1 has no auth code; Cloudflare Access fronts the API | Access answers an unauthenticated request with a 302 to its login page. `UrlFetchApp` follows redirects, so the POST sees **200 HTML** and `postToService_` — which only checks `< 300` — reports success and advances the cursor. **Silent loss of every dictation.** The GET path fails loudly (`JSON.parse` of HTML). | service (a): the bearer is now real, 401 when wrong; Access must still be told to let those two paths through (bypass policy scoped to `/api/v1/capture` + `/api/v1/dated`, or Service Auth with the extra `CF-Access-*` headers). The redirect blind spot is a v2.2 item: `followRedirects: false` and require a JSON body with `rows`. |
| M5 | `SERVICE_BASE_URL` semantics unstated | — | Ambiguous whether the property includes `/api/v1`; the two failure modes differ by that alone. | v2.1 one-line comment: origin only, paths carry `/api/v1`. |
| M6 | `deadline_type` may be absent | The Task row's `deadline_type` is null for an untyped date | Harmless — the script defaults to `DL`; `/dated` also emits `DL` for null so the array is self-describing. | — |

## 2. Risks in the script (both lanes)

Ordered by how likely they are to bite in the shadow period. "Proven" = a test in `test/relay.test.ts` demonstrates it.

**R1 — Script Property size (cursor and map). Proven.** `exported_ids` is a JSON array of Google Tasks ids (~32 chars each) written back in full each run. Apps Script caps a property value at 9 KB; the array crosses it at ~260 ids, long before the `slice(-2000)` guard. Because the Drive file is written first (correct durability order), the failing `setProperty` leaves the file in place and the cursor unmoved — so every subsequent run writes a new `GT Inbox` file with the same tasks and mails an error: a duplicate-file storm, four files an hour. `outbound_map` (T-id → task id, ~50 bytes each) has the same ceiling at ~180 mirrored rows; the registry has ~82 open rows today, so that one is further away. Fix (v2.2): store the cursor as a compact set of *completed-or-old* exclusions, or key on `updated` and keep only ids newer than a watermark; or move state to a Drive file / the service itself.

**R2 — Error-mail storms.** `relay()` mails on every failing run, no dedupe, no backoff: 96 mails/day for any persistent fault (R1, a Drive quota, the v2 path mismatch). Throwing after mailing also triggers Apps Script's own failure notifications. Fix: remember the last error signature and time in a property; mail once per signature per day; log the rest.

**R3 — No concurrency lock.** Time triggers can overlap when a run is slow (Drive listing grows with the archive); two overlapping runs read the same cursor and both export. `LockService.getScriptLock().tryLock(…)` at the top of `relay()` is the standard fix and is missing.

**R4 — Loop guard is by title, not id.** `guardLists_` compares two config strings; `listIdByTitle_` takes the *first* list whose title matches. Google Tasks allows duplicate list titles, so a second list titled like the source (or like `PTO deadlines`) silently redirects a lane. Renaming `PTO deadlines` in the Google UI makes `listIdByTitle_(…, true)` create a new empty list; every `patch` against the old ids then throws, the catch re-inserts into the new list, and the old list keeps every mirror open forever (never completed, still shown in Calendar). Fix: resolve ids once and pin them in properties; refuse to run when a title matches more than one list.

**R5 — The `pto:` filter is a silent permanent drop. Proven.** A dictated task whose notes happen to contain `pto:` is excluded on every run, never exported, never remembered, and does not appear in the summary count. Cheap fix: log and count skipped tasks; mark them (e.g. append to a `skipped_ids` property) so the count is visible in `status()`.

**R6 — Service-lane outbound has no change detection.** `sourceStamp = "service " + stamp_()` is stored but never compared, so every run patches every mirrored task (notes carry the run stamp, so each patch is a real write). ~40 dated rows × 96 runs ≈ 3,800 Tasks API writes/day — inside the 50,000 quota, but pointless churn that also bumps every task's `updated`. Fix: hash the `/dated` body and skip when unchanged.

**R7 — A transient empty `/dated` response completes everything.** The outbound design treats the source as full state, which is right for the outbox file (Claude writes it in full). Against the service, a transient error that yields `[]` would complete every mirror and the next run would recreate them as new tasks. Since the service returns 5xx rather than `[]` on failure this is unlikely today, but the lane should refuse to complete more than, say, half the map in one run without a flag.

**R8 — Redirect/HTML blindness (M4).** Any 2xx counts as success; the body is never checked. Applies equally to a misconfigured base URL that lands on some other 200 page.

**R9 — The Drive folder gets a third and fourth file kind.** `GT Inbox — …` and `GT Outbox — …` files live in the Task Registry folder alongside snapshots, deltas and the protocol document. Checked: `core`'s `isSnapshotName`/`isDeltaName` are anchored regexes, so the importer and the service's archive writer ignore them, and the protocol's `title contains 'Task Registry'` / `'Registry Delta'` searches cannot return them. Costs: `newestOutbox_()` lists every file in the folder every 15 minutes (fine at ~30 files, slower as the archive grows); inbox files accumulate with nothing to prune them; the "GT INBOX INGESTED" bookkeeping the addendum asks Claude to carry in deltas is unknown to the service's archive writer, so after the flip those lines stop — acceptable because the Drive inbound lane retires at the flip, but it should be said in the addendum. Same-minute collisions get a `-b` suffix once; a third file in the same minute gets a duplicate name (Drive allows it; `newestOutbox_` is unaffected, the inbox files are only ever read by Claude).

**R10 — Timezone and `due`.** Stamps are right: `Utilities.formatDate(new Date(), "Europe/Sofia", …)` is explicit, independent of the project timezone (proven: 18:30Z → `2026-09-07-2130`). Outbound `due` is `<date>T00:00:00.000Z`, which is the documented convention — the Tasks API stores the date part only and the calendar shows that date in any timezone. Inbound `seen` takes the UTC date of `updated` (`.slice(0,10)`), so a dictation between 00:00 and 03:00 Sofia is stamped with the previous day. Cosmetic, worth one `formatDate` call.

**R11 — The install brief's outbound test cannot pass. Proven.** `parseOutbox_` requires `T-` followed by digits/dots; the brief's `- T-TEST | … ` line parses to nothing and `relay()` reports `mirrored 0 dated row(s)`. Change the brief to `T-999` (any numeric id not in the registry) before handing it to the executor.

**R12 — Secrets.** `SERVICE_TOKEN` in Script Properties is readable by anyone who can edit the script, and travels in every execution log that prints it. Fine for one user; it is one more long-lived credential that the Worker-cron design (below) would not need.

What is right and should be kept: the two-lane separation by list; the `pto:` marker as belt-and-braces; the durability order (write, then cursor — proven with an injected Drive failure); full-state outbox semantics; `-b` collision suffix; pagination of the Tasks list (proven with `MAX_TASKS: 1`); dry run before real run; refusal to install a trigger with an unset source list.

## 3. Design opinion — Apps Script relay vs a Worker cron on the Google Tasks API

The relay exists because Claude reads Drive today. After the flip the registry lives in the Worker, and the relay's only remaining job is Google Tasks I/O. At that point a `[triggers] crons = ["*/15 * * * *"]` handler *inside the Registry Service* is the better home:

- **No inbound machine auth at all.** The Worker calls out to Google; nothing has to get through Access, there is no `MACHINE_TOKEN`, no redirect blind spot, no Script Property holding a secret. M4 and R8 disappear rather than being mitigated.
- **State in D1, not Script Properties.** The cursor becomes a table (`gtasks_seen(gt_id, task_id)`), the map a column; R1 (9 KB) and R3 (locking — D1 batches are atomic) disappear. Duplicate detection can be exact.
- **Testable in-repo.** The cron handler runs under the same `vitest-pool-workers` harness as everything else, with a recorded Google Tasks fake; today the script is tested only through the vm harness in this folder, and deployed by pasting into a browser editor.
- **One less runtime and one less place errors go.** Errors land in Worker observability, and the Monday run can report "last relay run" from D1 instead of trusting an email that may not arrive.

The trade-off is OAuth. Apps Script gets Google-managed auth for free: one consent click by FtB, tokens refreshed forever by Google, no client id, no secret, no verification. A Worker must hold a user **refresh token** for the Tasks scope (`https://www.googleapis.com/auth/tasks`), obtained once via a consent flow (a tiny `/oauth/google/start` + callback pair in the Worker, or a one-off local script), stored as a Worker secret, and exchanged for an access token each run. Costs and gotchas: a Google Cloud project with the Tasks API enabled and an OAuth client; the consent screen must be set to **In production** (in *Testing* status refresh tokens expire after seven days — the classic silent-death mode); the Tasks scope is "sensitive", so an unverified app shows a warning screen on consent and is capped at 100 users — irrelevant for one user, but a scarier screen than Apps Script's; the refresh token can be revoked by a password change or security event and must then be re-consented, so the cron needs a loud "auth broken" signal. Service accounts are not an option for a consumer Google account (no domain-wide delegation).

**Recommendation.** Keep the Apps Script relay for the shadow period — it is the right bridge while Drive is what Claude reads, and its Drive lanes work. Do the v2.2 fixes (R1, R2, R3, R11 at minimum). When T-094.4 comes due, spend the flip on the Worker cron rather than on switching the script's flags: the `/dated` endpoint and `{ rows }` tolerance added today keep the script path open if the OAuth setup proves annoying, but the cron is the design that removes the most moving parts. v2.1 is the correct script if the script path is taken.

## 4. What changed on the service side (contract-preserving)

- **(a) Machine bearer.** `MACHINE_TOKEN` (secret) + `MACHINE_ACTOR` (var, default `gt-relay`). Bearer present and right → machine request; actor defaults to the machine name when the body/`X-Actor` name none. Machine requests may only `GET health|registry|registry/open|queue|radar|dated` and `POST capture|tasks/:id/note`; every judgment, close, reopen and archive route is 403 for them — the token cannot triage or flush, by construction. Wrong bearer, malformed header, or any bearer while the secret is unset → 401. No `Authorization` header → untouched (Access is the gate for browsers). CORS preflights never need the token.
- **(b) `GET /api/v1/dated`.** The radar's six dated sections flattened and sorted by date then id, five fields exactly, `deadline_type` never null. Test asserts it equals both "open rows with a deadline" from `/registry` and "`/radar` minus `undated`", and that it follows judgments (date set, `none`, close).
- **(c) `POST /api/v1/capture` accepts `{ rows }`**, normalised to `items`; the first row's `actor`/`source` stand in for missing top-level ones; response carries `normalized_from: "rows"`. A `source: "gtasks"` capture lands as Inbox / Triaged null / no scores with `actor=gt-relay source=gtasks human_judgment=0` in the judgments log, and enters the queue at tier 3 (never judged).
- Docs: `docs/api-contract.md` (endpoint, auth section, error codes), `service/README.md` (machine bearer, Access configuration, the redirect trap), `service/wrangler.toml` (secret/var comments).
- Tests: `service/test/relay.test.ts` (9 tests) under the existing workerd + D1 harness.

Nothing existing changed behaviour: the earlier 12 service tests pass unmodified.

## 5. The script test harness

`test/relay.test.ts` loads the `.gs` file (plain JavaScript) into a Node `vm` context over stubs for `Tasks`, `DriveApp`, `PropertiesService`, `UrlFetchApp`, `Utilities.formatDate`, `Session`, `MailApp`, `ScriptApp`, `Logger`, `MimeType` and a clock-driven `Date` (`test/gas.ts`). The stubs enforce the platform behaviours the script leans on: `showCompleted:false`, `maxResults` paging, `patch` throwing on a missing task, duplicate Drive names, the 9 KB property limit, `muteHttpExceptions`.

`UrlFetchApp.fetch` is routed to the **real Hono service app** (`service/src/app.ts`), not a fake: the app runs on a `worker_threads` thread over `node:sqlite` behind a four-method D1 shim (`prepare/bind/first/all/batch`, the service's own SQL and migration), and the synchronous Apps Script call blocks on `Atomics.wait` while Hono's async handlers run there (`test/service-thread.ts`, `test/service-bridge.ts`). The test also queries the service's `judgments` table directly to prove `actor`/`source`. The seed is a seven-row fixture (three open dated rows of each type, one Done dated row, undated rows).

Results (20 tests, all green as tests — the v2 service-lane tests assert the failure):

| Area | Asserted | v2 | v2.1 |
|---|---|---|---|
| discoverLists | both lists, open counts, newest titles, completed excluded | pass | same code |
| guards | `guardLists_` throws on equal lists before any API/Drive call; unset source skips; trigger refused; installTrigger idempotent | pass | same |
| inbound → Drive | two tasks → one file, grammar, `gt-due`, flattened notes, cursor after write, "nothing new", `pto:` skipped, completed/other lists ignored, paging, `-b` suffix, Drive failure leaves cursor untouched | pass | same |
| inbound → Drive, R1 | 270 dictations → property limit → duplicate file on the next run | demonstrated | same |
| outbound ← Drive | three rows → three tasks with due/notes/titles; same-stamp not re-mirrored; newer outbox completes the missing row and patches in place; deleted task recreated; newest stamp wins | pass | same |
| outbound ← Drive, R11 | brief's `T-TEST` row parses to nothing | demonstrated | same |
| service lane, base = origin | — | **fails**: `/capture` 404, `/radar` 404, mail, nothing captured | **passes**: capture lands (Inbox, gtasks, gt-relay, notes with provenance, cursor after 200, no double capture); `/dated` mirrored (4 rows, Done and undated excluded), close reflected as completed, patch not duplicate |
| service lane, base = origin + `/api/v1` | — | inbound lands only via the service's `rows` normalisation; outbound `.map is not a function` | n/a |
| wrong token | — | — | 401 on both lanes, nothing written, one mail |
| covenant | machine token → `POST /judgments` 403 | — | pass |

## 6. v2 → v2.1 diff (the only lines that differ)

```
-// Service endpoints, BY ROLE — the executor verifies the real paths in service/ before switching:
+// SERVICE_BASE_URL is the Worker's origin only (e.g. https://ftb-registry-service.<acct>.workers.dev) — no path, no trailing slash; the paths below carry /api/v1.
+// Service endpoints, verified against service/src/app.ts and docs/api-contract.md on 2026-09-07:
 const SERVICE = {
-  capturePath: "/capture",      // POST  { rows:[{task, notes, source:"gtasks", actor:"gt-relay"}] }
-  datedRowsPath: "/radar"       // GET   → [{ id, task, deadline, deadline_type, status }]  (open rows with a date)
+  capturePath: "/api/v1/capture",   // POST  { items:[{task, notes}], actor:"gt-relay", source:"gtasks" }
+  datedRowsPath: "/api/v1/dated"    // GET   → [{ id, task, deadline, deadline_type, status }]  (open rows with a date)
 };
…
-    where = postToService_(SERVICE.capturePath, { rows: rows.map(r => ({
-      task: r.title, source: "gtasks", actor: "gt-relay",
+    where = postToService_(SERVICE.capturePath, { actor: "gt-relay", source: "gtasks", items: rows.map(r => ({
+      task: r.title,
       notes: "dictated via Gemini · gt:" + r.gtId + " · seen " + r.seen + (r.due ? " · gt-due " + r.due : "") + (r.notes ? " · " + r.notes : "")
     })) });
```

Deliberately untouched, for the owning session (a v2.2 list): the header still says "v2" and the error-mail subject too; R1–R8, R10 and the redirect check in `postToService_`; the brief's `T-TEST` line (R11); the addendum's note that "GT INBOX INGESTED" bookkeeping ends at the flip (R9).

## 7. Running it

`npm test` at the root now runs the `google-tasks` project too (`integrations/google-tasks/vitest.config.ts`, registered in the root `vitest.config.ts`; it is not an npm workspace — nothing to install). `npx vitest run --project google-tasks` runs it alone in under a second. Requires Node ≥ 22.18 for `node:sqlite` and native type stripping on the worker thread.

# [T-094] Integrate Google Tasks into the PTO — Planning Script

*2026-09-07 (Monday), Europe/Sofia. Revises the 2026-09-03 package in light of the Free the Brain production plan (2026-09-07-0920) and its agentic reassessment (2026-09-07-1834), which stands where the two differ. Decisions below were taken by FtB on 2026-09-07 by elicitation form; they are recorded so they are not relitigated from memory. Handed over, not installed.*

## Outcome, in one sentence

Anything FtB dictates to Gemini lands in the registry as an Inbox row without him touching a screen, and every dated registry row shows up in his Google Calendar's task lane — with Drive doing both jobs now and the Registry Service able to take either over by flipping one config value.

## What changed since the 2026-09-03 design

The plan moved the canonical registry from Drive markdown to a hosted Registry Service (Cloudflare Workers + D1), with Drive becoming the immutable archive. The reassessment reports the service, MCP server, client, Android shell and site as code-complete in one Cowork session, with the flip scheduled for a Monday in roughly week three, after a two-week shadow period. Three consequences for the relay:

1. **Drive is a bridge, not the destination.** The relay writes to Drive today because that is what Claude reads today; after the flip it should talk to the service. Hence the adapter: `INBOUND_TARGET` and `OUTBOUND_SOURCE`, each `"drive"` or `"service"`, and nothing else in the script changes.
2. **The covenant is now enforced in code.** The service refuses score changes without a human attestation and accepts captures with `source` and `actor`. The relay only ever captures — Inbox rows, no scores — so it is covenant-safe by construction, and its `actor` is `gt-relay`, legible in the judgments table.
3. **Two-way is cheap now.** The plan's "calendar write-back" was deferred to §9 as an app feature. The relay delivers the visible half of it today for free: registry deadlines mirrored into a Google Tasks list, which Google Calendar displays without any Calendar API or Zapier. It stays flag-free because it writes only to its own list and never touches the registry.

## Decisions of record (2026-09-07)

- **Revise, don't restart.** v2 keeps v1's structure, file grammar and durability order.
- **Two-way now.** Inbound (Tasks → registry) and outbound (dated rows → a separate Tasks list).
- **Drive now, backend-ready.** Adapter flags default to `"drive"`; the service paths are named by role and verified against `service/` before the switch.
- **Cursor mode.** Dictated tasks are left exactly as Gemini wrote them; the script remembers what it exported.
- **Source list discovered, not assumed.** `discoverLists()` prints every list with its newest tasks; the executor sets `CONFIG.SOURCE_LIST` from that evidence.
- **Executor: a Cowork session driving Chrome.** The install brief is self-contained for it; the Google authorization screen and any credential entry stay with FtB.
- **Monday run in a separate session.** Nine deltas sit on the 2026-08-31 snapshot; compaction is overdue and not this session's job.

## Subtasks

Dotted IDs under T-094 (integrate Google Tasks into the PTO). T-094.1 and T-094.2 already exist from 2026-09-03 and are re-scoped rather than replaced; .3 and .4 are new. No scores, no deadlines — those are his at triage.

- **T-094.1 — Install and test the GT relay v2** (re-scoped). Cowork + Chrome, from `cowork-brief-gt-relay-v2.md`. Pass: one dictated test task → one `GT Inbox` file in the folder → cursor advanced; one `GT Outbox` file → the `PTO deadlines` list populated with its rows and each showing in Google Calendar; `status()` reports the trigger installed. Blocked on the authorization click (his) and on the source-list decision (discovered during the run).
- **T-094.2 — Upload the Capture Protocol addendum v2** (re-scoped). Two rules now: ingestion of `GT Inbox` files, and the writing of a `GT Outbox` file at the Daily Pulse and the Monday run. His upload.
- **T-094.3 — Write the first GT Outbox file** (new). Claude's step, on his word, after the relay passes: one file listing every open dated row from the current snapshot plus deltas, in the outbox grammar. This primes the outbound lane; every later pulse rewrites it in full.
- **T-094.4 — Flip both lanes to the Registry Service** (new; dormant until the plan's flip). Verify `capturePath` and `datedRowsPath` against `service/`, set the two Script Properties, switch the two flags, run `testRun()`, then `relay()`. Pass: a dictated task appears in the service with `source: gtasks`, and the deadlines list mirrors the service's radar. Should follow the plan's own flip by no more than a week, so Drive-side ingestion can retire cleanly.

Sequence: .1 → .3 → .2 (the addendum can wait until the lanes are proven) · .4 waits for the plan.

## The single first physical action

Open `script.google.com`, create a project named **GT Inbox relay**, and paste `gt-relay-v2.gs` — or hand the Cowork brief to a Cowork session and let it do exactly that in your Chrome. Under ten minutes to the first `discoverLists()` output either way.

## Known blockers

- **The source list is unknown.** Resolved during the run by `discoverLists()`; the script refuses to install a trigger until it is set.
- **The authorization screen** is FtB's to click — by design and by the Cowork session's own rules.
- **Loop risk between the two lanes.** Structural guard in the script: the lanes touch different lists, inbound skips anything marked `pto:`, and identical list names throw before anything runs. Still worth one deliberate test in the run: dictate a task into the deadlines list and confirm it is *not* ingested.
- **Service endpoint names** are placeholders (`/capture`, `/radar`) until read from `service/` — the repo zip did not arrive with the request, so this Planning Script names them by role.
- **Google Tasks `due` is date-only** (the time component is ignored). Fine for the calendar lane; noted so nobody expects 09:00 reminders from it — those belong to the Android local notifications the plan already built.

## Realistic deadline check

The install is a one-sitting job — the Cowork reassessment measured a whole service build at six hours, so a 300-line Apps Script with a four-part test is an hour, two if the source list is ambiguous. What sets the real calendar is not this row: T-094.4 is dormant until the plan's flip (about week three), and the shadow period wants the Drive-side lanes running throughout so the flip has live traffic to compare against. So: .1 and .3 this week, .2 by the next Monday run, .4 within a week of the flip. No date is written here; the Triage tab is where he sets them.

## Files in this package

- `gt-relay-v2.gs` — the script.
- `cowork-brief-gt-relay-v2.md` — the executor's self-contained procedure.
- `capture-protocol-addendum-gt-v2.md` — the Project Instructions text for both lanes.
- This Planning Script.

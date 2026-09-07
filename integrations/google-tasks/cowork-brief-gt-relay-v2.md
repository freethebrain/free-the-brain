# Cowork brief — install and test the GT relay v2 (both lanes)

Paste this whole brief into a Claude Cowork session together with `gt-relay-v2.gs`. The session has no access to the PTO project's instructions; everything it needs is here. Where this brief says *stop and ask me*, stop and ask.

## The job in one paragraph

Install `gt-relay-v2.gs` as a Google Apps Script under my account, enable the Tasks API service, discover which Google Tasks list Gemini dictates into and set it in the config, run the dry run, run it for real, install the 15-minute trigger, and prove both lanes: (inbound) a task I dictate into Google Tasks appears within one run as a file named `GT Inbox — YYYY-MM-DD-HHMM.md` in a specific Drive folder; (outbound) a file named `GT Outbox — …md` that I will place in that folder produces matching tasks, with due dates, in a Google Tasks list called `PTO deadlines`, visible in Google Calendar. Report exactly what you saw.

## Facts you need

- Apps Script editor: https://script.google.com → **New project** → name it `GT Inbox relay`. Paste the full script into `Code.gs`, replacing the stub.
- Required service: left sidebar **Services (+)** → **Tasks API** → **Add**. Without it: `Tasks is not defined`. Drive and Mail need nothing extra.
- Drive folder (the PTO's Task Registry): ID `1yZabLPGJAkxeu748rA89swQLDoFuMRu8` — https://drive.google.com/drive/folders/1yZabLPGJAkxeu748rA89swQLDoFuMRu8. It holds files named `Task Registry — …` and `Registry Delta — …`. **Never open, edit, move, rename or delete any of those.** The script only creates files beginning `GT Inbox — ` and only reads files beginning `GT Outbox — `.
- Mode is **cursor**: dictated tasks are left untouched in Google Tasks; the script remembers what it exported.
- The outbound lane writes **only** to a list named `PTO deadlines`, creating it if absent. The inbound lane reads **only** the dictation list. They must differ; the script refuses to run if they don't.
- The two `INBOUND_TARGET` / `OUTBOUND_SOURCE` flags stay `"drive"`. Do not touch the `SERVICE` block or set any Script Properties — that is a later task (T-094.4).

## Steps, in order

1. Create the project, paste the script, add the Tasks API service, save.
2. Select **`discoverLists`** in the function dropdown and **Run**. The first run opens Google's authorization screen — **stop and tell me; that consent is mine to click.** After I approve, run it again if needed. Read the Execution log: it lists every list with its open count and three newest task titles.
3. **Decide the source list from the evidence:** the list whose newest tasks read like spoken dictation (e.g. "call the yard company", "buy printer paper") is the one. If it is obvious, set `CONFIG.SOURCE_LIST` to that exact title and tell me which you chose and why. If two lists both look plausible, **stop and show me the discoverLists output** — the decision is mine. Never set it to `PTO deadlines`.
4. Run **`testRun`**. Expected: `DRY RUN`, then `in: would export N task(s) via drive` (or `nothing new`), then `out: no GT Outbox file yet — nothing to mirror`. Any other error: fix if it is in the known list below, otherwise report verbatim.
5. Ask me to dictate a test task ("Hey Google, add *relay test one* to my tasks"). Then run **`relay`**. Expected: `in: exported 1 task(s) → GT Inbox — <stamp>.md`. Open the Drive folder in Chrome and confirm the file exists and contains `relay test one`. Confirm the task is **still present and unchanged** in Google Tasks (cursor mode).
6. Outbound test. Create a plain-text file in the Drive folder named exactly `GT Outbox — 2026-09-07-1200.md` with this content (three lines, nothing else):
   ```
   # GT Outbox — 2026-09-07-1200
   ## ROWS
   - T-TEST | Relay outbound test | DL | 2026-09-10 | Planned
   ```
   This is the **one** file you may create in that folder, and only under that exact name. Run **`relay`** again. Expected: `out: mirrored 1 dated row(s) from 2026-09-07-1200, completed 0`. Open Google Tasks: a list `PTO deadlines` now holds a task titled `T-TEST · Relay outbound test` due 10 Sep with notes beginning `pto:T-TEST`. Open Google Calendar: it appears in the tasks lane on 10 Sep.
7. Loop test. Ask me to dictate a task **into the `PTO deadlines` list** (or add one there by hand in Google Tasks with notes `pto:loop-test`). Run `relay`. Expected: `in: nothing new` — it must not be ingested. Report the result either way.
8. Run **`installTrigger`** → `Trigger installed: relay() every 15 minutes.` Run **`status`** and paste its full output into your report.
9. Cleanup: delete the `GT Outbox — 2026-09-07-1200.md` test file you created (only that one), and tell me the `T-TEST` task exists so I can delete it by hand — do not delete tasks yourself.
10. Report: source list chosen and the evidence; the inbox file name; the outbound list state; the loop-test result; the `status` output; anything that deviated from the expected lines.

## Known errors and fixes

- `Tasks is not defined` → the Tasks API service was not added (step 1).
- `CONFIG.SOURCE_LIST is unset` → step 3 was skipped.
- `Tasks list "…" not found. Lists here: …` → the title has a typo; copy it exactly from the error's list.
- `SOURCE_LIST and OUTBOUND_LIST are the same list` → wrong choice in step 3; pick the dictation list.
- Permission / scope errors → authorization incomplete; run again and wait for me.

## Do not

- Do not create, edit or delete anything in the Drive folder except the single test outbox file in step 6 and its cleanup in step 9.
- Do not change `MODE`, the two adapter flags, `FOLDER_ID`, `TZ`, the prefixes, or the `SERVICE` block.
- Do not complete, edit or delete Google Tasks by hand.
- Do not click the Google authorization screen on my behalf, and never handle a password, token or 2FA code.

## Pass criterion — all five, or it is not done

1. Dictated task → `GT Inbox — …md` in the folder, task untouched in Google Tasks.
2. Test outbox → task in `PTO deadlines` with the right due date, visible in Google Calendar.
3. Loop test not ingested.
4. `status` shows the trigger installed and the source list set.
5. Test file removed; nothing else in the folder touched.

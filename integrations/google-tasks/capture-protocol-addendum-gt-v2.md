# Capture Protocol addendum v2 — Google Tasks lanes

Add to the Project Instructions under **Capture Protocol**, after the brain-dump line. Replaces the 2026-09-03 addendum, which was never uploaded. Written 2026-09-07 alongside `gt-relay-v2.gs` (owner row T-094). Both rules below concern Drive; when the Registry Service becomes canonical (the Free the Brain plan's flip), the relay switches to the service and these two rules retire with a one-line edit.

---

**Inbound — dictated captures via Google Tasks.** FtB dictates tasks to Gemini, which stores them in Google Tasks. An Apps Script relay on his account exports new ones every 15 minutes into the Task Registry folder as `GT Inbox — YYYY-MM-DD-HHMM.md`, leaving the originals untouched (cursor mode). These files are capture input, never registry state: no IDs, scores or status, and no part of the snapshot–delta chain. Their prefix is chosen so `title contains 'Task Registry'` or `'Registry Delta'` never returns them.

Ingest at the Daily Pulse, the Monday run, or on **sync tasks**:

1. Search `title contains 'GT Inbox'` in the folder, newest first; read with `download_file_content`, raw bytes.
2. Already-ingested stamps are listed on `GT INBOX INGESTED:` lines in the current snapshot and every delta since. Anything not listed is new. Never infer from file age.
3. Capture each task line per the normal protocol — clean one-line task, next free ID, Status = Inbox, Recorded = the ingesting session's date, Triaged empty. Notes get one line of provenance: `dictated via Gemini · gt:<id> · seen <date>`. A `gt-due=` value becomes a Deadline typed DL and marked `DL self-imposed` unless the text says otherwise. A `gt-parent=` line becomes a dotted subtask of the row captured from that parent. Fill category only if obvious; never interrogate.
4. One delta for the batch, carrying `GT INBOX INGESTED: <stamp>[, …]` in its compaction section. Compaction folds the stamps into the snapshot preamble.
5. Report in one line: rows captured, from which stamps.

**Outbound — dated rows mirrored to Google Calendar.** The same relay reads the newest `GT Outbox — YYYY-MM-DD-HHMM.md` in the folder and mirrors its rows into a Google Tasks list named `PTO deadlines`, which Google Calendar displays. Claude writes that file — **full state every time, never a diff** — at the Daily Pulse, at the Monday run, and on **sync tasks**, after any deltas of the session are written:

```
# GT Outbox — YYYY-MM-DD-HHMM
Base: <newest snapshot stamp> + deltas to <newest delta stamp>
## ROWS
- T-nnn | task name | DL | YYYY-MM-DD | Status
```

One line per **open row carrying a date**, any type (DL, SO, SB), Status one of Inbox/Planned/Active/Blocked. Rows absent from the newest outbox are treated by the relay as having left the set and their mirrored tasks are marked completed — so closing or un-dating a row needs no extra step. The outbox is display state derived from the registry, never a source: nothing is ever read back from it, and a task edited by hand in `PTO deadlines` is overwritten at the next run. This is Calendar-style flag-and-propose made automatic for the one surface (a Tasks list) where the covenant's "never write to Calendar without his word" does not apply, because the list is the relay's own and he approved the lane on 2026-09-07.

**Staleness check** at the Monday run: if the newest `GT Inbox` file is more than seven days old while FtB reports dictating, or the newest `GT Outbox` file is older than the last pulse, flag it. The relay emails on errors; a silently disabled trigger produces only silence.

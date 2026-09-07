# Registry Service — API contract v1

Base URL: `/api/v1`. JSON in and out. All dates ISO `YYYY-MM-DD`. All timestamps ISO 8601 with offset.

## Row shape (`Task`)
```json
{
  "id": "T-021.1",
  "task": "Send Ian the pay figure",
  "category": "Freelance Videoediting",
  "u": "H" | "M" | "L" | null,
  "i": "H" | "M" | "L" | null,
  "status": "Inbox" | "Planned" | "Active" | "Blocked" | "Done" | "Dropped",
  "recorded": "2026-07-17",
  "triaged": "2026-08-04" | null,
  "deadline": "2026-09-12" | null,
  "deadline_type": "DL" | "SO" | "SB" | null,
  "deadline_kind": "hard" | "self" | "agreed" | null,
  "done": "2026-08-29" | null,
  "notes": "free text; newline-separated appended lines",
  "blocker": "short label or null",
  "updated_at": "2026-09-07T09:20:00+03:00"
}
```
Subtasks: dotted IDs; depth = number of dots. Parent = id without its last segment.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/registry` | `{ stamp, today, rows: Task[], counts: {open, done, dropped, total}, next_free_id, reserved: [id,id,id] }` — every row, open and closed. |
| GET | `/registry/open` | open rows only, same envelope. |
| GET | `/queue?chunk=5&page=0` | The five-tier triage queue for the current ISO week. `{ monday, entries: [{ top: Task, rows: Task[], tier: 1..5, key }], total, page, chunk }`. |
| GET | `/radar?days=14` | `{ overdue: Task[], today_tomorrow: Task[], fortnight: Task[], passed_not_overdue: Task[], further: Task[], dormant: Task[], undated: Task[] }` using the DL/SO/SB semantics. |
| POST | `/judgments` | Record a batch of triage judgments. Body below. Returns `{ applied: n, rejected: [{id, reason}], delta_stamp }`. |
| POST | `/capture` | `{ items: [{ task, category?, notes? }], actor, source }` → `{ rows: Task[] }` with next free IDs, Status=Inbox, Recorded=today, Triaged=null. |
| POST | `/tasks/:id/close` | `{ actor, source, human_judgment: true, done?: date, note? }` → Task. |
| POST | `/tasks/:id/reopen` | `{ actor, source, human_judgment: true, status: "Planned"|"Active"|"Blocked"|"Dropped", note? }` → Task. |
| POST | `/tasks/:id/note` | `{ actor, source, text }` → Task. Appends; never overwrites. |
| GET | `/archive/pending` | The delta text the archive writer would emit for unwritten changes (for the shadow period and for manual paste). |
| POST | `/archive/flush` | Emit the pending delta (or a snapshot if `{ compact: true }`) — returns `{ filename, content }`; actual upload to Drive is a separate concern (see service README). |
| GET | `/health` | `{ ok: true, stamp, rows }` |

## Judgment batch (`POST /judgments`)
```json
{
  "actor": "ftb",
  "source": "app",
  "human_judgment": true,
  "today": "2026-09-07",
  "judgments": [
    { "id": "T-041", "u": "H", "i": "M", "status": "Planned",
      "deadline": { "type": "SB", "date": "2026-09-15" } ,
      "note": "free text" },
    { "id": "T-052", "deadline": "none" },
    { "id": "T-062", "status": "Done" },
    { "id": "T-070", "reopen": "Planned", "note": "why" }
  ]
}
```
Semantics (identical to the widget's output contract): an absent field is unchanged, never cleared; `deadline: "none"` clears the date only; `note` appends; every judged row gets `triaged = today`; `status: "Done"` sets `done = today`; `reopen` is only valid on a closed row.

**Covenant rule:** if `human_judgment` is not `true` and any judgment touches `u`, `i`, `status`, `deadline`, `category` or `triaged`, the whole batch is rejected with HTTP 403 and `{ error: "covenant", detail: "..." }`. `note`-only batches are allowed without it.

## Text wire format (also accepted)
`POST /judgments/text` with `Content-Type: text/plain` accepts the Master widget's Send-results text verbatim:
```
TRIAGE — Master widget — 2026-09-07 (staged from 2026-08-31-1137)
T-041 (chase Ian): U=H I=M status=Planned deadline=SB 2026-09-15 note: free text
T-052 (book dentist): deadline=no date
T-070 (x): REOPEN status=Planned note: why

NEW TASKS:
T-101: captured line
```
Header `X-Actor` and `X-Human-Judgment: true` carry the attestation.

## Errors
`400` malformed · `403` covenant · `404` unknown id · `409` stale (`If-Match` stamp older than current) · `500`.

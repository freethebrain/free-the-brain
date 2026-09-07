# Registry Service

A Cloudflare Worker (Hono + D1) that holds the canonical registry, enforces the automation covenant, and writes the Drive archive files. Implements `docs/api-contract.md` under `/api/v1`.

## Layout

| File | What it is |
|---|---|
| `src/app.ts` | The HTTP API. Reads derive queue/radar with `@ftb/core`; writes go through the two files below. |
| `src/judgments.ts` | Judgment JSON and the widget's Send-results text → core `Change`s; the covenant check. |
| `src/writes.ts` | The single write path: apply a `Change`, upsert the row, log the judgment event, log the pending delta line — one D1 batch. |
| `src/archive.ts` | Builds the next `Registry Delta — …` from pending lines, or a `Task Registry — …` snapshot on compaction. |
| `src/import.ts` | Seeds the DB from a registry folder (newest snapshot + later deltas), as prepared statements or SQL text. |
| `src/db.ts` | All SQL. |
| `migrations/0001_init.sql` | `tasks`, `judgments`, `pending_changes`, `meta`. |
| `scripts/import.ts` | Node script that prints the seed SQL. |

## Local setup (no Cloudflare account needed)

From the repo root, once: `npm install` (the root `.npmrc` sets `legacy-peer-deps`, which npm 10.9 needs to resolve vitest 4's peer cycle).

Then, in `service/`:

```sh
# 1. create the local D1 and its tables
npx wrangler d1 migrations apply DB --local

# 2. turn data/registry into seed SQL (newest snapshot + every later delta, resolved by core)
npx tsx scripts/import.ts ../data/registry > .import.sql
#    stderr reports: base stamp, deltas applied, counts, next free ID, parser warnings

# 3. load it
npx wrangler d1 execute DB --local --file=.import.sql

# 4. run it
npx wrangler dev
curl localhost:8787/api/v1/health
curl 'localhost:8787/api/v1/queue?chunk=5&page=0'
```

`npm run import:sql`, `npm run db:migrate:local`, `npm run db:seed:local` wrap steps 1–3. Re-running the import replaces every row and resets `pending_changes` and `meta` to the archive's state; it does not touch `judgments`.

## Tests

`npm test` at the repo root runs the core and service projects. The service tests run inside workerd with a real local D1 through `@cloudflare/vitest-pool-workers` (it installed and ran cleanly here, so there is no SQLite fallback). `vitest.config.ts` reads the migrations and `data/registry` on the Node side and hands them to the worker as bindings; the test file skips when `data/registry` is absent (it is gitignored). A fake clock drives the stamps, so the delta and snapshot filenames in the tests are deterministic.

Covered: import → `GET /registry` counts; judgments with and without `human_judgment` (403 covenant, note-only allowed); `deadline: "none"`; note append; capture assigning next free IDs; the widget text format; close/reopen/note; `If-Match` → 409; `archive/pending` yields a delta that core's `parseDelta` reads and that, applied to the imported registry, reproduces the DB state; flush advances the chain; compact emits a snapshot with a verified COUNT line and resets it.

## Semantics worth knowing

- **Covenant.** A batch without `human_judgment: true` that touches `u`, `i`, `status`, `deadline`, `category`, `triaged` or `reopen` is rejected whole with 403 `{ error: "covenant" }`. Note-only batches, captures and `/tasks/:id/note` pass. `/close` and `/reopen` always require the attestation.
- **Triaged.** Every judgment that carries a judgment field stamps `triaged = today`. A note alone does not — a note is not a triage. `today` comes from the body, else `?today=`, else the Europe/Sofia clock.
- **Done.** `status: "Done"` or `"Dropped"` sets `done = today`; reopening clears it.
- **IDs.** Next free top-level ID is one past the highest ever used; gaps and dropped IDs are never reused. Captures in the widget text keep the reserved ID they name if it is still free, else take the next free one; the response's `captured` lists what was assigned.
- **Stamps.** `delta_stamp` in write responses is the Europe/Sofia minute of the write (`meta.current_stamp`). Archive filenames take their stamp at flush time from the server clock; a flush inside the same minute as the previous archive file is refused with 409 rather than reuse a stamp.
- **Archive state.** `meta.last_snapshot_stamp` is the base every delta names; `meta.prior_deltas` (JSON) is the "Prior deltas:" line; `meta.delta_count` drives `compact_due` in `GET /archive/pending` (threshold 5, per the protocol). Flushing is never automatic.

## Getting the files into Drive

`POST /archive/flush` returns `{ filename, content }` and advances the chain; it does not upload. During the shadow period the intended loop is: a session (or the Monday run) calls flush, creates the file in the Task Registry folder with the Drive connector using the returned name and content verbatim, and reports it. If an upload fails after a flush, the content is gone from `pending_changes` but is fully recoverable: every write is in `judgments`, and a compaction (`{ compact: true }`) re-emits the whole registry.

## Deploying

Fill `account_id` (optional) and `database_id` in `wrangler.toml` (see the comments there), then:

```sh
npx wrangler d1 create ftb-registry            # once; paste the id into wrangler.toml
npx wrangler d1 migrations apply DB --remote
npx wrangler d1 execute DB --remote --file=.import.sql
npx wrangler deploy
```

Put Cloudflare Access in front of the route (ADR-1); the service has no auth code of its own.

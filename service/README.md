# Registry Service

A Cloudflare Worker (Hono + D1) that holds the canonical registry, enforces the automation covenant, and writes the Drive archive files. Implements `docs/api-contract.md` under `/api/v1`.

## Layout

| File | What it is |
|---|---|
| `src/app.ts` | The HTTP API. Reads derive queue/radar/dated with `@ftb/core`; writes go through the two files below. Also the optional machine bearer (see below). |
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

Covered (`service.test.ts`): import → `GET /registry` counts; judgments with and without `human_judgment` (403 covenant, note-only allowed); `deadline: "none"`; note append; capture assigning next free IDs; the widget text format; close/reopen/note; `If-Match` → 409; `archive/pending` yields a delta that core's `parseDelta` reads and that, applied to the imported registry, reproduces the DB state; flush advances the chain; compact emits a snapshot with a verified COUNT line and resets it. `relay.test.ts` covers the machine bearer (401/403 surface, actor default, route scope), `GET /dated` against `/radar` and the registry, and the `{ rows }` capture shape. `owner.test.ts` covers owner-token mode: owner full access with the `ftb` default actor, no-header 401 on every route but `/health` and the preflight, the machine token's unchanged scope, and Access mode untouched when `OWNER_TOKEN` is unset.

## Semantics worth knowing

- **Covenant.** A batch without `human_judgment: true` that touches `u`, `i`, `status`, `deadline`, `category`, `triaged` or `reopen` is rejected whole with 403 `{ error: "covenant" }`. Note-only batches, captures and `/tasks/:id/note` pass. `/close` and `/reopen` always require the attestation.
- **Triaged.** Every judgment that carries a judgment field stamps `triaged = today`. A note alone does not — a note is not a triage. `today` comes from the body, else `?today=`, else the Europe/Sofia clock.
- **Done.** `status: "Done"` or `"Dropped"` sets `done = today`; reopening clears it.
- **IDs.** Next free top-level ID is one past the highest ever used; gaps and dropped IDs are never reused. Captures in the widget text keep the reserved ID they name if it is still free, else take the next free one; the response's `captured` lists what was assigned.
- **Stamps.** `delta_stamp` in write responses is the Europe/Sofia minute of the write (`meta.current_stamp`). Archive filenames take their stamp at flush time from the server clock; a flush inside the same minute as the previous archive file is refused with 409 rather than reuse a stamp.
- **CORS.** The client is another origin (Pages, or `vite` on :5173 / `vite preview` on :4173), so `/api/*` answers CORS for an allowlist: `CORS_ORIGINS` (comma-separated, in `wrangler.toml` `[vars]` or `--var`) when set, else localhost / 127.0.0.1 on any port. Origins are never reflected blindly — with Access in front the browser sends the Access cookie. Found in the 2026-09-07 integration pass: without it the browser's fetch failed (`net::ERR_FAILED`) and the client fell back to the fixture, with the service worker later masking it as `503 offline`.
- **Archive state.** `meta.last_snapshot_stamp` is the base every delta names; `meta.prior_deltas` (JSON) is the "Prior deltas:" line; `meta.delta_count` drives `compact_due` in `GET /archive/pending` (threshold 5, per the protocol). Flushing is never automatic.

## Getting the files into Drive

`POST /archive/flush` returns `{ filename, content }` and advances the chain; it does not upload. During the shadow period the intended loop is: a session (or the Monday run) calls flush, creates the file in the Task Registry folder with the Drive connector using the returned name and content verbatim, and reports it. If an upload fails after a flush, the content is gone from `pending_changes` but is fully recoverable: every write is in `judgments`, and a compaction (`{ compact: true }`) re-emits the whole registry.

## Deploying

Fill `account_id` (optional) and `database_id` in `wrangler.toml` (see the comments there), set `CORS_ORIGINS` in `[vars]` to the deployed client's origin, then:

```sh
npx wrangler d1 create ftb-registry            # once; paste the id into wrangler.toml
npx wrangler d1 migrations apply DB --remote
npx wrangler d1 execute DB --remote --file=.import.sql
npx wrangler deploy
```

Put Cloudflare Access in front of the route (ADR-1); browsers and the MCP server then carry nothing the service checks. Until Access is set up, run in **owner-token mode** (next section) — never deploy the API open.

### Deploying from the Cloudflare dashboard (no wrangler)

`npx wrangler deploy --dry-run --outdir=deploy/service` produces a single-file bundle, `deploy/service/index.js`, that the dashboard's Worker editor accepts as-is (Workers & Pages → Create → Worker → Edit code, paste, Deploy; then Settings → Bindings → add the D1 binding `DB`, Settings → Variables → `CORS_ORIGINS`, and Settings → Variables → Secrets → `OWNER_TOKEN`, `MACHINE_TOKEN`). Set the compatibility date and the `nodejs_compat` flag under Settings → Runtime to match `wrangler.toml`. The D1 console (D1 → your database → Console) accepts multiple `;`-terminated statements: paste `deploy/service-migrations.sql` first, then `deploy/service-seed.sql`; `GET /api/v1/health` should then report the seed's row count.

## Owner bearer — owner-token mode, until Access

With no Access in front of the Worker the API would be open to anyone who finds the URL. So the service has a second credential of its own: `OWNER_TOKEN`, a Worker secret. Setting it flips the service into owner-token mode:

- `Authorization: Bearer <OWNER_TOKEN>` is the owner: every route, full access; `actor` defaults to `OWNER_ACTOR` (a plain var, default `ftb`), `source` to `app`. The covenant is unchanged — a token is not a `human_judgment` attestation.
- Every route except `GET /api/v1/health` and the CORS preflight requires a valid bearer (owner or machine). A request with no `Authorization` header is `401 { error: "unauthorized" }`, with the CORS headers so the app can read it and ask for the token in its Settings panel.
- The machine bearer (below) keeps exactly its scope; both comparisons are constant-time and both run on every request.
- Unset `OWNER_TOKEN` and the service is back in Access mode, exactly as before.

Generate a long random token (`openssl rand -base64 32`), set it as the secret, and paste the same value into the app's Settings (API base URL + owner token, kept in the browser's local storage) and into the MCP server's `REGISTRY_TOKEN` secret.

## Machine bearer (the Google Tasks relay)

A relay cannot sign in to Access, so the service has one optional credential of its own: `MACHINE_TOKEN`, a Worker secret (`npx wrangler secret put MACHINE_TOKEN`; locally, `.dev.vars`). A request with `Authorization: Bearer <that token>` is accepted as the machine actor `MACHINE_ACTOR` (a plain var, default `gt-relay`) when it names no actor of its own, and may only reach `GET /health|registry|registry/open|queue|radar|dated` and `POST /capture|tasks/:id/note` — everything that judges, closes, reopens or flushes is 403 for it, so a leaked token cannot triage. A wrong bearer, or any bearer while the secret is unset, is 401. Requests without an `Authorization` header are not affected: browser users still come through Access.

Access still has to let those requests reach the Worker. Two ways: an Access **bypass** policy scoped to the paths the relay uses (`/api/v1/capture`, `/api/v1/dated`), with the bearer as the only guard on them; or an Access **Service Auth** policy, in which case the relay must add the `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers alongside the bearer (the v2 script does not). Beware the failure mode either way: an Access-blocked request gets a 302 to the login page, and a client that follows redirects sees a 200 HTML page — the relay's POST would count that as success and advance its cursor. `integrations/google-tasks/FIT-ASSESSMENT.md` has the relay-side detail.

Relay-facing endpoints: `GET /api/v1/dated` (the flat dated-rows array a mirror needs) and `POST /api/v1/capture`, which also accepts the relay's `{ rows: [...] }` shape and says so with `normalized_from: "rows"` in the response. A `source: "gtasks"` capture lands as Status=Inbox, Triaged=null, no scores, with `actor=gt-relay source=gtasks` in the `judgments` log — `test/relay.test.ts` covers all three.

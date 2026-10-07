# Free the Brain — MCP server

A remote MCP server (Streamable HTTP) in front of the Registry Service (`service/`, contract in `docs/api-contract.md`). Any MCP-capable host — Claude, ChatGPT, Cursor — connects to it and works the registry through tools. The tool list is written so the automation covenant is legible from the tool descriptions alone, because that is all a connected model ever sees.

**The covenant in one paragraph.** Triage is a human act; these tools stage it. Reading, ordering, chunking, flagging, capturing and note-taking are free. Changing U, I, status, deadline or category — including closing or reopening a task — is his judgment: the model records it only after he has made it in the conversation, attested with `human_judgment: true`. A call that touches a triage field without that attestation is refused **here**, before any request leaves the process, and refused **again** by the service (HTTP 403 `{ error: "covenant" }`). `propose_scores` returns proposals and writes nothing.

## Layout

| File | What |
|---|---|
| `src/server.ts` | The tools and the MCP App resource, on `McpServer` from the official SDK. |
| `src/app.ts` | Web-standard request handler: pluggable auth check (bearer by default), stateless Streamable HTTP, one server+transport per request. Shared by both entries. |
| `src/node.ts` | Node entry (`npm run dev`) — adapts `node:http` to the handler. |
| `src/worker.ts` | Cloudflare Worker entry — the OAuth provider, with the same handler on `/mcp`. |
| `src/oauth.ts` | The provider's default handler: the `/authorize` sign-in page, `/` and `/health`. |
| `src/client.ts` | Fetch client for the Registry Service. Every write carries `actor` and `source: "mcp"`. |
| `src/covenant.ts` | The local refusal: guarded fields are `u`, `i`, `status`, `deadline`, `category`, `reopen`. |
| `src/staging.ts`, `src/dates.ts` | The staging text, and the date / staleness chips as text. The semantics behind them — DL / SO / SB states, tiers, the ISO-week Monday, the Sofia clock — are `@ftb/core`'s (ADR-2). |
| `src/types.ts` | The wire envelopes and request bodies from the API contract. The row shape and enums are re-exported from `@ftb/core`. |
| `src/proposals.ts` | The `propose_scores` placeholder heuristic. |
| `src/ui.ts` | The MCP App view (read-only HTML rendering of one chunk). |
| `test/` | vitest: a fake Registry Service on `node:http` + the SDK client over Streamable HTTP. |
| `scripts/build-ui.mjs` | Copies the ext-apps browser bundle into `src/generated/` for the Worker build. |
| `scripts/worker-smoke.ts` | Manual run through `wrangler dev --local`: the full OAuth flow, then a tool round trip with the issued token. |
| `scripts/integration-smoke.ts` | Manual run against the REAL `service/` (seeded `wrangler dev`): queue → stage → propose (no write) → unattested refusal → note_append → the pending delta parses with core. Writes one note line; re-seed afterwards. |

## Run locally

```sh
cd mcp
npm install            # the repo's .npmrc sets legacy-peer-deps (npm 10.9 crashes on vitest 4's peer graph otherwise)
npm test               # 29 tests: the tools against a fake service, the sign-in page against a fake OAuth provider
MCP_TOKEN=choose-a-long-random-string REGISTRY_URL=http://127.0.0.1:8787 npm run dev
# → free-the-brain MCP (Node) listening on http://127.0.0.1:8788/mcp
```

Environment (Node entry):

| Variable | Meaning |
|---|---|
| `MCP_TOKEN` | Shared bearer token every MCP request must carry. **Unset = every request refused with 401**; the server never runs open by accident. |
| `REGISTRY_URL` | Origin of the Registry Service; `/api/v1` is appended. Default `http://127.0.0.1:8787` (wrangler dev of `service/`). |
| `REGISTRY_TOKEN` | Bearer forwarded to the service as `Authorization: Bearer …` on **every** request, reads included. Required when the service runs in owner-token mode (its `OWNER_TOKEN`, see `docs/api-contract.md` § Auth); optional behind Access. A 401 from the service surfaces as a tool error that names the fix. |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | Optional Cloudflare Access service-token pair, forwarded as `CF-Access-Client-Id/-Secret` when the service sits behind Access (ADR-1). |
| `PORT`, `HOST`, `MCP_PATH` | Defaults `8788`, `127.0.0.1`, `/mcp`. |

`GET /health` answers without auth. `GET`/`DELETE /mcp` return 405: the server is stateless (no session, no standalone SSE stream) — each POST gets a fresh `McpServer` and transport, which is what lets the same code run on Workers where nothing survives between isolates. Responses are JSON (`enableJsonResponse`), not SSE.

To reach it from a hosted client while developing, put it behind a tunnel (`cloudflared tunnel --url http://127.0.0.1:8788` or `ngrok http 8788`) and use the public URL.

## Connect it to Claude

Claude custom connectors are a paid-plan feature (Pro / Max / Team / Enterprise).

1. Claude → Settings → Connectors → **Add custom connector**.
2. Name: `Free the Brain`. Remote MCP server URL: `https://<your-host>/mcp`.
3. Authentication: none to enter. Leave **Advanced settings** empty; Claude runs the OAuth sign-in and the page asks for the `MCP_TOKEN` value (see Workers and OAuth below). A local Node server behind a tunnel has no OAuth: there, paste `MCP_TOKEN` as the bearer token under Advanced settings.
4. In a chat, enable the connector and try: "full pass status", "triage 5", "capture: book the dentist".

Claude renders MCP Apps (web and desktop, since 2026-01-26), so `triage_stage` shows the chunk inside the chat as the read-only view. Whether the view renders in the **phone** apps is unverified — the plan (§2.3) flags this as the first thing to test; the staging text works everywhere regardless.

## Connect it to ChatGPT

1. ChatGPT → Settings → Connectors (Developer mode must be on for custom MCP servers) → **Create**.
2. Name, URL `https://<your-host>/mcp`, authentication: OAuth for the Worker (the sign-in page asks for `MCP_TOKEN`); bearer token → `MCP_TOKEN` for a local Node server.
3. Confirm the read tools and `capture_add` work from a chat — that is the "any model" claim made true (plan Phase 3, step 4).

ChatGPT expects hosted servers over HTTPS; the tunnel above is enough for a first test.

## Tools

All tools share the covenant summary in their description. `actor` is who is speaking through the model: `"ftb"` when recording his words, otherwise the client name (`"claude"`, `"chatgpt"`). `source` is always `"mcp"`.

| Tool | Writes? | Attestation | What |
|---|---|---|---|
| `registry_read { open_only? }` | no | — | Rows + counts, stamp, today, next free / reserved IDs. |
| `registry_queue { chunk?=5, page?=0 }` | no | — | The five-tier queue for the ISO week, with tiers and the legend text. |
| `registry_radar { days?=14 }` | no | — | overdue · today_tomorrow · fortnight · passed_not_overdue · further · dormant · undated. |
| `triage_stage { chunk?=5, page?=0 }` | no | — | The chunk + staging text (legend, then `T-nnn (name) · cat · U/I · status · date-state · judged Nd ago / never judged · first sentence of note`, subtasks indented) + the MCP App view. |
| `triage_record { actor, human_judgment, today?, judgments[] }` | yes | **required** for u / i / status / category / deadline / reopen; note-only batches pass | Forwards to `POST /judgments`. Refused locally without attestation — the service is never called. |
| `capture_add { actor, items[{task, category?, notes?}] }` | yes | — | New Inbox rows, next free IDs, Triaged empty. Allowed autonomously. |
| `task_close { id, actor, human_judgment, done_date?, note? }` | yes | **required** | `POST /tasks/:id/close`. A status change, so his judgment. |
| `task_reopen { id, actor, human_judgment, status, note? }` | yes | **required** | `POST /tasks/:id/reopen`. |
| `note_append { id, actor, text }` | yes | — | Appends one line to Notes; never overwrites. Value observations go here. |
| `propose_scores { ids[] }` | **no** | — | `{ proposals: [{ id, task, u, i, reasoning, current }], disclaimer, written: false }`. Placeholder heuristic: overdue → U=H; hard deadline ≤14d or any date ≤7d → U=H; ≤30d → U=M; else L. Art College / Real Estate → I=H; Freelance / Website → I=M; else L (hard deadline lifts to M). |
| `full_pass_status {}` | no | — | Branches judged this cycle vs total open branches, entries remaining by tier, the cycle Monday. |

Note on `task_close` / `task_reopen`: the brief sketched them without `human_judgment`; it was added because the API contract requires it on both endpoints and hard-coding `true` in the MCP layer would have the server attest on the model's behalf — the one thing the covenant forbids.

### The MCP App view

`triage_stage` declares `_meta.ui.resourceUri = ui://free-the-brain/triage-stage.html` via `@modelcontextprotocol/ext-apps` 1.7.5 (`registerAppTool` / `registerAppResource`). The resource is a single self-contained HTML document: the official ext-apps browser bundle (`app-with-deps.js`, ~330 KB) is inlined because hosts sandbox views under a CSP that blocks external scripts. It connects with `App.connect()`, listens for `ontoolresult`, and renders the chunk in the Master widget's style — tier labels, category hues, date and staleness chips. **Read-only for now**: judging inside the view (the widget's editor and Send) is a later pass; until then the model records his judgments through `triage_record`.

The Node entry reads the bundle from `node_modules` at startup; the Worker build inlines it via `npm run build:ui` → `src/generated/ext-apps-bundle.txt` (gitignored) and a wrangler `Text` module rule.

## Cloudflare Workers

The SDK's `WebStandardStreamableHTTPServerTransport` (Request/Response, no Node streams) runs cleanly on workerd in stateless mode. Verified locally:

```sh
npm run build:ui
printf 'MCP_TOKEN=throwaway\nREGISTRY_URL=http://127.0.0.1:8787\n' > .dev.vars   # gitignored; delete afterwards
npx wrangler dev --local --port 8790                  # terminal 1 (local workerd + local KV, no account needed)
MCP_TOKEN=throwaway npx tsx scripts/worker-smoke.ts   # terminal 2
# PASS  GET /.well-known/oauth-authorization-server — 200; scopes_supported ["registry:read","registry:write"]; …
# PASS  POST /mcp without a token → 401 + resource_metadata — …
# PASS  POST /oauth/register → 201 · GET /authorize → password page · wrong password → 401
# PASS  right password → 302 with a code · POST /oauth/token (PKCE S256) → access_token
# PASS  initialize with the access token → 200 · with a bad token → 401 · with the bare MCP_TOKEN → 401
# tools: registry_read, registry_queue, … full_pass_status
# stage: TRIAGE STAGE — chunk 1 of 1 (5 per chunk) — today 2026-09-07 · …
# covenant refusal isError: true | write requests that reached the service: 0
# view: 327362 bytes, text/html;profile=mcp-app
```

One Workers-specific bug was found and fixed along the way: storing `fetch` as a method and calling it with a foreign `this` throws "Illegal invocation" under workerd (`src/client.ts` wraps it).

`npm run bundle` writes a self-contained `deploy/mcp/worker.js` (wrangler's dry-run output with the ext-apps Text module inlined by `scripts/inline-bundle.mjs`) for pasting into the dashboard's Worker editor — set `REGISTRY_URL` as a variable, `MCP_TOKEN` and `REGISTRY_TOKEN` as secrets, the `OAUTH_KV` binding, and the `nodejs_compat` flag. `wrangler.toml` carries the real account id, `REGISTRY_URL` and the `OAUTH_KV` binding. Before deploying: set `REGISTRY_URL` in `[vars]`, `wrangler secret put MCP_TOKEN` (and `REGISTRY_TOKEN` / `CF_ACCESS_CLIENT_*` if the service needs them), then `npm run worker:deploy`. `.dev.vars.example` lists the secrets for local `wrangler dev`.

### Workers and OAuth

The Worker sits behind `@cloudflare/workers-oauth-provider` (ADR-1), so Claude and ChatGPT connect as ordinary custom connectors. `src/worker.ts` is the provider; `src/oauth.ts` is its sign-in page.

| Path | Who answers | What |
|---|---|---|
| `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource[/mcp]` | provider | Discovery (RFC 8414 / RFC 9728). |
| `/oauth/register` | provider | Dynamic Client Registration — the connector registers itself. |
| `/authorize` | `src/oauth.ts` | The sign-in page. One password: the `MCP_TOKEN` secret. |
| `/oauth/token` | provider | Code-for-token exchange (PKCE S256), refresh, revocation. |
| `/mcp` | provider → `app.ts` | Requires an access token issued above; anything else is 401 with a `resource_metadata` challenge. |
| `/`, `/health` | `src/oauth.ts` | JSON `ok`, no auth. |

**Connecting.** Add the connector with the bare URL, `https://free-the-brain-mcp.christo-edrev.workers.dev/mcp`, and **no token** (leave Advanced settings empty). The host discovers the endpoints, registers, and opens the sign-in page; it asks for the `MCP_TOKEN` value (the GitHub secret `FTB_MCP_TOKEN`). The right password sends the browser back to the host with a code; the host exchanges it for tokens and refreshes them on its own from then on.

What the sign-in page does:

- `GET /authorize` validates the request with `parseAuthRequest` (client, redirect URI, PKCE), then renders the password form, carrying the original query string in a hidden field. Everything on the page is HTML-escaped; it is never framed and never cached.
- `POST /authorize` re-validates that query string, compares the password with `MCP_TOKEN` in constant time (SHA-256 both sides, then a no-early-exit compare), and on a match calls `completeAuthorization` as user `ftb` (props `{ userId: "ftb", displayName: "FtB" }`, scopes `registry:read registry:write`) and 302s to the client's redirect URI. A wrong password is a 401 and the form again.
- `MCP_TOKEN` unset → 503. An unconfigured Worker never issues a token, and it never runs open.
- A failed request is handled the way the package README prescribes: with no validated redirect URI the error is rendered on the page, never redirected; with one, it goes back to the client as an OAuth error (`error`, `state`, `iss`).

On `/mcp` the provider has already checked the access token before `app.ts` runs; the Worker's `AuthCheck` then accepts only `ctx.props.userId === "ftb"`. `MCP_TOKEN` is no longer a bearer on the Worker: sent as one, it gets a 401 like any other unknown token. The Node entry (`src/node.ts`) is unchanged and keeps its bearer mode for local dev.

Clients, grants and token hashes live in the `OAUTH_KV` namespace (`ftb-oauth`, bound in `wrangler.toml`). The provider stores tokens only as hashes and encrypts `props`. Signing in again from the same client revokes that client's earlier grant. To sign every connector out, rotate `FTB_MCP_TOKEN` (that changes the password for the next sign-in) and clear the namespace's keys in the dashboard.

Client ID Metadata Documents (the newer alternative to DCR) are off. They would need the `global_fetch_strictly_public` compatibility flag, and `wrangler dev` notes this at startup; DCR is enough for Claude and ChatGPT today.

`scripts/worker-smoke.ts` runs the whole flow against `wrangler dev --local` (see the Cloudflare Workers section above).

## What is still stubbed or unverified

- **The MCP App view is read-only.** No editor, no Send inside the view.
- **`propose_scores` is a placeholder heuristic**, deliberately simple and labelled as such; the value model it will eventually draw on stays deferred (PTO Forelog F-3).
- **The MCP App view's HTML** (`src/ui.ts`) still carries its own copy of the date-state switch, because it is a self-contained document inlined for the host's sandbox and cannot import `@ftb/core`. Everything the tools compute goes through core.
- **"today"**: taken from the service's `today` when the response carries one (the registry envelope does; `/queue` and `/radar` may not), else the Europe/Sofia device date. Tests pin it.
- **Phone rendering of the MCP App view**: unverified, as the plan says.
- **Tests run against a fake service**, not `service/`. `scripts/integration-smoke.ts` is the manual run against the real one (2026-09-07: all steps pass against the seeded registry, 157 rows).

## Versions (pinned exactly)

`@ftb/core` (workspace) · `@modelcontextprotocol/sdk` 1.30.0 · `@modelcontextprotocol/ext-apps` 1.7.5 · `zod` 4.4.3 (matched to the exact pin wrangler, miniflare and vitest-pool-workers carry, so the workspace holds one copy — two copies broke `tsc` on the SDK's `AnySchema`) · `typescript` 5.9.3 · `vitest` 4.1.11 · `tsx` 4.23.13 · `wrangler` 4.129.0 · `@cloudflare/workers-oauth-provider` 0.10.3 · `@cloudflare/workers-types` 5.20260907.1 · `@types/node` 26.4.1. Node ≥ 22.

# Free the Brain — MCP server

A remote MCP server (Streamable HTTP) in front of the Registry Service (`service/`, contract in `docs/api-contract.md`). Any MCP-capable host — Claude, ChatGPT, Cursor — connects to it and works the registry through tools. The tool list is written so the automation covenant is legible from the tool descriptions alone, because that is all a connected model ever sees.

**The covenant in one paragraph.** Triage is a human act; these tools stage it. Reading, ordering, chunking, flagging, capturing and note-taking are free. Changing U, I, status, deadline or category — including closing or reopening a task — is his judgment: the model records it only after he has made it in the conversation, attested with `human_judgment: true`. A call that touches a triage field without that attestation is refused **here**, before any request leaves the process, and refused **again** by the service (HTTP 403 `{ error: "covenant" }`). `propose_scores` returns proposals and writes nothing.

## Layout

| File | What |
|---|---|
| `src/server.ts` | The tools and the MCP App resource, on `McpServer` from the official SDK. |
| `src/app.ts` | Web-standard request handler: bearer auth, stateless Streamable HTTP, one server+transport per request. Shared by both entries. |
| `src/node.ts` | Node entry (`npm run dev`) — adapts `node:http` to the handler. |
| `src/worker.ts` | Cloudflare Worker entry — the same handler on `fetch`. |
| `src/client.ts` | Fetch client for the Registry Service. Every write carries `actor` and `source: "mcp"`. |
| `src/covenant.ts` | The local refusal: guarded fields are `u`, `i`, `status`, `deadline`, `category`, `reopen`. |
| `src/staging.ts`, `src/dates.ts` | The staging text, and the date / staleness chips as text. The semantics behind them — DL / SO / SB states, tiers, the ISO-week Monday, the Sofia clock — are `@ftb/core`'s (ADR-2). |
| `src/types.ts` | The wire envelopes and request bodies from the API contract. The row shape and enums are re-exported from `@ftb/core`. |
| `src/proposals.ts` | The `propose_scores` placeholder heuristic. |
| `src/ui.ts` | The MCP App view (read-only HTML rendering of one chunk). |
| `test/` | vitest: a fake Registry Service on `node:http` + the SDK client over Streamable HTTP. |
| `scripts/build-ui.mjs` | Copies the ext-apps browser bundle into `src/generated/` for the Worker build. |
| `scripts/worker-smoke.ts` | Manual round-trip through `wrangler dev` (local workerd). |
| `scripts/integration-smoke.ts` | Manual run against the REAL `service/` (seeded `wrangler dev`): queue → stage → propose (no write) → unattested refusal → note_append → the pending delta parses with core. Writes one note line; re-seed afterwards. |

## Run locally

```sh
cd mcp
npm install            # the repo's .npmrc sets legacy-peer-deps (npm 10.9 crashes on vitest 4's peer graph otherwise)
npm test               # 18 tests against the fake service
MCP_TOKEN=choose-a-long-random-string REGISTRY_URL=http://127.0.0.1:8787 npm run dev
# → free-the-brain MCP (Node) listening on http://127.0.0.1:8788/mcp
```

Environment (Node entry):

| Variable | Meaning |
|---|---|
| `MCP_TOKEN` | Shared bearer token every MCP request must carry. **Unset = every request refused with 401**; the server never runs open by accident. |
| `REGISTRY_URL` | Origin of the Registry Service; `/api/v1` is appended. Default `http://127.0.0.1:8787` (wrangler dev of `service/`). |
| `REGISTRY_TOKEN` | Optional bearer forwarded to the service. |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | Optional Cloudflare Access service-token pair, forwarded as `CF-Access-Client-Id/-Secret` when the service sits behind Access (ADR-1). |
| `PORT`, `HOST`, `MCP_PATH` | Defaults `8788`, `127.0.0.1`, `/mcp`. |

`GET /health` answers without auth. `GET`/`DELETE /mcp` return 405: the server is stateless (no session, no standalone SSE stream) — each POST gets a fresh `McpServer` and transport, which is what lets the same code run on Workers where nothing survives between isolates. Responses are JSON (`enableJsonResponse`), not SSE.

To reach it from a hosted client while developing, put it behind a tunnel (`cloudflared tunnel --url http://127.0.0.1:8788` or `ngrok http 8788`) and use the public URL.

## Connect it to Claude

Claude custom connectors are a paid-plan feature (Pro / Max / Team / Enterprise).

1. Claude → Settings → Connectors → **Add custom connector**.
2. Name: `Free the Brain`. Remote MCP server URL: `https://<your-host>/mcp`.
3. Authentication: the connector dialog's **Advanced settings** accept a bearer token for servers that do not use OAuth — paste the `MCP_TOKEN` value. (If your Claude build only offers OAuth, that is what the Workers OAuth section below is for.)
4. In a chat, enable the connector and try: "full pass status", "triage 5", "capture: book the dentist".

Claude renders MCP Apps (web and desktop, since 2026-01-26), so `triage_stage` shows the chunk inside the chat as the read-only view. Whether the view renders in the **phone** apps is unverified — the plan (§2.3) flags this as the first thing to test; the staging text works everywhere regardless.

## Connect it to ChatGPT

1. ChatGPT → Settings → Connectors (Developer mode must be on for custom MCP servers) → **Create**.
2. Name, URL `https://<your-host>/mcp`, authentication: bearer token → `MCP_TOKEN` (or OAuth once wired).
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
npx wrangler dev --port 8790 --var MCP_TOKEN:abc     # terminal 1 (local workerd, no account needed)
npx tsx scripts/worker-smoke.ts                       # terminal 2
# tools: registry_read, registry_queue, … full_pass_status
# stage: TRIAGE STAGE — chunk 1 of 1 (5 per chunk) — today 2026-09-07 · …
# covenant refusal isError: true | write requests that reached the service: 0
# view: 327362 bytes, text/html;profile=mcp-app
```

One Workers-specific bug was found and fixed along the way: storing `fetch` as a method and calling it with a foreign `this` throws "Illegal invocation" under workerd (`src/client.ts` wraps it).

`wrangler.toml` carries placeholder comments, no real IDs. Before deploying: set `REGISTRY_URL` in `[vars]`, `wrangler secret put MCP_TOKEN` (and `REGISTRY_TOKEN` / `CF_ACCESS_CLIENT_*` if the service needs them), then `npm run worker:deploy`. `.dev.vars.example` lists the secrets for local `wrangler dev`.

### Workers and OAuth — the hook, not the flow

ADR-1 says the MCP server uses OAuth via `@cloudflare/workers-oauth-provider` so Claude and ChatGPT connect as first-class custom connectors. That is **not wired**; today the Worker uses the same shared bearer token as local dev, and nothing pretends otherwise. The hook is marked in `src/worker.ts` (`OAUTH HOOK`). Wiring it, when the time comes:

1. `npm install @cloudflare/workers-oauth-provider@0.10.3` (current at the time of writing; pin whatever you install).
2. `wrangler kv namespace create OAUTH_KV`; paste the id into the commented `[[kv_namespaces]]` block in `wrangler.toml`.
3. Replace the default export in `src/worker.ts` with the provider wrapping the API handler:
   ```ts
   import OAuthProvider from '@cloudflare/workers-oauth-provider';
   export default new OAuthProvider({
     apiRoute: '/mcp',
     apiHandler: { fetch: (req, env, ctx) => handlerFor(env, ctx.props)(req) },   // ctx.props = the authenticated user
     defaultHandler: AuthHandler,          // your login + consent pages (single user: FtB's Google identity, or Cloudflare Access in front)
     authorizeEndpoint: '/authorize',
     tokenEndpoint: '/token',
     clientRegistrationEndpoint: '/register',   // Dynamic Client Registration — Claude and ChatGPT use it
   });
   ```
   (a sketch — `handlerFor` currently takes only `env`) and swap `bearerTokenAuth(env.MCP_TOKEN)` for a check that trusts `ctx.props` (the provider has already validated the access token by the time the API handler runs).
4. `defaultHandler` is the part that needs real design: for v1 single-user, the simplest honest option is to keep the Worker behind Cloudflare Access and let the consent page trust the Access-asserted identity.
5. In Claude / ChatGPT, add the connector with the bare server URL and no token; the host discovers `/.well-known/oauth-authorization-server`, registers, and runs the flow.

## What is still stubbed or unverified

- **OAuth**: hook only (above). Bearer token everywhere.
- **The MCP App view is read-only.** No editor, no Send inside the view.
- **`propose_scores` is a placeholder heuristic**, deliberately simple and labelled as such; the value model it will eventually draw on stays deferred (PTO Forelog F-3).
- **The MCP App view's HTML** (`src/ui.ts`) still carries its own copy of the date-state switch, because it is a self-contained document inlined for the host's sandbox and cannot import `@ftb/core`. Everything the tools compute goes through core.
- **"today"**: taken from the service's `today` when the response carries one (the registry envelope does; `/queue` and `/radar` may not), else the Europe/Sofia device date. Tests pin it.
- **Phone rendering of the MCP App view**: unverified, as the plan says.
- **Tests run against a fake service**, not `service/`. `scripts/integration-smoke.ts` is the manual run against the real one (2026-09-07: all steps pass against the seeded registry, 157 rows).

## Versions (pinned exactly)

`@ftb/core` (workspace) · `@modelcontextprotocol/sdk` 1.30.0 · `@modelcontextprotocol/ext-apps` 1.7.5 · `zod` 4.4.3 (matched to the exact pin wrangler, miniflare and vitest-pool-workers carry, so the workspace holds one copy — two copies broke `tsc` on the SDK's `AnySchema`) · `typescript` 5.9.3 · `vitest` 4.1.11 · `tsx` 4.23.13 · `wrangler` 4.129.0 · `@cloudflare/workers-types` 5.20260907.1 · `@types/node` 26.4.1. Node ≥ 22.

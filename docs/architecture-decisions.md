# Free the Brain — Architecture Decisions (ADR)

Decisions taken 2026-09-07 to begin implementation. Each is overridable in one word by FtB; until then it stands.

## ADR-1 — One vendor: Cloudflare
- **Service**: Cloudflare Workers running a Hono (TypeScript) app.
- **Database**: Cloudflare D1 (SQLite). Local development and tests run against SQLite via wrangler's local mode — no account needed to build and test.
- **Static hosting**: Cloudflare Pages for the client (`app.<domain>`) and the marketing site (`<domain>`).
- **Auth for v1 (single user)**: Cloudflare Access (Zero Trust, free tier) in front of the app and API, restricted to FtB's Google identity. Zero auth code in v1. The MCP server uses OAuth via `@cloudflare/workers-oauth-provider` so Claude/ChatGPT can connect as custom connectors.
- **Why**: one account, one CLI (`wrangler`), free tier covers everything at this scale, local emulation means Claude can build and test everything without any credentials. Supabase was the alternative; it needs a second vendor and its own auth layer.

## ADR-2 — A shared `core` package
Parser, delta applier, serialiser, date semantics and queue derivation live in `packages/core` and are consumed by the service, the client and the MCP server, so every surface derives the same queue from the same rules. Until `core` lands, the client keeps the widget's own derivation code (they are the same rules, ported from the same source).

## ADR-3 — Drive stays the archive, in the existing format
The service writes `Registry Delta — YYYY-MM-DD-HHMM.md` after every write batch and a `Task Registry — YYYY-MM-DD-HHMM.md` snapshot every five deltas or every Monday, into the existing Drive folder, byte-compatible with `_REGISTRY PROTOCOL — Delta Writes v1.md`. During the shadow period Drive remains canonical and the service is read-only from Drive's point of view.

## ADR-4 — The covenant is enforced by the service, not by prose
Every write carries `actor` (`ftb` | `claude` | `chatgpt` | `<client-name>` | `import`) and `source` (`app` | `mcp` | `voice` | `import`). Any write that changes U, I, Status, Deadline, Category or Triaged is rejected unless it carries `human_judgment: true`. Tools that propose scores return proposals and write nothing.

## ADR-5 — No framework in the client for v1
The Master widget is vanilla JS and works. The client is that code split into ES modules, built with Vite, typed gradually. Revisit at the multi-user phase.

## ADR-6 — Stamps and time
Europe/Sofia, 24-hour, `YYYY-MM-DD-HHMM` for file stamps; ISO dates in rows. The server clock is the source; never estimated.

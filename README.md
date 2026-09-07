# Free the Brain

The Personal Task Organization master widget, grown into a standalone app (web → Android → iOS) with a registry service and an MCP server so any AI client can work the registry.

- `docs/production-plan.md` — the plan of record (2026-09-07).
- `docs/architecture-decisions.md` — ADRs.
- `docs/api-contract.md` — the service API every surface builds against.
- `packages/core` — parser, delta applier, serialiser, date semantics, queue derivation (shared).
- `service/` — Cloudflare Worker (Hono + D1): the Registry Service and the Drive archive writer.
- `client/` — the app (Vite, vanilla TS, PWA); wrapped by Capacitor for Android/iOS.
- `mcp/` — the remote MCP server (tools + MCP App view).
- `site/` — the marketing site.
- `data/` — local copies of the registry (gitignored) and brand assets.

## Working on it

Node 22, npm workspaces. `npm install` at the root (the `.npmrc` sets `legacy-peer-deps`, which npm 10.9 needs to resolve vitest 4's optional peer cycle without crashing). `npm test` runs the `core` and `service` vitest projects; `npm run typecheck` runs `tsc --noEmit` in every workspace that defines it. The service tests run inside workerd against a local D1 — no account, no network. `data/registry` is gitignored; tests that need the real files skip when it is absent. See `service/README.md` for seeding the local database.

Decisions of record: v1 is single-user (FtB); canonical data moves to the service with Drive as archive; MCP server first; FtB builds it piloting AI.

# Deploy status — 2026-09-09

What is live, what is not, and the one step that unblocks the rest. No secrets appear in this file.

## Live now

| Piece | URL | How it got there |
| --- | --- | --- |
| Marketing site (`site/`) | https://freethebrain-site.christo-edrev.workers.dev | Dashboard → Upload static files |
| Web app (`client/`) | https://freethebrain-app.christo-edrev.workers.dev | Dashboard → Upload static files |
| D1 database `ftb-registry` | id `b0d6f548-e6fb-4ab0-a8ec-463dd1e1eeee` | Dashboard console: migrations, then the 168-row seed in five chunks |

The database holds the registry as of `2026-09-09-0656`: 168 rows, 93 open, 73 done, 2 dropped.
Its contents were checked against the same import run locally — row count, total notes length,
total task-name length, number of deadlines and number of triage stamps all match exactly.

The web app currently falls back to its bundled fixture and says so in a banner, because the
Registry Service it would call is not deployed yet. Once it is, the API base goes in the app's
Settings panel (gear icon) and the banner disappears.

## Not live: the two code Workers

`service/` (Registry Service) and `mcp/` (MCP server) are code Workers, not static assets, so the
dashboard's upload flow cannot take them. Deploying them needs Cloudflare's API, which the build
sessions cannot reach — the sandbox's egress policy blocks `api.cloudflare.com`, and the dashboard's
code editor is a cross-origin iframe that cannot be driven. GitHub Actions has neither restriction.

`.github/workflows/deploy.yml` therefore deploys both on a push to `main` (or on demand from the
Actions tab). It typechecks, runs the test suite, applies D1 migrations, sets the Worker secrets from
GitHub secrets, deploys, and finishes by curling `/api/v1/health` and failing if it is not 200.

### The one-time step, FtB's to take

In the repo: **Settings → Secrets and variables → Actions → New repository secret**, four times:

| Secret | What to put in it |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token with **Workers Scripts:Edit** and **D1:Edit** on the account |
| `FTB_OWNER_TOKEN` | A long random string you invent — the owner bearer the app and MCP send |
| `FTB_MACHINE_TOKEN` | A second random string — the bearer the Google Tasks relay will use |
| `FTB_MCP_TOKEN` | A third random string — the bearer your AI client sends to the MCP server |

The account and database ids are already in the two `wrangler.toml` files; nothing else is needed.
The local code is ahead of GitHub, so push first (the repo zip in the project folder carries the
full history).

After the run goes green:

1. `https://ftb-registry-service.christo-edrev.workers.dev/api/v1/health` returns 200.
2. In the web app's Settings, set the API base to that origin and the owner token to
   `FTB_OWNER_TOKEN`; the fixture banner should be replaced by live rows, 93 open.
3. The MCP server answers at `https://free-the-brain-mcp.christo-edrev.workers.dev/mcp` with
   `FTB_MCP_TOKEN` as the bearer — that is the custom connector URL for Claude.

## Rotate

The Cloudflare API token pasted into the chat on 2026-09-09 was never usable from the sandbox and
should be rolled before it is used anywhere: Cloudflare → My Profile → API Tokens → Roll. Create the
GitHub secret from the rolled value.

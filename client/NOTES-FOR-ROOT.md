# Notes for the monorepo root (client)

The client does not need any root file, but two things are worth knowing when the root is wired up:

1. **Vitest projects.** `client/vitest.config.ts` defines a project named `client` (unit tests only, `tests/unit/**`). If the root `vitest` config enumerates projects, add `client/vitest.config.ts` so `npm test` at the root picks it up; `vitest run --project client` will then work. The Playwright e2e suite is deliberately outside vitest — run it with `npm run test:e2e --workspace client` (Chromium at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; never `playwright install` in the build environment).
2. **Installing.** The client was developed with `npm install --workspaces=false` inside `client/` so nothing was written at the root. Once a root lockfile exists, a plain `npm install` at the root will hoist the client's dev dependencies (`vite 7.1.12`, `vitest 4.1.11` — same as the root —, `typescript 5.9.3`, `@playwright/test 1.56.1`) and `client/node_modules` can be deleted.
3. **Cloudflare Pages.** Build command `npm run build --workspace client`, output directory `client/dist`, environment variable `VITE_API_BASE` pointing at the service. `public/sw.js` and `manifest.webmanifest` are served from the site root, which is what the manifest and the SW registration assume.

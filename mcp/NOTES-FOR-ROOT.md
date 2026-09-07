# Notes for the root (mcp/ needs these; not applied here)

1. **vitest projects** — `vitest.config.ts` at the root lists `['packages/core', 'service']`. Add `'mcp'` so `npm test` at the root runs `mcp/test/` too (mcp has its own `vitest.config.ts`).
2. **legacy-peer-deps** — already in the root `.npmrc`, good. `mcp/.npmrc` carries the same line for a standalone `npm install` inside `mcp/`; npm ignores it when installing through the workspace, which is fine.
3. **Typecheck** — `npm run typecheck --workspaces` will run `mcp`'s `typecheck`, which first runs `build:ui` (copies the ext-apps browser bundle into `mcp/src/generated/`, gitignored). No root change needed; just noting the generated file.
4. **Shared types** — done: `mcp/` depends on `@ftb/core` (workspace) for the `Task` shape, the enums, `dstate`, `cycleMonday`, `sofiaToday`, `parentOf`, `depthOf`, `TIER_NAMES` and the new `daysSinceTriage`; the fake service in `test/` derives its queue with core's `buildQueue`. `mcp/tsconfig.json` sets `noEmit` + `allowImportingTsExtensions` so core's `.ts`-suffixed relative imports typecheck under NodeNext (nothing emits with tsc — tsx and wrangler bundle from source).

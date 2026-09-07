# Free the Brain — client

The Master widget (see "Master Widget — Render Spec" in the Personal Task Organization project) as a standalone PWA: the spec's HTML template split into ES modules, built with Vite, vanilla TypeScript, no framework (ADR-5). Behaviour is the template's, verbatim; the additions are a data loader, an API submit on Send, phone-first chrome, and the PWA shell.

## Run

```sh
cd client
npm install --workspaces=false   # the monorepo root declares workspaces; this keeps node_modules inside client/
npm run dev                      # http://localhost:5173 — fixture mode by default on localhost
npm run build                    # typecheck + vite build → dist/
npm run preview
npm run icons                    # regenerate public/icons/* (no image library needed)
```

`VITE_API_BASE` — base URL of the Registry Service (no trailing slash), e.g. `VITE_API_BASE=http://localhost:8787 npm run dev`. Copy `.env.example` to `.env.local` to set it permanently. When unset, api mode uses the same origin (`/api/v1/...`). Every API request goes through `apiFetch` (`src/data/loader.ts`) with `credentials: "include"`, so the Cloudflare Access session cookie travels when the app and the API sit on different origins; same-origin is unaffected. The service's CORS answer must then name the exact app origin and send `Access-Control-Allow-Credentials: true`.

## Two data modes

| Mode | When | Source |
|---|---|---|
| `api` | `?src=api`, or by default when the hostname is not `localhost` or `VITE_API_BASE` is set | `GET ${VITE_API_BASE}/api/v1/registry`; `TODAY` from the device clock in Europe/Sofia; `STAMP`, `RESERVED` and `NEXTNUM` from the envelope. If the service cannot be reached the app falls back to the fixture and says so in the notice line. |
| `fixture` | `?src=fixture`, or by default on `localhost` | `public/fixture.json` — 25 open rows across all seven categories, every status, DL/SO/SB dates, subtasks to depth 2, seven Done rows and one Dropped, all synthetic and dated relative to a frozen `TODAY` of 2026-09-07. Same envelope shape as the API. |

Mapping (`src/data/loader.ts`): the API `Task` becomes the widget row `id task cat u i st rec tri dl ty kind d note blk` — `d` is the number of dots in the id; `ty` from `deadline_type`, `kind` from `deadline_kind`; `blk` for Blocked rows is the API's `blocker` if set, else the text after "waiting on" / "blocked on" in the notes, else null. Done rows become `DONE` (`id task cat done`); Dropped rows are closed and not displayed (the widget's `DONE` list is dated by completion).

## Send results

The clipboard/export panel is unchanged from the template. In api mode, Send first `POST`s the same text to `${VITE_API_BASE}/api/v1/judgments/text` (`Content-Type: text/plain`, `X-Actor: ftb`, `X-Human-Judgment: true`). On success the panel's state line reads `Recorded n judgments · delta <stamp>`, the helper line under it reads `Recorded — your judgments are in the registry.`, the pending store is cleared, and the rows reload from the service. On failure the panel falls back to the clipboard flow — the template's `Paste this into the chat…` helper line, the error in the state line — and every judgment kept, in memory and in local storage.

## Capture from any tab

`+ Capture` in the controls row reveals a single input under it; Enter adds the line as a capture row and keeps the box open for the next one. It writes to the same store the Triage tab's capture rows use — reserved IDs first, then extras past `NEXTNUM` — so the row shows on the Triage tab, counts in the Send badge, survives a reload, and lands in Send results under `NEW TASKS`. The tab does not change: capture costs one line and nothing else. The share sheet on Android lands in the same store.

## Tests

```sh
npm run test:unit     # vitest — derive modules: DL/SO/SB states, offsetDate clamping, quadrant, staleness, queue tiers, loader mapping, output contract
npm run test:e2e      # playwright — starts vite on :5173, fixture mode, Chromium
```

Chromium is preinstalled under `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` in the build environment; do not run `playwright install` there. The e2e tests verify behaviour **by computed style, never by class presence** — the spec's standing lesson after the vanishing-row bug: `.det` is `display:block` after a tap, a status chip's background really changes, the row element under the cursor is still `isConnected`, the done circle produces `text-decoration-line: line-through`, and Send's text carries the judged row's id and fields. A second file mocks the service to cover the api-mode send (including that every API fetch carries `credentials: "include"`, recorded by a fetch shim installed before boot, and the helper line after a live send), its failure path, and the fixture fallback. A third covers the `+ Capture` box: revealed by computed style, rows landing in the Triage store and in `NEW TASKS`, extras past the reserved block, and survival across a reload.

## Layout

```
src/
  main.ts            boot, event delegation (click / input / keydown), Send handler, SW registration
  constants.ts       CATS, TABS, HINTS, STATUS, MODES, TYPES, TIERS, CAPS, CHUNK, QNAME
  state.ts           view state (tab, folds, open cards, capture rows)
  styles.css         the template's stylesheet + brand tokens + phone-first bottom bar
  data/              types.ts (row + API shapes), registry.ts (the injection block, mutable), loader.ts
  derive/            dates.ts, quadrant.ts, staleness.ts, effective.ts, tree.ts, queue.ts
  render/            html.ts, item.ts, editor.ts, portfolio.ts, radar.ts, eisenhower.ts, waiting.ts, done.ts, triage.ts, index.ts
  editor/            pending.ts (the pending store), sync.ts (syncRow / setSt — in-place updates)
  results/           build.ts (buildResults — the output contract), send.ts (clipboard + API submit)
  persist/           store.ts (localStorage keyed by stamp, with the template's fallbacks)
public/              fixture.json, manifest.webmanifest, sw.js, icons/
scripts/gen-icons.mjs  placeholder icons drawn and PNG-encoded with Node's zlib only
tests/unit, tests/e2e
```

DOM ids, class names, CSS custom properties and `data-*` attributes are the template's, so the spec's event delegation and its two-bug history still apply as written. `syncRow` keeps the "never rebuild the element under the cursor" rule and its comment.

## PWA

`public/manifest.webmanifest` (name "Free the Brain", short name "FreeBrain", theme `#8e9dfa`, background `#fbfaf8`, standalone) and `public/sw.js` — cache-first for the app shell, network-first for `/api/` with the last good response as the offline fallback. The service worker is registered in production builds only. Icons are placeholders: a periwinkle disc with a simple pink brain-like blob, generated by `scripts/gen-icons.mjs` — no external artwork.

## Deliberate changes from the template

Everything else is the template's behaviour, ported line for line.

1. **Injection block → loader.** `STAMP / TODAY / RESERVED / NEXTNUM / ROWS / DONE` are loaded at start-up (and after a successful send) instead of being baked in. In api mode `TODAY` is the device's date in Europe/Sofia rather than a staging day, so an instance no longer goes stale overnight — it re-derives on reload.
2. **Send results in api mode** submits to the service before showing the clipboard panel (above). Fixture mode and any failure behave exactly as the template.
3. **Provenance line** gains a trailing `· live` / `· fixture` so the data mode is visible.
4. **Send button** is brand periwinkle (`--brand-periwinkle`) with the outline ink, in both themes, instead of the template's ink-on-paper inversion. The brand tokens (`--brand-periwinkle`, `--brand-ring`, `--brand-brain`, `--brand-cream`, `--brand-slate`, `--brand-outline`) are defined on `:root` and used nowhere else.
5. **≤720px:** the tab bar is `position:fixed` at the bottom (same elements and ids), Send floats above it as a pill, and the row's right-hand chip cluster may shrink and wrap (`.ir{flex:0 1 auto}`, `.iname{flex:1 1 120px}`) instead of overflowing onto the task name as the template's `flex:none` does at 400px.
6. **Unreachable service** in api mode falls back to the fixture with a notice rather than an empty page.
7. `body[data-ready="1"]` is set after the first render, for the tests to wait on.
8. **`+ Capture`** in the controls row (`#capbtn`, `#quickcap`, `#quickbox`) — the template's capture rows live only on the Triage tab; the box makes the same store reachable from every tab.
9. **The export panel's helper line** is dynamic (`#expnote`): the template's paste instruction in the clipboard flow, `Recorded — your judgments are in the registry.` after a live send.

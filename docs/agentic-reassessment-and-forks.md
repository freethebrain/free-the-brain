# Free the Brain — Agentic Reassessment and Fork List

*Written 2026-09-07-1834 (Europe/Sofia). Supplements the Production Plan of 2026-09-07-0920; where the two differ, this one stands.*

## 1. What changed

The four-month estimate assumed you piloting an AI IDE three evenings a week. You asked instead to push as much as possible through Cowork. The reassessment below is not a forecast: it is a report of what was actually built today in one session, and a schedule built from that measured rate rather than from guesses.

**Built and verified today (about six hours of agent time, all tests green — 119 tests across four packages, typecheck clean):**

- `packages/core` — parser, delta applier, serialiser, date semantics, five-tier queue. Round-trips the real registry byte for byte; applies the nine live deltas to reach 157 rows (82 open / 73 done / 2 dropped, next free T-103), matching the last delta's own count line.
- `service/` — the Registry Service on Cloudflare Workers + D1: every endpoint in the API contract, the covenant enforced (403 on unattested score changes, note-only allowed), the widget's text contract accepted, the Drive archive writer producing byte-compatible deltas and snapshots, CORS for the app origin. Tested inside a real local workerd.
- `client/` — the Master widget split into 30 modules, live data from the service, Send results writing to the API with clipboard fallback, offline service worker, PWA manifest, bottom tab bar on phones, brand tokens. Playwright verifies behaviour by computed style, per the render spec's standing lesson.
- `mcp/` — the remote MCP server: eleven tools, covenant refusal before any network call, `propose_scores` that provably writes nothing, an MCP App view for `triage_stage`, runs on Node and on Workers.
- **End-to-end proven** against your real data: seed → service → MCP `triage_stage` → the app judging a row → `Send` → the service → a valid Drive delta. Screenshots in `docs/screenshots/`.
- Android — Capacitor project with share-to-Inbox intent, local notifications for hard deadlines (1d/3d, 09:00), haptics, status bar, splash and icons from your own mark; release signing wired to a keystore you will create.
- Brand — your brain traced to vector from *the_soul* (`data/brand/derived/`): mark, silhouette, icon set, adaptive icon layers, Play feature graphic with the 5-pager's stripe motif; `docs/brand-system.md` with palette, stripe rule, type choice, voice.
- Site — four static pages (landing, privacy policy, support, connect-your-AI) with the display face self-hosted; Cloudflare Pages-ready.

**What this does to the plan:** Phases 0–3 and most of 4–5 are code-complete in one day. What remains is not code. It is accounts, keys, a phone in your hand, twelve testers, and two review queues — and none of that compresses by adding agents.

## 2. The compressed schedule

| Week | What happens | Whose hands |
|---|---|---|
| **This week** | You: forks F-1…F-5 below (about an hour of your time, spread over two sittings). Claude: deploy service, MCP server, web app and site the moment the Cloudflare token exists; seed the real registry; start the shadow period; connect the MCP server to your Claude as a custom connector and run one real triage chunk through it. | you 1h · Claude the rest |
| **Week 2** | Closed testing opens on Play (needs F-2 and F-6). Claude fixes whatever your phone reports; F-9 lesson: three clean sessions on the real build. Shadow period continues — every judgment lands in the service *and* as a Drive delta. | you: install, use, report · Claude: fix |
| **Week 3** | Flip: Drive becomes the archive (a Monday, after compaction). Project instructions get their one-line edit. Testers hold. Polish pass 2 from live use. | you: one word · Claude: the flip |
| **Week 4** | Day 14 of closed testing → production access → Play release. Site goes live with the real Play badge. | you: two clicks · Claude: the rest |
| **After** | iOS, when you decide to pay Apple's fee (F-8). BYOK chat and multi-user stay deferred. | — |

Four weeks to Google Play instead of four months, with roughly four hours of your time in total. The floor is Google's 14-day tester rule, not development.

## 3. What Claude can and cannot do through Cowork

**Can, and will, unattended:** write and test every line of code; run the full suites; deploy to Cloudflare with a scoped token; generate assets; write listing and policy text; drive your Chrome (with your per-site permission) to fill Play Console forms, check tester counts and read review feedback; write registry deltas on your word; watch a CI run or a build and report.

**Cannot, by design — these stay with you:** paying anything (the Play fee, Apple's fee, a domain); creating accounts or entering passwords, 2FA codes or card details; generating and storing the upload keystore (you must own it); clicking the irreversible store buttons (first upload under an ID, production rollout) — Claude prepares each to the last click and asks; recruiting the twelve testers; holding the phone.

**On your question about Chrome:** yes. This session has your Chrome extension connected and can open tabs, read pages, fill forms and click, within the site permissions you grant in the extension. What Claude will not do in it is the list above, however the request is phrased. As for how closely this matches "GPT 6 Astra": I could not verify that product — a search returned nothing under that name — so I cannot compare against it honestly. What I can say is what this session does: browse and act in your Chrome and in the app's own built-in browser, run code and tests in its own sandbox, read and write your connected folders, publish artifacts, schedule unattended runs, and spawn parallel agents for independent work — which is how today's build was done.

## 4. Forks — decisions and actions that are yours

Each fork blocks something specific; nothing else waits on it. Do them in order; F-1 and F-2 today if possible.

**F-1 — Domain.** Decide the domain. `freethebrain.app` is assumed everywhere as a placeholder (site links, MCP URL, the Android application ID `app.freethebrain.registry`). Buy it, or name another. *Blocks:* the permanent application ID (must be right before the first Play upload), the privacy-policy URL, the MCP connector URL. *Claude then:* replaces every placeholder, points Cloudflare at it.

**F-2 — Google Play developer account.** Register and pay the one-time fee; complete verification. *Blocks:* the 14-day tester clock. *Claude then:* nothing until F-6; but the clock cannot start without this.

**F-3 — Cloudflare account + API token.** Create a free Cloudflare account; create an API token with Workers, D1 and Pages edit permissions (Claude will give you the exact template name when you are at the screen, or drive the screen in Chrome with you watching — the token value itself goes into `service/.dev.vars`-style secrets that only you paste). *Blocks:* every deployment. *Claude then:* deploys service, MCP, app, site; seeds the real registry; starts the shadow period the same hour.

**F-4 — Cloudflare Access identity.** Confirm which Google identity should be the single allowed user (christo.edrev@gmail.com is assumed). *Blocks:* locking the app and API. *Claude then:* configures Access; you sign in once on each device.

**F-5 — Drive archive writer credential.** The service needs permission to write files into the Task Registry folder. Two routes: a Google Cloud service account with the folder shared to it (cleanest, needs you to create a project and share the folder), or Claude continuing to write deltas through this session's Drive connector on your word during the shadow period (works today, zero setup, keeps a human in the loop). *Recommendation:* start with the second, add the service account when the flip is near. *Blocks:* unattended archive writes only.

**F-6 — Upload keystore + twelve testers.** Follow `docs/android-release.md` steps 3–4 on your PC (Android Studio, one keytool command, back up the file), and send Claude a list of 15 Gmail addresses of people who will install and keep the app for two weeks. *Blocks:* closed testing.

**F-7 — Registry rows.** Say the word and the nine T-087 subtasks from the plan (§7) are captured as a delta, unscored; T-087.1 (accounts/domain) and T-087.9 (vector mark) are already substantively done and would be captured Done with today's date.

**F-8 — iOS timing.** Decide when to pay Apple's yearly fee and whether you have or can borrow a Mac (otherwise Claude sets up cloud builds). Not needed before Play is live.

**F-9 — Two small product decisions Claude made and you can reverse in one word:** (a) the Send button on the working surface is brand periwinkle — the one place brand meets the paper theme; (b) on the phone the tab bar is at the bottom and Send floats above it.

## 5. Known gaps, named once

- The client now sends `credentials: 'include'` on every API request (`apiFetch` in `client/src/data/loader.ts`), so the Cloudflare Access cookie travels cross-origin. What remains is on the service side: the CORS answer must carry `Access-Control-Allow-Credentials: true` with an exact origin, never `*`.
- The MCP App view is read-only; judging happens in the app or by telling Claude. In-view judging is polish, not launch.
- Local notifications are scheduled on the device; push from the server is not built (not needed for a single user whose phone opens the app).
- No debug APK was built here (no Android SDK in the sandbox); the project syncs cleanly and the Gradle files are in place. The first real build happens on your PC at step 3 of the release doc.
- iOS: untouched beyond Capacitor being iOS-capable.

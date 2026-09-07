# Free the Brain — App and Website Production Plan

*Written 2026-09-07-0920 (Europe/Sofia). Owner row: T-087 (PTO as an MCP server + app). Base surface: the Master Widget — Render Spec. Branding leads: the two "Free the Brain" images in `AI Projects/Personal Task Organization App MCP/Initial Branding Assets`. This document is handed over, not installed — filing it in Project Knowledge and the Drive folder is your step (the Drive copy is committed beside the branding assets by this session).*

---

## 0. Decisions of record (2026-09-07)

Four decisions were taken today and everything below rests on them. They are recorded so they are not relitigated from memory; one word reopens any of them.

**Audience:** version 1 is for you — one account, your registry. Multi-user accounts, sign-up and public onboarding are a later phase (§9).

**Data home:** the canonical registry moves from Drive markdown to the app's own backend. Drive stops being the database and becomes what it has always been good at — the immutable, human-readable archive. The app keeps writing `Task Registry — YYYY-MM-DD-HHMM.md` snapshots and `Registry Delta — …` files into the existing folder in the existing format, so your history stays continuous and the Claude-side protocol survives as a fallback. This is the one deliberate exception to the "never create a second database" rule in the project instructions: it is not a second database, it is the successor to the first, and the migration in §5 is designed so there is never a moment with two canonical surfaces.

**AI integration:** the app is an **MCP server** first. Claude, ChatGPT and any MCP-capable client connect to your registry through tools, and the widget renders inside the chat as an MCP App. A bring-your-own-key chat inside the app is a later phase.

**Builder:** you, piloting AI coding tools (Claude Code or an AI IDE), with this document as the specification. Calendar time is slower than hiring; the piloting skill is the asset, per the capability-stack strategy.

---

## 1. App versus website — the answer

**They are synergistic to the point of being the same build.** The Master widget is already a single HTML/CSS/JS file. Evolved properly, that file *is* the web app, and the Android and iOS apps are the same web app inside a thin native shell (Capacitor). One codebase, three shipping targets. The only genuinely separate artefact is the marketing website — a few static pages — which shares the brand system and nothing else.

**Difficulty, easiest to hardest:**

| Target | What it takes | Main risk |
|---|---|---|
| **Web app (PWA)** | Deploy the evolved widget to a URL with a manifest and service worker. No store, no review, no fee beyond a domain. | None structural. This is the base everything else stands on. |
| **Android (Google Play)** | Wrap the web app with Capacitor, add a handful of native features, pass Play's closed-testing gate: personal accounts created after 2023-11-13 need **12 testers opted in continuously for 14 days** before production access. $25 one-time account fee. | The testing gate — testers who drop out reset the clock. Start it early (§6, Phase 2). |
| **Marketing website** | Static pages: landing, privacy policy (Play requires one for an app with an account), support contact, "connect your AI" guide. | None. Do it while Android is in closed testing. |
| **iOS (App Store)** | Same Capacitor wrap, but: $99/year Apple Developer Program, an Xcode build (a Mac, or a cloud build service), and App Review, where **guideline 4.2 "minimum functionality" rejects apps that read as a repackaged website**. Passing needs real native behaviour — push notifications, share-sheet capture, offline, deep links. | Review rejection. Mitigated by building the native features for Android first, so iOS submits with them already proven. |

**So the order is: web app → Android → marketing site (in parallel) → iOS.** This satisfies both of your constraints at once — Google Play has precedence over the App Store, and the easier path has precedence overall, because the web app is not a competitor to the Android app but its content.

**Wrapper choice: Capacitor, not a Trusted Web Activity.** A TWA is smaller and Google supports it officially, but it is Android-only, demands a flawless PWA (Lighthouse ≥ 80, service worker, asset links) or it is classed as a thin wrapper, and gives you no native plugins. Capacitor covers Android *and* iOS with one shell, carries lower Play rejection risk, and its native plugins (push, share target, haptics, secure storage, local notifications) are exactly what Apple's 4.2 asks for. Keep TWA in your pocket as an Android-only fallback if Capacitor ever fights you.

---

## 2. What is being built — three parts, one system

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  CLIENT — "Free the Brain"   │  HTTPS │  REGISTRY SERVICE (backend)  │
│  web app / Android / iOS     │◄──────►│  database · API · auth       │
│  (the Master widget, grown)  │        │  Drive archive writer        │
└──────────────────────────────┘        └──────────────┬───────────────┘
                                                       │ same data
                                        ┌──────────────▼───────────────┐
                                        │  MCP SERVER (remote, OAuth)  │
                                        │  tools + MCP App view        │
                                        └──────────────┬───────────────┘
                                                       │
                          Claude · ChatGPT · Cursor · any MCP client
                                                       │
                                        ┌──────────────▼───────────────┐
                                        │  Google Drive "Task Registry"│
                                        │  archive: snapshots + deltas │
                                        └──────────────────────────────┘
```

### 2.1 The Registry Service

A small hosted backend that owns the data. Recommended stack, chosen for being boring and cheap: **Supabase** (Postgres, built-in Google sign-in, row-level security, free tier) with the API written in **TypeScript** as edge functions or a tiny **Hono** server. Alternative with the same shape: Cloudflare Workers + D1. Either runs at zero cost at your scale.

The schema is the registry schema, unchanged in meaning: `id` (T-nnn, dotted subtasks), `task`, `category`, `u`, `i`, `status`, `recorded`, `triaged`, `deadline` + `deadline_type` (DL / SO / SB) + `deadline_kind` (hard / self / agreed), `done`, `notes`. Three additions the file format never needed: `updated_at`, `source` (widget · mcp · voice · import) and `actor` (you, or the name of the AI client) on every write — this is how the automation covenant becomes enforceable in code rather than in prose. A `judgments` table records every triage decision as an event (row, fields changed, actor, timestamp), which is also the material for the value model the instructions ask you to accumulate.

The API is deliberately small: read the registry; read the derived queue (the five-tier sort, computed server-side so every client agrees); record a triage judgment; capture a task; close or reopen a task; add a note. Nothing else in v1.

**The Drive archive writer** is the piece that keeps faith with the existing system. After every write it appends a `Registry Delta` file in the existing delta format to the Task Registry folder; every five deltas or every Monday it writes a full `Task Registry` snapshot with the counts line. The Claude project can therefore keep reading Drive exactly as it does today, and if the service ever dies the archive is a complete, current, human-readable registry. The writer must be tested against the existing protocol document (`_REGISTRY PROTOCOL — Delta Writes v1.md`) before the migration flips (§5).

### 2.2 The client — the Master widget, grown up

The widget's six tabs, the row editor, the pending-judgment store, the date semantics and the queue derivation are all kept. What changes:

- **Live data replaces the injection block.** `STAMP` and `TODAY` are no longer baked in; rows load from the API and `TODAY` is the device clock. The staleness rule that made instances expire on their staging day disappears — this is the scope question you raised on 2026-08-29, answered.
- **Send results writes to the API** instead of the clipboard. The output contract survives unchanged as the *wire format* of a judgment batch, and the clipboard export stays as a visible fallback ("Copy as text") for when you are offline or want to paste into a chat.
- **Offline first.** The app caches the registry locally and queues judgments; the pending store you already have becomes the offline queue. Conflicts resolve by the standing rule — most recent human action wins — with the `updated_at` field deciding.
- **Capture becomes a first-class surface**: a capture box reachable in one tap from every screen, plus (on the phone) the system share sheet, so any text from any app can become an Inbox row.
- **Phone-first navigation.** The pill tab bar moves to the bottom on narrow screens; everything else in the layout is kept.

The code is refactored from one 79 KB file into modules (data, derivation, render, editor, sync) with **Vite** as the build tool and plain TypeScript — no framework in v1. The widget was written framework-free and works; adding React now would be a rewrite for no user-visible gain. Revisit if the multi-user phase (§9) makes state management painful.

### 2.3 The MCP server

A remote MCP server (Streamable HTTP, OAuth) in front of the same service. As of August 2026 eleven hosts render MCP Apps, including Claude (web and desktop) and ChatGPT; Claude custom connectors are a paid-plan feature (Pro, Max, Team). One thing is unverified and should be tested early in Phase 3: whether the in-chat MCP App view renders on the *phone* apps — the React Task Board's live sync died on exactly that surface in July. If it does not, nothing is lost: the tools still work from any host, and the phone already has the app itself. Tools, named so the covenant is legible in the tool list itself:

- `registry_read`, `registry_queue`, `registry_radar` — read-only.
- `triage_stage` — returns the next chunk *and* the MCP App view (the widget rendered inside the chat, five branches at a time).
- `triage_record` — records judgments; **requires an `actor: human` attestation and the judgment payload**; the server rejects a call that sets U, I, status, deadline or category without one.
- `capture_add` — new Inbox rows, next free ID, Triaged empty.
- `task_close`, `task_reopen`, `note_append`.
- `propose_scores` — returns a proposal object and writes nothing. "Your read" as a tool.

The MCP App view is built with the official `@modelcontextprotocol/ext-apps` package; it reuses the client's render modules, so there is one widget, not two. The Weekly Triage Stage and the Daily Pulse become MCP calls instead of Drive parsing — cheaper, live and concurrency-safe.

---

## 3. Branding — "Free the Brain"

### 3.1 What the two images say

The logo is a hand-drawn brain in dusty pink with a heavy black outline, "FREE THE BRAIN" in chunky off-white display letters across it, on a periwinkle field with concentric light rings. The second image is the same brain alone on slate grey with the caption "THIS IS YOU." Read together they are the whole product story in two frames: *this is you* — a brain carrying too much — and *free the brain* — the app carries it instead. That is exactly the role the project instructions give the system ("hold the full task landscape so he doesn't have to"). The tagline writes itself: **"This is you. Let it think about something else."**

### 3.2 Palette, sampled from the assets

| Token | Hex | Source | Use |
|---|---|---|---|
| `brand-periwinkle` | `#8e9dfa` | logo background | app icon field, splash, marketing hero, primary buttons on the site |
| `brand-ring` | `#b0c8f8` | the concentric rings | secondary surfaces, hover states, loading motif |
| `brand-brain` | `#b87088` | the brain itself | accent, the mark in monochrome contexts, empty-state illustration |
| `brand-outline` | `#1c1b18` | the black line (matches the widget's `--ink`) | text on light, icon outline |
| `brand-cream` | `#f8f0f0` | the letters | text on periwinkle, splash lettering |
| `brand-slate` | `#b0bcc8` | "This is you" background | onboarding and about pages, muted surfaces |

The working surface keeps the widget's warm paper theme and the category hue system untouched: the spec's own reasoning stands — "the hues are the signature and everything else stays quiet." The brand colours live at the edges: icon, splash, onboarding, empty states, marketing. A periwinkle *Send* button on the working surface is the one place brand and tool meet; test it and drop it if it shouts.

### 3.3 Mark, type, icon

**Mark:** the brain alone, no lettering, is the app icon and favicon (the wordmark is illegible at 48 px). Android adaptive icon: brain on periwinkle, rings as the optional background layer. iOS: the same without rings. Ask the illustrator for (or trace) a vector version — the JPEGs will not survive icon scaling cleanly.

**Type:** the logo's lettering is a rounded, heavy display face; use an open-licence face of the same family for headings on the site and splash (candidates to compare side by side: Lilita One, Luckiest Guy, Titan One). UI text stays the widget's system sans — legibility on a phone is not negotiable.

**Motion:** the rings are the one animation motif — a slow pulse on the splash, a single ring expanding out of the *Send* button when a batch lands. Nothing else moves.

### 3.4 Refining the widget by iteration

Three passes, each shipped and used for at least one real triage session before the next begins (the F-9 rule — three clean sessions — is the acceptance bar for every pass):

1. **Tokens and chrome:** brand tokens added, bottom tab bar on phones, capture box promoted, *Send* wired to the API. No layout changes to rows or the editor.
2. **Field fixes:** whatever the first three live sessions surface. History says this is where the real defects appear (rows vanishing, status unsettable).
3. **Micro-interactions:** the ring on send, haptics on judgment (Capacitor), a swipe-to-close gesture on rows — each removable in one word if it gets in the way.

---

## 4. Costs and accounts

| Item | Cost | When |
|---|---|---|
| Google Play developer account | $25 one-time | Phase 0 |
| Domain (e.g. `freethebrain.app`) | ~€15–40/year | Phase 0 |
| Supabase / Cloudflare | free tier | Phase 0 |
| GitHub, Vite, Capacitor, MCP SDK | free | Phase 0 |
| Cloud iOS builds (Codemagic or GitHub Actions macOS runners) if no Mac | free tier likely enough; ~$30–50/month if not | Phase 7 |
| Apple Developer Program | $99/year | Phase 7 |
| AI coding tools | whatever you already pay | throughout |

First-year total under €250 before iOS, under €400 with it. Verify each fee at sign-up; they change.

---

## 5. Migration — Drive to service, with no dual-canonical moment

1. **Import.** The service's importer parses the newest snapshot plus deltas using the compaction method already recorded in the registry (parse the table programmatically, apply `CHANGES` lines field by field, `note+=` appends). Checkpoint: the imported open/done/dropped counts equal the snapshot's independently verified counts line, and a spot check of ten rows' Notes matches byte for byte.
2. **Shadow period, two weeks.** Drive stays canonical. Every judgment you make in the new web app is *also* written by the archive writer as a Drive delta. Checkpoint: the Claude project reads those deltas as ordinary deltas and the Monday compaction folds them without complaint.
3. **Flip.** On a Monday, right after compaction, the service imports the fresh snapshot one last time and becomes canonical. The Claude project instructions get one edit: "read through the MCP server; Drive is the archive." Checkpoint: one triage chunk staged from Claude via MCP, judged in the MCP App view, and the resulting Drive delta written by the service — the loop closed end to end.
4. **Rollback stays open** for a month: if the service fails, the newest Drive snapshot plus deltas is a complete registry and the old protocol resumes unchanged.

Rollout scope is stated so half-migrated state is expected, not alarming: during the shadow period both surfaces show the same data and Drive wins any disagreement.

---

## 6. Step-by-step implementation

Effort is given in *sessions* — a session being one focused sitting of two to three hours piloting an AI coding tool — and in calendar weeks at roughly three sessions a week. Both are estimates from your own build history (the Master widget took two evenings plus one fix session); adjust after Phase 1, which is the calibration phase. Every phase ends with a verification checkpoint, and the rule from the render spec applies everywhere: **verify by effect, not by intent** — computed style, real data, a real device, never a passing check that only confirms a class was applied.

### Phase 0 — Foundation (week 1, 2–3 sessions)

1. Register the Google Play developer account (the 14-day tester clock cannot start without it). Buy the domain. Create the Supabase project and a GitHub repository.
2. Repo skeleton: `client/` (the widget's HTML split into modules, Vite), `service/` (schema, API, archive writer), `mcp/` (server), `site/` (marketing). One README stating the four decisions of record.
3. Move the Master widget template into `client/` unchanged and make it build and serve locally.

**Checkpoint 0:** the unchanged widget runs from `npm run dev` with sample rows; the Play console shows an account in good standing; the repo has one green CI run (build only).

### Phase 1 — Registry Service and importer (weeks 2–3, 5–6 sessions)

1. Create the schema (§2.1) and the `judgments` event table.
2. Write the importer against the newest Drive snapshot + deltas.
3. Write the six API endpoints; Google sign-in restricted to your account.
4. Write the Drive archive writer (delta and snapshot formats copied from the protocol file; stamps from the server clock in Europe/Sofia, 24-hour, never estimated).

**Checkpoint 1:** importer counts match the snapshot's verified counts; a delta written by the archive writer is read by a fresh Claude chat as a valid delta with no manual editing; the API refuses a write lacking `actor`.

### Phase 2 — Web app prototype (weeks 3–5, 6–8 sessions) — and start the Play tester clock

1. Replace the injection block with an API loader; `TODAY` from the device clock.
2. Wire *Send results* to `triage_record`; keep the clipboard export as a fallback.
3. Add offline caching (service worker) and the queued-judgment path.
4. Add the manifest, icons from the brand mark, and deploy to `app.<domain>`.
5. **Start the shadow period (§5 step 2).**
6. In parallel, do the minimum Capacitor wrap now — not the polished one — and upload it to Play **internal testing**, then **closed testing**; recruit 12 testers (friends, the Art College circle, Georgi, Damian, Ian). Their only job is to install and stay opted in for 14 days. This is borrowed accountability in its cheapest form, and it removes the single longest serial wait in the whole plan.

**Checkpoint 2:** one full triage chunk judged from your phone's browser with no clipboard step, visible in the API and in a Drive delta; the app installs from the home screen and opens offline showing the last-synced registry; 12 testers opted in, clock running.

### Phase 3 — MCP server prototype (weeks 5–7, 5–6 sessions)

1. Stand up the MCP server with the read tools only; connect it to Claude as a custom connector; ask a Claude chat for "full pass status" and compare with the widget.
2. Add `capture_add`, `triage_record` (with the human attestation), `task_close`.
3. Build the MCP App view with `ext-apps`, reusing the client render modules.
4. Connect the same server to ChatGPT and confirm the read tools and capture work there too — that is the "any model" claim made true.

**Checkpoint 3:** from a Claude chat, "triage 5" stages a live chunk inside the chat, you judge it there, and the judgments appear in the web app and in a Drive delta within a minute; a deliberate attempt to have the model change a score without your judgment is refused by the server and the refusal is visible in the chat.

**Flip Drive to archive here (§5 step 3), on the first Monday after Checkpoint 3.**

### Phase 4 — Android, properly (weeks 7–10, 6–8 sessions)

1. Capacitor plugins: push notifications (deadline radar: 1d / 3d before hard deadlines, matching the calendar reminder convention), share target (share text → Inbox), local notifications for SO/SB dates, haptics, secure token storage.
2. Adaptive icon and splash from the brand system; store listing (screenshots from a real device, the "This is you" frame as the feature graphic, the privacy policy URL from Phase 5).
3. Apply for production access once the 14 days are complete; ship to production.

**Checkpoint 4:** a hard deadline set in the app fires a push on the phone at the right hour; sharing a sentence from any other app creates an Inbox row with the next free ID; the Play listing is live and installs on a second Android device from the store.

### Phase 5 — Marketing website (weeks 8–10, 3–4 sessions, in parallel with Phase 4)

1. Static site at the root domain: landing (logo, tagline, three screenshots, "Get it on Google Play"), privacy policy, support/contact, and a **"Connect your AI"** page — the MCP server URL and the two-minute setup for Claude and ChatGPT. Astro or plain HTML; the brand tokens from §3.
2. `app.<domain>` remains the web app; the site links to it as "Use it in the browser."

**Checkpoint 5:** Lighthouse ≥ 90 on the landing page; the privacy policy URL is accepted by the Play console; following only the "Connect your AI" page and nothing else, you connect a fresh Claude or ChatGPT session to the server in under five minutes — if the page needs you to remember a step it does not say, the page is not finished.

### Phase 6 — Polish (weeks 10–13, 6–8 sessions)

1. Widget passes 2 and 3 from §3.4, gated by the three-clean-sessions rule.
2. Dark theme audited on a real phone at night; accessibility pass (tap targets ≥ 44 px, contrast, screen-reader labels on the U/I squares and status chips).
3. Error and empty states written in the app's voice — plain, brief, never moralising ("Nothing is waiting on anyone. Rare — enjoy it." is the register).
4. Onboarding for the future public phase drafted but hidden behind a flag.
5. Performance: the registry at 500 rows renders in under 200 ms on a mid-range Android phone.

**Checkpoint 6:** three consecutive triage sessions on the production Android build with no blocking defect; the mobile render spec can be retired to the Drive archive (F-9 activation, on your word).

### Phase 7 — iOS (weeks 13–17, 6–8 sessions)

1. Enrol in the Apple Developer Program. Set up cloud builds (or a borrowed Mac) for the Capacitor iOS project.
2. Carry over the native features from Phase 4 — they are the 4.2 defence. Write the review notes listing them explicitly: push, share extension, offline, deep links, home-screen quick action "Capture".
3. TestFlight with the same 12 testers who own iPhones; then submit.
4. If rejected under 4.2: respond with the feature list, add a native home-screen widget showing today's radar (the smallest additional native feature with the largest review impact), resubmit.

**Checkpoint 7:** the app is live on the App Store; a capture from the iOS share sheet lands in the registry and in a Drive delta.

---

## 7. Proposed subtasks for T-087 — not written to the registry

Offered as a Planning Script output for the T-087 chat, to be captured on your word. No scores, no deadlines — those are yours.

- T-087.1 — Phase 0: accounts, domain, repo skeleton, widget building locally
- T-087.2 — Phase 1: Registry Service, importer, Drive archive writer
- T-087.3 — Phase 2: web app prototype live at app.domain; Play closed testing started
- T-087.4 — Phase 3: MCP server + MCP App view; Drive flipped to archive
- T-087.5 — Phase 4: Android production release
- T-087.6 — Phase 5: marketing website with privacy policy and "Connect your AI"
- T-087.7 — Phase 6: polish passes; three clean sessions
- T-087.8 — Phase 7: iOS release
- T-087.9 — Branding: vector brain mark, icon set, type choice (needed by T-087.3's Play upload)

**The single first physical action:** open the Google Play Console and pay the $25 — it starts the only clock in this plan that cannot be hurried.

Known blockers at planning time: a vector version of the brain (T-087.9) — the JPEGs cannot produce a clean icon; and 12 testers, who must be asked and must stay opted in.

---

## 8. Risks, named once

**The balance clause.** This is capability-stack work; the Art College is the "Now" priority and its gates are exactly the boring-but-valuable kind that stall. Three sessions a week for four months is the plan's assumption — if the Art College needs those evenings, the plan slips and that is the correct outcome, not a failure. Name the trade-off when it appears; do not let the app quietly eat the Art College. A cap you set yourself — say, app sessions only on evenings when the Art College needed nothing from you that day — is worth more than any schedule here.

**Scope creep.** The two things most likely to appear as "while we're at it": bring-your-own-key chat inside the app, and multi-user accounts. Both are §9. Version 1 ships to one user with no chat panel.

**The covenant in code.** An MCP server makes the registry writable by any model that connects. The `actor` attestation and the refusal path in `triage_record` are the enforcement; test the refusal in Checkpoint 3 and keep the test in CI. A tool that lets a model score a task on its own initiative is a defect, not a feature.

**Play's tester gate.** Testers dropping out restart the 14 days. Recruit 15, not 12; message them once at day 7.

**Apple 4.2.** Mitigated by native features and explicit review notes; the fallback (a home-screen widget) is already chosen.

**The archive writer drifting from the protocol.** If its output ever stops being readable by the old Claude-side reader, the rollback path is gone. Checkpoint 1 and a monthly spot-read guard it.

---

## 9. Later phases, deliberately deferred

Each belongs in the PTO Forelog with an activation condition once you decide to keep it there; listed here so the ideas are not lost.

- **Public multi-user release** — accounts, onboarding, a pricing decision, support load. Activation: three people outside your circle ask to use it after seeing the site.
- **Bring-your-own-key chat** inside the app — the app as MCP *client* as well as server. Activation: you find yourself triaging in a chat client only because the app has no assistant.
- **Voice capture in-app** — the Voice Triage Protocol reimplemented natively. Activation: share-sheet capture proves insufficient in the car.
- **Value model (F-3)** — the `judgments` event table is its training data; nothing to build until the evidence exists.
- **Calendar write-back** — the app writing Google Calendar entries for hard deadlines, still flag-and-propose, still on your word.

---

## Sources consulted for the platform facts

- Google Play, [Everything about the 12 testers requirement](https://support.google.com/googleplay/android-developer/community-guide/255621488/everything-about-the-12-testers-requirement?hl=en) — personal accounts created after 2023-11-13; 12 testers, 14 continuous days; reduced from 20 in December 2024.
- DevMoment, [MCP Apps in 2026: what actually shipped, host by host](https://www.devmoment.dev/journal/mcp-apps-field-log-2026) — eleven hosts incl. Claude (web, desktop) and ChatGPT; `@modelcontextprotocol/ext-apps`; Claude custom connectors on paid plans.
- The Register, [Claude supports MCP Apps](https://www.theregister.com/2026/01/26/claude_mcp_apps_arrives/) — release date 2026-01-26, matching the Forelog's F-6 note.
- SaaStoStore, [TWA vs Capacitor in 2026](https://saastostore.com/blog/twa-vs-capacitor) — thin-wrapper rejection risk for TWAs without a service worker; Capacitor's plugin advantage.
- MobiLoud, [Publishing a PWA to the App Store and Google Play in 2026](https://www.mobiloud.com/blog/publishing-pwa-app-store) — Apple's 4.2 stance and what passes; Google's TWA acceptance and Lighthouse bar.
- Project Knowledge: the Master Widget — Render Spec; PTO Forelog (F-6, F-9); registry delta 2026-08-29-2013 (T-087 scope question and the React Task Board precedent).

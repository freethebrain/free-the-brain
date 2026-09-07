# Android release — FtB's steps, with checkpoints

Everything Claude could do without your accounts is done: the Capacitor project exists under `client/android/`, the share-target intent, local notifications, haptics and status-bar colour are wired, icons and splash are generated from your own brain mark, and release signing reads from a `keystore.properties` file that does not exist yet. What follows is the part only you can do, in order. Each step ends with a check; do not move on until it passes.

## 1. Google Play developer account
Go to play.google.com/console, sign in with the Google account you want to own the app forever, pay the one-time fee ($25 at last check), complete identity verification.
**Check:** the console shows "Create app" and no outstanding verification banner. This is the only clock in the plan that cannot be hurried — do it first.

## 2. Decide the application ID (permanent)
Current placeholder: `app.freethebrain.registry` (in `client/capacitor.config.ts`, `client/android/app/build.gradle`, and the manifest namespace). It becomes permanent at the first upload. If you own or will own `freethebrain.app`, this is the right ID; if you will use a different domain, tell Claude the domain and the ID changes before step 6.
**Check:** `grep -r "app.freethebrain.registry" client/capacitor.config.ts client/android/app/build.gradle` shows the ID you want.

## 3. Install the build tools on your PC (one time)
Android Studio (includes the SDK and Java). Open `client/android` in it once so it downloads what it needs; or install command-line tools and set `ANDROID_HOME`.
**Check:** in `client/android`, `gradlew.bat assembleDebug` (Windows) finishes with BUILD SUCCESSFUL and `app/build/outputs/apk/debug/app-debug.apk` exists. Install it on your phone (enable "install unknown apps") and open it — it should show the app in fixture mode.

## 4. Create the upload keystore (one time, keep it forever)
In `client/android`:
```
keytool -genkeypair -v -keystore freethebrain-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```
Answer the prompts; choose a strong password and store it in your password manager. Copy `keystore.properties.example` to `keystore.properties` and fill in the four values. Both files are gitignored. Back up the `.jks` somewhere that is not this repo (Drive is fine). Losing it means you can never update the app again under this ID.
**Check:** `gradlew.bat bundleRelease` finishes and `app/build/outputs/bundle/release/app-release.aab` exists.

## 5. Point the app at the real service
Build the web client with `VITE_API_BASE` set to your deployed Registry Service URL (see `service/README.md`), then `npx cap sync android`, then rebuild the bundle.
**Check:** the debug APK on your phone shows the provenance line ending in `· live` and the open count matches the web app.

## 6. Play Console — create the app and fill the listing
Create app → name "Free the Brain", app, free. Store listing: short description (≤80 chars) *"Your task registry, in doses small enough to face. Any AI can work it."*; full description from `site/index.html`'s three feature blocks and the covenant paragraph; app icon `data/brand/derived/icon-512.png`; feature graphic `data/brand/derived/feature-graphic-1024x500.png`; screenshots taken on your real phone (at least two, portrait). Privacy policy URL: the deployed `site/privacy.html`. App content: Data safety — the app collects task text you type, stored on your own Cloudflare account, not shared, encrypted in transit, deletable on request; no ads; no location; target audience 18+; no account creation by others (single user).
**Check:** the dashboard's "Set up your app" checklist shows every item complete.

## 7. Internal testing → Closed testing (the 14-day gate)
Testing → Internal testing → create release → upload the `.aab` from step 4 → add your own email as a tester → install from the link. Then Closed testing → create a track → upload the same bundle → add a tester list of at least 12 (recruit 15) Gmail addresses → share the opt-in link. Message the testers once at day 7. The counter needs 12 opted-in continuously for 14 days.
**Check:** the closed-testing page shows ≥12 active testers; on day 14 the "Apply for production access" button appears.

## 8. Production
Apply for production access (answer the short questionnaire about how you tested), then Production → create release → the same or a newer bundle (increase `versionCode` in `client/android/app/build.gradle` for every upload) → roll out.
**Check:** the app installs from the Play Store on a second Android device.

## What Claude does around these steps
Deploys the service, the MCP server, the web app and the site to your Cloudflare account once you have created it and given the session a scoped API token; bumps `versionCode` and rebuilds; writes the listing text; watches the closed-testing count if you grant Chrome access to the console; fixes anything the testers report.

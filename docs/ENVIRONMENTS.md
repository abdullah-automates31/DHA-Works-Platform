# Environments: dev and prod strategy

Written 7 Nov 2026 for Shariq Bhai ("how will we manage prod and dev side by side?"). Proposal, not yet approved. Open decisions are at the end.

## 1. The short answer

Dev and prod are **two separate Supabase projects**. Each has its own URL, keys, database, storage and users. They never share a URL. Today only DEV exists, so every app points at DEV. Production is created later, shortly before launch.

| | Local | DEV | PROD |
| --- | --- | --- | --- |
| Purpose | each developer's own stack | shared testing, fake data only | real residents and workers |
| Supabase | hosted TEST project `bqjzzjhwcxvomcabpyfm` for tests and drills (fake data; Docker retired 20 Nov 2026) | hosted project `xiozwoocisesgmegewww` (free tier) | new hosted project (does not exist yet) |
| Git branch | feature work | `dev` | `main` |
| Data | seed scripts | fake data | real data, backups on |
| Login codes | static test OTPs | static test OTPs for a few test numbers | real WhatsApp codes only, no test OTPs |
| Plan | free | free | paid (Pro), see section 8 |

An optional STAGING project (a copy of PROD's setup, used as the last check) can come later. Until launch, DEV plays that role.

## 2. Database changes (one path, one rule)

- The only way to change a database is a numbered migration file in `supabase/migrations`. Nobody edits DEV or PROD by hand.
- Order: write and test locally (`npm run db:local -- test db`), push to DEV (`supabase db push`), test the apps against DEV, then push the same files to PROD after sign-off.
- Both customer and worker apps live in the stores for weeks, so migrations must stay **backward compatible**: add first (new column, new function), switch the apps, remove the old thing in a later migration.
- Security rules (RLS), grants and functions are part of the migrations, so PROD gets exactly what was tested.

## 3. Git

- `dev` is where all work lands and deploys to DEV. `main` is production only.
- Changes reach `main` by pull request from `dev` after the release checklist (section 7). Release builds are tagged (`v1.0.0`).
- Both repos follow this: the platform repo (backend, worker app, admin portal) and the customer app repo.

## 4. How each app picks its environment

The app never decides at runtime. The environment is fixed when the build is made.

- **Worker app (Expo):** EAS build profiles. `development` and `preview` use the DEV URL and key, `production` uses the PROD URL and key (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`).
- **Customer app (Kotlin Multiplatform):** Android: debug build reads DEV values, release build reads PROD values (from `local.properties` on a developer's machine, CI secrets for release). iOS: separate `Debug.xcconfig` (DEV) and `Release.xcconfig` (PROD). The existing `SUPABASE_URL` and `SUPABASE_ANON_KEY` settings stay, there is just one pair per environment.
- **Admin portal:** Vercel preview deployments use DEV, the production deployment uses PROD.
- **Side by side on one phone:** the dev build gets a different app id (for example `.dev` suffix) and name ("DHA Works Dev"), so a tester can have DEV and PROD installed together without mixing them up.

## 5. Keys and secrets

- Anon (publishable) key: public by design, different per environment, safe in the app.
- Service-role key and Edge Function secrets: server only, set separately in each Supabase project, never in an app, a browser bundle or git. Only `.env.example` files are committed.
- Twilio / WhatsApp: DEV uses the test numbers set in the dashboard (the guard `npm run safety:supabase` blocks test OTPs in committed config); PROD uses the real sender and must have no test numbers.
- Never use a PROD key in a dev build, and never copy PROD data into DEV.

## 6. Data

- DEV: fake data only (`supabase/dev/*.sql` scripts). Anyone on the team can reset it.
- PROD: real data. Backups on (daily on Pro, optional point-in-time recovery). The free tier has no real backups, so it is not used for real users.

## 7. Release checklist (DEV to PROD)

1. All migrations applied and tested on DEV; pgTAP green; app tests green.
2. `npm run safety:prod-ready` has no blockers (admin second factor, test OTPs, and so on).
3. Smoke test on DEV with the release build of each app.
4. Merge `dev` into `main` by pull request; tag.
5. `supabase db push` to PROD, deploy Edge Functions, set PROD secrets.
6. Build release apps pointing at PROD; submit to the stores; deploy the admin portal.
7. Check the PROD logs and the first real accounts; keep the rollback note (previous app version, migration to reverse).

## 8. Decisions needed

1. **Approve a PROD Supabase project on a paid plan** (Pro, about 25 USD a month). The free tier was approved for development only; it has no backups and pauses on inactivity. Session time limits also need a paid plan (authenticator-app MFA is free on every plan; the portal uses an emailed code since 15 Nov).
2. **Staging:** is DEV enough as staging until launch, or do we pay for a third project?
3. **Customer app:** can Shariq Bhai add debug (DEV) and release (PROD) configuration as in section 4, and a `.dev` app id for side-by-side installs?
4. **Release owner:** who runs `db push` to PROD and builds the store releases.

## 9. Build setup in the repository (worker app, done 7 Nov)

Files: `apps/worker/app.config.ts` (picks the identity), `apps/worker/app.base.json` (shared settings), `apps/worker/eas.json` (build profiles), `apps/worker/src/lib/appVariant.ts` (+ test).

| | development | production |
| --- | --- | --- |
| `APP_VARIANT` | `development` (also the default when unset) | `production` (only this exact word) |
| App name | DHA Works Worker (Dev) | DHA Works Worker |
| Android package / iOS bundle id | `pk.dhaworks.worker.dev` | `pk.dhaworks.worker` |
| URL scheme | `dhaworksworkerdev` | `dhaworksworker` |
| Backend | DEV Supabase project | PROD Supabase project (not created yet) |
| Distribution | internal (APK; iOS ad hoc to registered devices) | store (Android app bundle; iOS App Store / TestFlight) |

Commands (run in `apps/worker`; the user runs `eas login` once):

```
eas build --profile development --platform android     # installable APK, DEV backend
eas build --profile development --platform ios         # needs the device registered: eas device:create
eas build --profile production  --platform android     # app bundle for Google Play, PROD backend
eas build --profile production  --platform ios         # for TestFlight / App Store
```

Backend values live in **EAS environment variables**, one set per environment, so no URL or key is committed:

```
eas env:create --environment development --name EXPO_PUBLIC_SUPABASE_URL --value <DEV url> --visibility plaintext
eas env:create --environment development --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <DEV anon key> --visibility plaintext
eas env:create --environment production  --name EXPO_PUBLIC_SUPABASE_URL --value <PROD url> --visibility plaintext
eas env:create --environment production  --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <PROD anon key> --visibility plaintext
```

Only the public URL and the anon key go there; never the service-role key. Do not set `EXPO_PUBLIC_OTP_CHANNEL` for production (default is WhatsApp).

Needs from the user before the first real build: an Expo account and `eas init` (links the project), a Google Play developer account for Android store releases, and an Apple Developer account (99 USD a year) for any iOS build on a real device. Nothing here is run yet. Local development with Expo Go is unchanged.

**Customer app (Shariq Bhai's repo):** the same split is a separate change in his repository (Gradle build types or flavors with a `.dev` application id for Android; `Debug.xcconfig` and `Release.xcconfig` with a `.dev` bundle id for iOS). Not touched from here.

## 21 Nov 2026: iPhone without an Apple Developer account

The Apple Developer account is bought next month (Shariq), so until then there is no signed iOS build, no TestFlight and no iOS push. What works on an iPhone meanwhile: the **worker app in Expo Go** (Metro on the LAN, or a published EAS Update opened in Expo Go; push is skipped on iOS), and the **customer app built by Shariq from Xcode with a free Apple ID** (a 7-day certificate, installed on his own device). The demo plan around this is in [DEMO-SCRIPT.md](DEMO-SCRIPT.md); the decision is in DECISIONS.md 21 Nov.


## 24 to 26 Nov 2026: the screenshot reader (dormant) and its environment

- **Runs where:** on the developer PC in a git-ignored venv (`services/screenshot-reader/.venv`, Python 3.11, PaddleOCR 3.7.0 and paddlepaddle 3.3.1, pinned in `requirements-engine.txt`; the OCR models are cached in `C:\Users\Abdullah Ali\.paddlex`). **Docker is for a SERVER only, never on the developer PC** (owner, 20 and 24 Nov). No server or domain is chosen. The reader is OFF (Shariq, 26 Nov).
- **Server environment (typed on the server only, never in git or chat):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `READER_WEBHOOK_SECRET` (at least 16 random characters), `READER_DOMAIN`, `READER_ENGINE` (paddle or stub), `READER_MAX_CONCURRENCY`, optional `READER_OCR_SIZE` (small by default, medium is 6 times slower). Template: `services/screenshot-reader/.env.example`.
- **Per Supabase project (Vault, one time, by the owner or Shariq):** `reader_url` and `reader_secret`. Without them the trigger does nothing. DEV has neither today (checked 26 Nov), which is why the check is off.
- **The service-role key** gives full database access: it belongs only on the server, never in the repository, a chat or the phone apps. A secret scan of the repository on 26 Nov found none.
- **Real screenshots** go only in `services/screenshot-reader/fixtures/real/` (git-ignored); the repository is public. The accuracy reports (`accuracy_report.csv`, `accuracy_summary.txt`) are git-ignored too.
- **Hosted TEST project** (`bqjzzjhwcxvomcabpyfm`): migration 0080 is applied there; all 51 pgTAP files pass (26 Nov).

## 26 Nov 2026: customer app (Shariq's repository) on the Android emulator, and its gotchas

For testing a customer-app pull request on this PC without a phone. The customer app is Shariq's separate repository (`ShariqKhan96/DHAWorks-Customer`): **always a branch and a pull request, never `main`; config only from the vault, never typed or pasted.**

1. **A fresh worktree from a fresh fetch**: `git fetch origin`, then `git worktree add ../dha-tmp-<name> -b abdullah/<branch> origin/main` from the clone `C:\Users\Abdullah Ali\DHA Works - Customer` (do not trust that clone's own checkout). Existing worktrees are `C:\Users\Abdullah Ali\dha-tmp-*`; the one for PR #21 is `dha-tmp-workerdetails`.
2. **`local.properties`** (git-ignored) needs `sdk.dir`. In a Java properties file a Windows path must use forward slashes or doubled backslashes: `sdk.dir=C:/Users/Abdullah Ali/AppData/Local/Android/Sdk`. Single backslashes make Gradle fail with "The filename, directory name, or volume label syntax is incorrect".
3. **Dev config** (Supabase URL, anon key, Firebase files) comes only from `scripts/secrets/pull.sh dev`, which needs the Infisical CLI and a login once (**the owner logs in**; the script hangs without it). In PowerShell: `$env:PATH = "C:\Users\Abdullah Ali\py3shim;" + $env:PATH` then `& "C:\Program Files\Git\bin\bash.exe" scripts/secrets/pull.sh dev`, run inside the worktree. **Copying the already-pulled `env/dev` files from another worktree is refused by the permission check and breaks the rule: do not do it.** Never print the values; check only key names.
4. **Tests:** `./gradlew :feature:jobs:jvmTest` (compiles commonMain and runs the commonTest suite; about 5 minutes in a fresh worktree). **Build the dev app:** `./gradlew :androidApp:assembleDevDebug` (about 3 minutes once warm); the APK is `androidApp/build/outputs/apk/dev/debug/androidApp-dev-debug.apk`, package `com.dhaworks.customer.dev` (a separate app from the older `com.dhaworks.customer` on the same emulator).
5. **Memory:** this PC has 15.7 GB but often under 1 GB free. The Gradle daemon (4 GB heap) was killed once ("Gradle build daemon disappeared unexpectedly") while the emulator ran. Build first with the emulator closed, run `./gradlew --stop` afterwards, then start the emulator.
6. **Emulator:** AVDs `Pixel_9_Pro` and `Medium_Phone_API_36.0`. Start: `emulator.exe -avd Pixel_9_Pro -no-boot-anim`; wait for `sys.boot_completed`; `adb install -r <apk>`; launch with `adb shell monkey -p com.dhaworks.customer.dev -c android.intent.category.LAUNCHER 1`. A fresh boot may show "System UI isn't responding": tap Wait. Screenshots: `adb exec-out screencap -p > file` from Git Bash (PowerShell redirection corrupts PNGs). **The owner signs in himself** (phone and code): never type codes or passwords for him.
7. Bash heredocs with apostrophes break in this shell: write Python or text files with the editor tool, then run them. `printf` with `\U` in a Windows path prints a warning (the text is still written; check it).

## 28 Nov 2026: building the worker app on this PC (Windows), and the real phone

Why: a local `expo run:android --variant release` of the worker app fails on this PC, so do not spend time on it. The customer app (Shariq's Kotlin repository) builds locally without trouble (section above).

1. **The user folder has a space** (`C:\Users\Abdullah Ali`). The NDK compiler is called through a Windows short name (`CLANG_~1.EXE`) that loses the "++", so libc++ is not linked: the link step fails with undefined C++ symbols. A directory junction (`C:\androidsdk` pointing at the SDK) got the compile further.
2. **Path length:** react-native-reanimated's CMake object paths pass 260 characters, so ninja fails with a mkdir error. A junction does not help because Windows resolves it to the long real path. Real fixes (owner's to choose): enable Windows long paths (`LongPathsEnabled=1`, administrator registry change) or keep the repository in a short real folder such as `C:\dw` (not a junction).
3. **The NDK must be 27.1.12297006** (the project pins it). An empty folder gives `CXX1101 NDK ... did not have a source.properties file`; reinstall that exact version in Android Studio, SDK Manager, SDK Tools, "Show Package Details". Studio's default install is a different version.
4. **Memory:** close Android Studio and Spotify before any Gradle build, or the Gradle daemon disappears; run `./gradlew --stop` after.
5. **What to do instead: EAS cloud build.** From `apps/worker`: `npx eas-cli build --profile development --platform android --non-interactive` (`eas.json` profile `development` = internal APK, `APP_VARIANT=development`, package `pk.dhaworks.worker.dev`; EAS is logged in on the owner's PC). Download the finished APK, then `"$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" -s ZY32LMKVK3 install -r <apk>`, then `adb -s ZY32LMKVK3 shell dumpsys package pk.dhaworks.worker.dev` and read `lastUpdateTime`.
6. **The Motorola moto g05 (ZY32LMKVK3):** needs USB debugging on and the RSA prompt accepted; Windows may list it only as an MTP/WPD device until the prompt is accepted. If `adb devices` is empty, replug, `adb kill-server`, `adb start-server`, check the prompt. It is signed in as the test worker SYED ABDULLAH ALI (worker ba8426a9, the only account with a device token that the test notices reach).
7. **Customer PR #21 on that phone:** APK `androidApp/build/outputs/apk/dev/debug/androidApp-dev-debug.apk` of worktree `dha-tmp-workerdetails` (commit 901c7e6), installed as `com.dhaworks.customer.dev`.

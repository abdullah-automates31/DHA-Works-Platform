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

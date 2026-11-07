# Developer Setup (planned)

Nothing here is installed or created yet. This describes what M0 will set up on a Windows 11 machine with no Mac.

## Prerequisites

- Node.js (LTS) and pnpm
- Git
- An Android phone with **Expo Go** (or an Android emulator)
- Docker Desktop (only if running the local Supabase stack)
- A Supabase account (project created only with explicit approval)
- Expo account for EAS Build

## First-time setup (at M0)

```bash
pnpm install
cp .env.example .env     # fill values locally; never commit .env
pnpm dev                 # runs apps through Turborepo
```

## Environment variables (names only)

| Variable | Where | Notes |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | mobile apps | public |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | mobile apps | publishable key only |
| `NEXT_PUBLIC_SUPABASE_URL` | admin | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | admin | publishable key only |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side / Edge Functions only | **never** in an app or browser |
| `EXPO_ACCESS_TOKEN` | CI | EAS builds |
| `FIREBASE_SERVICE_ACCOUNT` | Edge Function secret (`send-push`) | **never** in an app or git |

## Conventions

- TypeScript everywhere; shared types in `packages/shared`.
- Database changes only as migration files in `supabase/migrations`.
- Separate Supabase projects for development, staging and production.
- Conventional, small commits.
- No secrets in the repository.

## Build and release

- Preview builds: EAS preview (APK for testers).
- Production: EAS production build to the Play Store.
- Admin: Vercel preview and production.

## Supabase CLI workflow (as used, 28 Oct)

- Windows: Supabase CLI 2.109.1 and Docker Desktop. Local stack: `npm run db:local -- start`, `-- db reset` (applies all migrations), `-- test db` (pgTAP), `-- db lint --local` (the wrapper adds the local-only test OTPs; see docs/WORKER-APP.md). The CLI is installed globally; the project is pinned to 2.109.1 in `scripts/supabase-targets.json` and the hosted-config guard fails on any other version. Enable the git hook once per clone: `git config core.hooksPath .githooks`.
- Hosted project (production-like, free tier): ref `xiozwoocisesgmegewww`, eu-west-1, Postgres 17, account `dhaworks.developments@gmail.com`. The user runs `supabase login`, `supabase link --project-ref xiozwoocisesgmegewww` and `supabase db push` themselves in their own PowerShell. Check with `supabase migration list --linked` and `supabase db lint --linked`.
- A leftover Relay project (another product, other account) may auto-start in Docker; never touch it. Stop with `supabase stop --project-id Relay`.
- Concurrency check: `bash supabase/tests/concurrency/accept_race.sh` then `supabase db reset`.
- The `pg-delta` "failed to cache migrations catalog" warning after `db push` is harmless.
- Full session handover: [HANDOVER.md](HANDOVER.md).

## Environments and branches (set 28 Oct)

GitHub: `https://github.com/abdullah-automates31/DHA-Works-Platform.git`

| Environment | Git branch | Supabase project | Status |
| --- | --- | --- | --- |
| **Dev** | `dev` | `xiozwoocisesgmegewww` (the currently linked project) | Active. All work goes here. |
| **Production** | `main` | not created yet | The user creates it later (new project, own ref, own keys) and links it only at release time. |

Rules:
- All work happens on `dev` (or short branches off `dev`). Nothing is pushed to `main` or to a production Supabase project until the user says so.
- Release = merge `dev` into `main`, then the user runs `supabase link --project-ref <prod ref>` and `supabase db push` against production. Link back to the dev ref afterwards.
- Migrations are the same files in both environments; never edit either database by hand.
- Keep separate keys per environment in untracked `.env` files; only `.env.example` is committed.

## Firebase files for the worker app (push notifications) — copy these by hand

The worker app needs three Firebase config files that are **git-ignored and never committed**. Every developer
must put them in place manually before building the app. Get them from the Firebase console (project `dha-works`,
Project settings → Your apps) or ask Shariq Bhai.

| File (in `apps/worker/`) | Firebase app | Used by |
| --- | --- | --- |
| `google-services.json` | Android `pk.dhaworks.worker` and `pk.dhaworks.worker.dev` (one file lists both) | both Android variants |
| `GoogleService-Info.plist` | iOS `pk.dhaworks.worker` | production iOS build |
| `GoogleService-Info.dev.plist` | iOS `pk.dhaworks.worker.dev` | development iOS build |

- Without `google-services.json` a development build still runs, but gets no push. A production build refuses to
  start (`app.config.ts` throws) so a store build can never ship without push.
- EAS builds: upload the same files as EAS file environment variables `GOOGLE_SERVICES_JSON` and
  `GOOGLE_SERVICE_INFO_PLIST` (per environment) instead of committing them.
- Push needs a development build (`npx expo run:android` or EAS `development`); Expo Go cannot receive remote pushes.
- iOS push is not active yet (needs an Apple Developer account and an APNs key); the plists are only stored.

## Push Edge Function (FCM, deployed on DEV 7 Nov)

`supabase/functions/send-push`, see its README: FCM sender for both apps, called by the notifications insert
trigger and a 10-minute retry cron (migrations `20261107100229`, `20261107100423`, `20261107103106`). Local checks:
`cd supabase/functions/send-push && deno test && deno lint`. A project needs: those migrations, the Vault entries
`push_function_url` and `push_webhook_secret`, the Edge Function secret `FIREBASE_SERVICE_ACCOUNT`, and
`supabase functions deploy send-push --no-verify-jwt`. Types: regenerate `packages/supabase/database.types.ts`
after schema changes (`supabase gen types typescript --linked`).

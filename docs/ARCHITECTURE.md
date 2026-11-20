# Architecture

Version 2.0 (draft), 27 Oct 2026. Companion to [PRD.md](PRD.md), [SECURITY.md](SECURITY.md) and [DB-API-DESIGN.md](DB-API-DESIGN.md). Shariq Bhai approved Supabase on the free tier and the order **database and mobile APIs, then mobile apps, then admin portal** (25 Oct). The rest is **not yet formally approved**. Version 2.0 replaces the claim-lock design with competing quotes.

## 1. Overview

Three clients and one backend:

- **Resident app** (Android first): post jobs, compare and accept quotes, confirm cash, rate, report.
- **Worker app** (Android first): sign up and verify, find jobs, send quotes, do the work, record cash.
- **Admin portal** (web, built last): verify workers and residents, handle reports, cancel jobs, view the audit log.
- **Backend: Supabase** (Postgres, Auth, Storage, Realtime, Edge Functions). No separate server in the MVP.

```
Resident app --+
Worker app  ---+--> Supabase Auth --> Postgres (RLS + RPCs) <-- Edge Functions <-- pg_cron (expiry)
Admin portal --+         |                   |                      |
                         +- Storage (private files)      Realtime (status)       Push (Expo)
```

## 2. Technology choices

| Part | Choice | Why |
| --- | --- | --- |
| Mobile apps | React Native + Expo + TypeScript | Agreed with Shariq. One language everywhere. Works on Windows; no Mac needed for Android. |
| Admin portal | Next.js + TypeScript on Vercel | Agreed. Same language and shared types. |
| Backend | Supabase (free tier for now, upgrade once funded) | Database, login, files and live updates in one service. |
| Builds | EAS Build (Expo) | Android build in the cloud. |
| Push | Expo push service (Firebase Cloud Messaging on Android) | Simple for Expo apps. |
| Repo | pnpm + Turborepo monorepo | Share code across the three apps. Only `supabase/` and `packages/shared` are needed first. |

## 3. Repository layout

```
DHA-WORKS/
  apps/
    customer/      Expo app (resident)
    worker/        Expo app (worker)
    admin/         Next.js admin portal
  packages/
    shared/        Types, constants (categories, phases, statuses), Zod schemas, money/date helpers
    supabase/      Client, generated DB types, query helpers
    ui-native/     Shared mobile theme and components
  supabase/
    migrations/    SQL migrations (schema, RLS, functions)
    seed.sql       Categories, phases, settings
    functions/     Edge Functions
    tests/         pgTAP tests
  docs/            All documentation
```

## 4. Data model and API

See [DATA-MODEL.md](DATA-MODEL.md) for the summary and [DB-API-DESIGN.md](DB-API-DESIGN.md) for tables, the RPC contract per screen and the RLS matrix. On Supabase an "API" is a Postgres function called with `supabase.rpc()` (every state-changing action) plus RLS-protected reads. The mobile APIs come first; admin APIs follow.

## 5. Job lifecycle as a state machine

Allowed transitions are enforced in the database (one function per transition), not in the apps.

| From | To | Trigger | Allowed by |
| --- | --- | --- | --- |
| draft | open | Resident posts | Approved resident |
| open | interested | Worker marks interest | Approved worker matching category and phase |
| open / interested | quoted | Worker submits a quote | Worker with interest |
| interested / quoted | scheduled | Resident accepts one quote | Owning resident |
| scheduled | in progress | Worker starts | Accepted worker |
| in progress | completed | Worker marks done | Accepted worker |
| completed | cash collected | Both sides record equal amounts | Worker and resident |
| completed (and later) | disputed | Not set by cash any more (price differences never dispute a job, Shariq 27 Oct). Enum value kept, unused for now | - |
| cash collected | reviewed | Resident rates | Owning resident |
| open / interested / quoted | expired | 24 hours with no accepted quote | System (pg_cron) |
| open / interested / quoted | cancelled | Resident cancels | Owning resident |
| any non-final | cancelled | Staff cancel with a reason | Admin |

`accepted` exists in the status list but is unused: accepting a quote goes straight to `scheduled` because the quote carries the visit window.

**Atomic accept.** One transaction locks the job row, checks it is still open, interested or quoted, marks the chosen quote accepted, marks every other sent quote not selected, sets the accepted worker and schedule, and moves the job to scheduled. A second attempt on the same job fails. This replaces the earlier atomic claim.

**Stage before acceptance** is recomputed after each interest, quote or withdrawal: no live interest means open; interest but no live quote means interested; any live quote means quoted.

## 6. Backend logic

- **SQL functions (RPC)** for every transition. Each checks the caller's role and the current status, updates, and writes `job_events` and `audit_log` in one transaction.
- **pg_cron:** hourly sweep to expire open jobs after 24 hours (reminder at 20 hours), flag stuck jobs, send rating reminders. Available on the free tier.
- **Edge Functions** only for what the database cannot do: send push via Expo, process images if needed. Auth OTP delivery is handled by Supabase Auth's Twilio/Twilio Verify WhatsApp provider, not a custom Edge Function.
- **Database triggers** create notification rows on status changes; an Edge Function sends the matching push.
- **Quote totals** are computed on the server from labour, materials and other.

## 7. Realtime and notifications

- Supabase Realtime for job status and quote counts, filtered by RLS so users only receive their own data.
- Push for: new matching job, quote received, quote accepted or not selected, job expiring, scheduled reminder, cash recorded, rating, verification result, report updates.
- The notifications table stores everything, so nothing is lost if push fails.

## 8. Files and media

- Private buckets: `identity` (CNIC, bill, police certificate), `job-media` (photos, voice note), `worker-media` (profile photo, voice introduction), `report-media`.
- Compress photos on the phone before upload; limit voice clips to about 30 seconds. The free tier gives about 1 GB.
- Access only through signed URLs. Policies in [SECURITY.md](SECURITY.md).

## 9. Mobile app structure

- Expo Router, grouped by flow: onboarding, tabs (Home, My jobs, Alerts, Profile), job screens.
- TanStack Query for server data, Supabase Realtime updating the cache.
- Shared theme and components in `packages/ui-native`.
- Forms with react-hook-form and Zod schemas shared from `packages/shared`.
- Clear error and offline handling; drafts keep half-written jobs.
- English first. All text goes through a translation file from day one so Urdu can be added later.

## 10. Environments and deployment

| Environment | Backend | Apps | Admin |
| --- | --- | --- | --- |
| Test | Hosted TEST Supabase project, fake data (Docker retired 20 Nov 2026) | Expo Go or dev build on the test phone | localhost |
| Shared (free tier) | One hosted Supabase project (the free tier allows two) | EAS preview build (APK for testers) | Vercel preview |
| Production | Paid Supabase project after funding | EAS production build, Play Store | Vercel production |

Database changes ship only as migration files in the repository. Nobody edits production tables by hand.

## 11. Testing

See [TESTING.md](TESTING.md).

## 12. Observability

- Sentry (free tier) for crashes in all three clients.
- Supabase logs and advisors for database and security warnings.
- Simple admin numbers later: jobs posted, quoted, accepted, expired, average time to first quote.

## 13. Cost and scale

DHA Karachi is bounded, so load is small. Free tiers of Supabase, Vercel and Expo are enough to start. Free-tier limits that matter: projects pause when idle, no point-in-time backups (we run our own), about 1 GB of storage, limited built-in auth email (use custom SMTP for resident/admin email login). Plan for: Google Play developer fee (one-time), Twilio or Twilio Verify WhatsApp OTP, and our own backup job (daily database dump plus a copy of the storage buckets, encrypted and kept outside Supabase, with a tested restore). A Supabase Pro upgrade is still planned once funded.

## 14. Open architecture decisions

| # | Decision | Suggested default |
| --- | --- | --- |
| 1 | Approve this architecture | Approve, then start M0 |
| 2 | Test device | Real Android phone with Expo Go |
| 3 | Stuck-job definition and automated call | Admin alert first; automated call later |
| 4 | WhatsApp OTP provider | Twilio or Twilio Verify with a WhatsApp sender; account, sender and cost still to configure |
| 5 | App names and store accounts | Create the Google Play developer account near M11 |
| 6 | iOS | Later; no Mac available |

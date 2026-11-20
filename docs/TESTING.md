# Testing Strategy

There is no CI yet; run the checks below locally before each change. The database comes first (build order: DB and APIs, then mobile apps, then admin), so database tests carry the early weight.

## Layers

| Layer | Tool | What it covers |
| --- | --- | --- |
| Database | **pgTAP** | RLS rules, every state transition, accept-quote race, expiry sweep, cash rules |
| Shared logic | **Vitest** | Validation (Zod), quote totals, money helpers |
| Mobile UI | **Jest + React Native Testing Library** | Key screens and forms |
| Admin web | **Playwright** | Approve a worker, resolve a report |
| End to end (mobile) | **Maestro** | Post job, interest, quote, accept, complete, cash, rate |

## What runs today (30 Oct)

- Database: `npm run db:local -- test db` (pgTAP, 838 assertions in 24 files), `npm run db:local -- db lint --local`, `bash supabase/proposals/run_proposal_test.sh`.
- Config safety: `npm run safety:test` (22 tests, including the pre-push commit check against a temporary git repo) and `npm run safety:supabase`. Verified locally on 30 Oct: all five static test OTPs sign in and a wrong code returns 403.
- Worker app: `npm run worker:typecheck`, `worker:lint`, `worker:test` (226 node:test unit tests of the pure rules and call helpers, including phone/WhatsApp OTP request/verify and error mapping), `npx expo export --platform ios|android`.
- End-to-end scripts against the local stack drive the real RPCs and storage with the app's own functions (details in [WORKER-APP.md](WORKER-APP.md)). No device or UI-automation tests yet; Android untested on a device.

## Must-have tests (highest value first)

1. **RLS matrix.** For each table: a resident, a worker, an unapproved or suspended user and an unrelated user cannot read or write what they should not. Includes: a worker cannot see competitors' quotes; a worker cannot read reviews; plot number and phone are hidden until acceptance.
2. **Accept-quote race.** Two accepts at the same moment (or two quotes accepted on one job): exactly one succeeds; the others become "not selected".
3. **State machine.** Every legal transition works; every illegal one is rejected (for example Completed before Scheduled, accepting an expired or cancelled job).
4. **Quote integrity.** Total is computed on the server from labour, materials and other; a tampered total is rejected; "other" needs a reason; a sent quote cannot be edited; one live quote per worker per job.
5. **No re-quote.** A worker whose quote was rejected cannot quote the same job again; other workers can.
6. **Expiry.** An open job older than 24 hours with no accepted quote becomes expired, its quotes expire and both sides are notified; accepted jobs do not expire; a draft never expires; repost copies the job.
7. **Cash rules.** Either side can record first; amounts are write-once; equal amounts close the job and store the difference from the quote; unequal amounts still close the job as Cash collected with `matched = false` (no dispute, no report).
8. **Reports window.** Allowed from Scheduled until the setting's days after completion; blocked before and after; staff can still update existing reports.
9. **Verification gating.** Pending, needs-changes, rejected and suspended users cannot post, quote or see the feed.
10. **Storage access.** Another user's CNIC link cannot be opened; signed URLs expire.
11. **Audit log.** Cannot be updated or deleted by any role.
12. **Review rule.** One review per job, only by that job's resident, only after Cash collected.

## Manual checks before each release

- Supabase security advisor: zero warnings.
- Abuse attempts: guess job IDs, post a job in another phase, read another user's document, request a phone number before acceptance.
- Worker auth: request a code for each local test number and confirm no WhatsApp/SMS is sent; verify the fixed OTP; a wrong code fails; approved can see the feed; pending, suspended, rejected and no-profile accounts cannot; a no-profile phone account can register a profile with `email = null`.
- Realistic device: a low-end Android phone on a slow connection; image and voice compression under the free-tier storage limit.
- Staging full run through the key flow with test accounts.

## Pilot

Small pilot with real DHA residents and workers once staging is clean: seed data, no blocking bugs. The free Supabase tier has no real backups, so use test data only until the upgrade.

## Update 20 Nov 2026: tests without Docker

Docker Desktop and the local Supabase stack are retired (owner decision, 20 Nov 2026). Database tests and attack drills run on the hosted TEST project `bqjzzjhwcxvomcabpyfm` (fake data only): `node scripts/test-db-hosted.cjs [--reset] [--push] [--only name]`, drills with `--hosted`. Details: docs/ADMIN-PORTAL.md, section "Testing without Docker".

- pgTAP: 47 files, 1,940 assertions, all pass on a freshly wiped test project (about 7 s a file). A failing file prints each failing check.
- Attack drills (all pass with `--hosted`): admin reset 71 checks (parts A to D plus hosted Part C against the deployed functions), admin sign-in session 46, busy worker 71.
- Deno: `admin-password-reset` 17 tests, `admin-2fa` 15. Portal: `features/auth/reset.test.ts` plus the existing suite.
- Lessons: `supabase db reset --linked` breaks a hosted project (use `--reset`); hosted OTPs are 8 digits; test a client-side navigation path, not only a fresh page load, after changing anything that loads a third-party script (the Turnstile crash).

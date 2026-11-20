# MVP readiness checklist (19 Nov 2026)

One list per product, plus the shared backend. `[x]` = done and checked, `[ ]` = still to do, `[?]` = believed done but not proven by us.
Owner tags: **Owner** = Abdullah, **Claude** = work I can do (some need approval first), **Shariq** = customer app repository.
Sources: docs/OPEN-QUESTIONS.md (go-live sections), docs/ADMIN-PORTAL.md, docs/WORKER-APP.md, `npm run safety:prod-ready`, open customer pull requests on 19 Nov.

Done means the MVP can go to real residents and workers, not only to the pilot team. Items marked (pilot) can wait until after a small DHA-only pilot.

## 0. Shared backend (Supabase), blocks all three
- [ ] **Production Supabase project** (own secrets, same region as the admin portal's Vercel functions, Dublin) with the migrations applied. Owner creates it, Claude prepares the push list. No production project exists today; everything runs on free-tier DEV with fake data.
- [ ] **Paid plan with backups** and a restore test. Owner.
- [ ] **Twilio Verify** switched on (limits wrong phone codes to 5 per code). `safety:prod-ready` lists it as a blocker. Owner.
- [?] WhatsApp sign-in code reaches a real phone from the production project. Owner.
- [ ] Session limits on the Supabase plan (`safety:prod-ready` blocker NO_SESSION_LIMIT; the admin portal's "stay signed in" choice is separate and is the owner's decision).
- [ ] Decide the Supabase CAPTCHA setting. It is off on purpose (it would block the mobile apps; the admin portal checks Turnstile on its own server). Owner decision, then record it so `safety:prod-ready` stops flagging it.
- [ ] Rotate the exposed old Brevo mail key and the Expo token. Owner.
- [ ] Decide whether the GitHub repository stays public (history was scanned for secrets earlier; two phone numbers remain in old commits). Owner.
- [ ] Edge Functions deployed to production: `admin-2fa` (secrets `ADMIN_MAIL_API_KEY`, `ADMIN_MAIL_FROM`) and `send-push` (current version). Claude, on approval.
- [ ] Scheduled jobs (`dw-*`) running on production and checked in System status. Claude.
- [ ] Error alerts and uptime monitoring for the backend. Not seen in the docs. Claude proposes, Owner picks a service.
- [ ] (pilot) iOS push: Apple Developer account, APNs key in Firebase, `GoogleService-Info.plist` for both apps, iOS client sends an FCM token. Owner and Shariq.

## 1. Admin portal (apps/admin, Vercel)
Built and deployed: sign-in (password, Turnstile, emailed code), dashboard, workers and residents verification, jobs, reports, reviews, users, helpline log, Settings v2 (rules, audit log, system status, admin accounts, sign-out others), invites.
- [x] Typecheck, lint, unit tests (104), database tests (1,741), production build, Vercel and CI green.
- [x] Server work is fast: 20 to 80 ms per page and 1 to 4 database calls per click (measured 19 Nov, local).
- [ ] **Point the portal at the production Supabase project** (Vercel settings: URL, anon key) and re-test sign-in. Owner and Claude.
- [ ] **Prove one real emailed sign-in code on the live site** and confirm `ADMIN_MAIL_FROM` is a verified Brevo sender. Owner signs in, Claude checks the logs.
- [ ] Add the Supabase redirect URL for the final portal address. Owner.
- [ ] **Custom domain** (Chrome flagged the vercel.app address as "deceptive"). Owner buys, Claude configures.
- [ ] Decide invite emails: today the link is shown once on screen and is lost if the page is closed. Owner decides, Claude builds.
- [ ] Check the desktop two-column Settings layout and all pages below about 1000 px wide. Owner or Claude.
- [ ] Check documents and voice notes from real uploads. Owner.
- [ ] Navigation speed on the live site: cold page functions cost about 1.5 to 1.8 s on Vercel Hobby (measured 19 Nov on public pages). Decide on page reuse, fewer prefetches, or Vercel Pro. Owner decides.
- [ ] (pilot) Staff roles (one admin role today; deferred by the owner).
- [ ] (pilot) Phase 2 controls: maintenance mode, force update, announcements, feature flags, Terms and Privacy links (need the apps to read them first).
- [ ] (pilot) Small audit findings: duplicate "view" audit rows on reload; no timeout on the portal's own database calls.

## 2. Worker app (apps/worker, Android first)
Built: all screens, claim-and-quote flow, busy-worker flow (0057/0058), job reminders, call buttons, Settings page (0065, 0066, by the other session).
- [x] Unit tests (267) and database tests for every rule.
- [ ] **A current build on a phone.** Local Android builds fail (half-installed NDK); cloud builds queue on the free plan; the last phone build is old. Owner and Claude.
- [ ] **Walk docs/TEST-PLAN.md on a real phone**, including: busy-worker popup, report tracking, verification reasons, Customer details and call, Settings page. Several of these have never been run on a phone. Owner.
- [ ] Run one full job end to end with the customer app: post, quote, accept, start, material bill, complete, cash recorded, review. Owner, Claude, Shariq.
- [ ] Production build variant pointed at the production backend; store listing, privacy policy and data-safety form for the Play Store. Owner and Claude.
- [ ] Push notifications arrive with the app closed (re-prove after the first real job). Owner.
- [ ] Documents and voice notes upload from a real phone to the production buckets. Owner.
- [ ] Decide the open rules: 30 minutes to answer a busy-worker request, whether starting a second job stays refused, 1-hour reminder wording. Owner.
- [ ] (pilot) Not built: app lock, screenshot blocking, certificate pinning, root detection.
- [ ] (pilot) iOS build (blocked by the Apple items in section 0).

## 3. Customer app (Shariq's Kotlin repository, pull requests only)
Open pull requests on 19 Nov: #9 dev and prod builds, #15 no sign-in flash, #17 busy worker finish time (**do not merge**, its rule was replaced), #19 keep the sign-in session out of backups, #20 shrink and obfuscate the release build. #14, #16 and #18 are no longer open; check they were merged.
- [ ] Merge or close each open pull request; close #17. Shariq.
- [ ] **Run it on a phone.** PR #18 (one visiting time, Call button, worker profile) has never been run on one. Shariq and Owner.
- [ ] Customer picks a date and one visiting time when posting a job (decision 17 Nov, migration 0059). Shariq.
- [ ] Show the busy worker's finish estimate on the quote (`busy_eta_minutes`). Needs a change in Shariq's repository.
- [ ] Handle the notice types: `report_received`, `report_in_review`, `report_resolved`, `account_suspended`, `account_reactivated`, and the `verification_decided` reason. Show My reports (`my_reports`). Shariq.
- [ ] Production build pointed at the production backend; Play Store listing, privacy policy, data-safety form. Shariq and Owner.
- [ ] Customer config comes only from `scripts/secrets/pull.sh` (Infisical); owner's access to the Infisical project was a 403 earlier: confirm it works.
- [ ] (pilot) iOS app (blocked by the Apple items in section 0).

## Suggested order
1. Production Supabase project, plan, backups, Twilio Verify (section 0).
2. One real emailed admin code, then switch the admin portal to production.
3. Current phone builds of both apps; one full job end to end.
4. Custom domain, monitoring, store listings.
5. Everything marked (pilot).

## Progress update, 20 Nov 2026

- [x] Admin Forgot password with emailed code, limits, audit and session kill (0068); first sign-in after a reset skips the code once (0069). Live on the portal; the owner saw the reset work.
- [x] Eye (show/hide) button on every password box in the portal.
- [x] Admin takeover paths through Supabase recover and magic links closed in the database.
- [x] Worker app My jobs: cards open the job screen, no buttons (needs a new phone build to see it).
- [x] Tests no longer need Docker: hosted test project, 47 pgTAP files (1,940 assertions) and three attack drills pass.
- [ ] Each admin turns on 2-Step Verification for their email (the safety guide is written, not yet shared). Owner.
- [ ] Production Supabase project, paid plan, Twilio Verify and the other items in section 0 are unchanged.

# Admin portal (apps/admin)

Staff-only web app: Next.js 16 (App Router, TypeScript strict) in the npm workspace, one Supabase backend. UI source of truth: the Claude Design canvas "DHA Works - Admin portal" (screens A01 to A15, one shared stylesheet; `apps/admin/src/app/admin.css` is that stylesheet unchanged apart from the font variable). Business rules live in the database; the portal prepares requests and shows refusals.

## Status (updated 13 Nov 2026)

| Phase | Scope | State |
|---|---|---|
| 1 | Sign-in with emailed code (A01), worker queue and review (A03, A04), resident queue and review (A05, A06); database 0037 to 0039; Edge Function `admin-2fa` | **Built and tested locally.** Migrations 0037 to 0039 are on hosted DEV (7 Nov, verified). The `admin-2fa` function is deployed on DEV (7 Nov) with its Brevo secrets; DEV has no admin account yet. |
| 2 | Reports and case detail (A07, A08), jobs and job detail with staff cancel (A10, A11), cancellation requests, helpline log (A09) | **Built and tested locally (8 Nov):** migration 0041. On hosted DEV (applied 7 Nov). |
| 3 | Dashboard (A02, migration 0040), users and person page (A12, A13), reviews (A15), settings with categories, phases, helpline, windows and staff invites (A14), invite acceptance page | **Built and tested locally (8 Nov):** migrations 0040 and 0042. On hosted DEV (applied 7 Nov). |

## Sign-in (docs/SECURITY.md section 16)

Email + password (plus the Cloudflare Turnstile bot check, verified on the server), then a **six-digit code emailed by the Edge Function `admin-2fa`** (migration 0055, owner decision 15 Nov; it replaced the authenticator app of 0052). The code is made and checked inside the database (`admin_issue_challenge`, `admin_verify_code`): six digits, valid 10 minutes, 5 tries per code, one new code a minute, 5 an hour, and a lock after 10 wrong tries in an hour. A correct code marks the session verified and fresh (`admin_verified_sessions`); `is_admin()` requires that mark, so a password alone opens nothing. A session never expires by itself (0051, owner decision 14 Nov). The same code is the **step-up**: sensitive actions need a code typed in the last 15 minutes (`private.admin_fresh()`, `/confirm`). Because the mailbox is now the second factor, anyone who can read the admin's email and knows the password gets in (weaker than an authenticator app; the choice is the owner's). The authenticator functions of 0052 (`admin_mark_session_verified`, `admin_register_totp`, `admin_reset_totp`) remain in the database with their own strict rules but the portal no longer calls them, and `/signin/enroll` was removed. **The email is sent through Brevo** (`ADMIN_MAIL_API_KEY`, and `ADMIN_MAIL_FROM` which must be a verified Brevo sender). **Known blocker (15 Nov):** the Brevo account has "Authorised IPs" switched on, so Brevo answers 401 "unrecognised IP address" to the function and no email leaves; turn IP blocking off at app.brevo.com/security/authorised_ips. Admin accounts are created only by an existing verified admin (`invite_staff`, one-time token in the link after `#`, `accept_staff_invite`). The first admin is seeded by SQL (local: `supabase/dev/seed_local_admin.sql`).

## Screen to backend map (phase 1)

| Screen | Database |
|---|---|
| A01 sign-in + code | Auth password sign-in, `admin-2fa` function, `admin_verify_code`, `admin_session_status` |
| A02 dashboard | `admin_dashboard(p_range)` (0063: current counts, eight job stages, prioritised needs-attention list, period figures and recent activity; read-only, verified admin only) |
| A03 / A05 queues | `admin_verification_counts`, `admin_verification_queue` (search, filter, paging; never returns a CNIC) |
| A04 / A06 review | `admin_verification_detail` (masked CNIC, audited), signed URLs from the `identity` and `worker-media` buckets (5 minutes), `admin_decide_verification` |
| Suspend / reactivate (A13) | `admin_set_account_status` |
| A07 reports list | `admin_reports_counts`, `admin_reports_list` (open / resolved / all, kind, search; unsafe first) |
| A08 case | `admin_report_detail` (phones for call-back, audited), `admin_report_decide` (keep open / warning / suspend / close), `admin_report_add_note`, `admin_report_log_call`; photos from `report-media` by 5-minute signed URL |
| A10 jobs | `admin_jobs_counts`, `admin_jobs_list` (status, grouped stage (0063), phase, category, posted today, search) |
| A11 job | `admin_job_detail`, `admin_cancel_job`, `admin_job_resume`, `admin_job_replace_worker`; photos and voice from `job-media` |
| Cancellation requests (/jobs/cancellations) | `admin_cancellations_list`, `admin_decide_cancellation` (approve cancels the job; decline needs a note) |
| A09 helpline log | table `helpline_calls` (staff-only, no grants), `admin_log_call`, `admin_helpline_summary`, `admin_helpline_list`, `admin_helpline_callback_done` |
| A12 / A13 users | `admin_users_counts`, `admin_users_list`, `admin_user_detail` (masked CNIC, audited), `admin_add_staff_note`, `admin_send_message` |
| A15 reviews | `admin_reviews_list`, `admin_set_review_hidden` (hidden reviews leave the worker average; a trigger recomputes it) |
| A14 settings | (0064: `admin_rules_get`, `admin_rules_save`, `admin_audit_list`, `admin_staff_activity`, `admin_signout_other_admins`, `admin_system_status`), `admin_settings_get`, `admin_save_settings`, `admin_add_category`, `admin_update_category`, `admin_set_phase_active`, `admin_staff_list`, `admin_remove_staff`, `invite_staff`, `revoke_staff_invite` |
| /accept-invite (public) | the invited person signs up with email + password, then `accept_staff_invite` (one-time token) |

## Run it locally

1. Docker + `npm run db:local -- start` (fake people, jobs, reports, reviews and calls for the new screens: also run `supabase/dev/seed_local_operations.sql`;), then `docker exec -i supabase_db_dha-works psql -U postgres -d postgres < supabase/dev/seed_local_admin.sql` (fake staff `admin@dha-local.test`, fake queue).
2. `supabase functions serve --env-file <file with ADMIN_MAIL_MODE=dev-log>`: the code appears in that log (the mode is refused for any hosted address).
3. `apps/admin/.env.local` (git-ignored): `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321` and the local anon key. `npm run admin` and open http://localhost:3000.
4. Checks: `npm run admin:typecheck`, `admin:lint`, `admin:test`, `admin:build`; database `npm run db:local -- test db`; `deno test` in `supabase/functions/admin-2fa`; attack drill `node scripts/challenge-admin-session-local.cjs` (46 checks, local stack only).

## Rules to keep

- Never use the service-role key in the portal; it acts only as the signed-in staff member.
- Every page and action starts with `requireAdmin()`; the proxy (`src/proxy.ts`) only refreshes cookies and redirects the signed-out.
- New admin database functions: `is_admin()` first, plain-English refusals (`P0001`), audit row, explicit grants, pgTAP for the wrong callers (password-only admin, resident, worker, anon).
- No `select('*')`, paged lists, short-lived signed URLs only, nothing sensitive in URLs.
- Step-up (11 Nov, migration 0048; the emailed code again since 0055): destructive functions and the other sensitive ones call `private.admin_fresh()` and raise `confirm with a new code` (P0001). In the portal every action returns `await refusal(error)`, which turns that refusal into a redirect to `/confirm?next=<same-site path>`, where a new emailed code is typed. New destructive functions must add the freshness check and be listed in `supabase/tests/admin_step_up.test.sql`.
- Idle logout: `src/proxy.ts` signs out after 30 minutes without a request (cookie `dha_active`). `IDLE_LIMIT_SECONDS` (5 to 1800) exists only for tests.
- Sign-in bot check: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (public) and `TURNSTILE_SECRET_KEY` (server only, Vercel). A production build without the secret refuses every sign-in. Cloudflare's published test keys (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`) always pass and are for local runs only.

## State on 13 Nov 2026 (release candidate `admin-v0.9.0`; see docs/RELEASES.md and docs/ADMIN-QA.md)

- **All screens A01 to A15 work on the local stack and are click-tested in a real browser** (fake data). Migrations 0037 to 0050 are on hosted DEV (0049 step-up for five more actions, 0050 quieter view audit and trigram search indexes); `admin-2fa` is deployed there. The portal is **not deployed** (no Vercel project yet). Real emailed codes, the Turnstile bot check and the deployed site are **not yet proven**. Local checks: typecheck, lint, 76 unit tests, production build (17 routes), attack drill 39/39.
- An independent audit (13 Nov) found no critical problems; its fixes are in. Findings still open are listed in docs/ADMIN-QA.md.
- **Owner items before going live:** Vercel project (root `apps/admin`), Turnstile site key and secret, a mail provider key for `admin-2fa` (rotate the exposed Brevo key first), a DEV admin email, rotate the Expo token, delete `apps/admin/.env.local-backup`.
- **Open decisions:** (1) the invite link is shown once on screen and is **not emailed**; should the portal email it? (2) done 14 Nov: approving or rejecting a worker or resident, hiding a review, resuming a job, sending a message and deciding a report case now ask for a fresh code (migration 0049). (see docs/OPEN-QUESTIONS.md).

## Behaviour added after the first build (11 to 13 Nov)

- **Idle logout cookie:** `dha_active` is cleared by `src/proxy.ts` whenever nobody is signed in (`staleActive` in `src/lib/idle.ts`), otherwise the next sign-in read an old time and was signed straight out ("signed out after 30 minutes").
- **Forms keep what was typed:** `ActionForm` (`src/components/FormKit.tsx`) keeps the text in memory after a refusal and in `sessionStorage` (this tab, 15 minutes) for the trip to `/confirm` and back; a save clears it. The report decision form does the same for its choice and reason. A form that bypasses `ActionForm` must do this itself.
- **A failed session check is not "not an admin":** `requireAdmin()` shows the "Something went wrong, try again" page on a database or network fault (`statusFailure` in `src/lib/status.ts`) and redirects to sign-in only for a rejected or expired token.
- **Error and not-found pages:** `src/app/error.tsx` (friendly text, Try again, no error details, a short reference) and `src/app/not-found.tsx`.
- **Accessibility and layout:** `<main id="main">` landmark and a skip link in the portal layout; every select has an accessible name (`FormKit` passes the field label); visible keyboard focus and a `prefers-reduced-motion` rule in `admin.css`; Sign out stays reachable below 1000 px; `.tbl.compact` for tables beside a side column; the sign-in shell stacks notices above the form (`.si-col`).
- **Speed:** `/_next/static/*` keeps Next's long cache (pages and data stay `no-store`, see `next.config.ts`); the crest image is 128 px; each page has its own title ("Workers | DHA Works Admin").

## Local testing notes

- `apps/admin/.env.local` points at **hosted DEV**. For local tests start the portal with the local URL and anon key as environment variables (the file's values are overridden), or you will click through hosted DEV data.
- Emailed codes in `ADMIN_MAIL_MODE=dev-log`: if the `supabase functions serve` log file is stale, read the newest code from `docker logs supabase_edge_runtime_dha-works`.
- Codes are limited to 1 a minute and 5 an hour per account. Local reset: `delete from public.admin_factor_challenges;`. To force the step-up prompt: `update public.admin_verified_sessions set fresh_at = now() - interval '30 minutes';`.
- Production-build check without disturbing the dev server: `NEXT_DIST_DIR=.next-prod` plus the local env variables, `npx next build`, then delete `.next-prod` and `git checkout apps/admin/tsconfig.json` (the build rewrites it).

## Report tracking and timed suspensions (14 Nov 2026, migration 0053)

- The case screen has a **Case progress** bar: Submitted, Under review, then Action taken or Closed (the same three steps the reporter sees in the app) and a line saying what the reporter is told: received, opened, resolved; only whether action was taken, never what it was or anything about the other person.
- **Suspending** (Users screen) has an optional **Days** box (1 to 365; empty = until staff reactivate). The person is told the reason and the end date, is signed out, and the account reactivates itself on the end date (the person is told). The user screen shows the end date. A suspension made from a report decision has no end date.
- The reporter and the person suspended are notified by the database (docs/DB-API-DESIGN.md, 0053); staff do not send anything by hand.

## Deployment and the standalone repository (15 Nov)

- The portal is published as its own repository, `abdullah-automates31/Dha-Works---Admin-Portal` (local `C:\Users\Abdullah Ali\DHA-Works-Admin-Portal`, only `main`), and is deployed from it on Vercel: https://dhaworks-admin-portal.vercel.app (Vercel project `dhaworks-admin-portal`, Hobby plan). Its database types live in `vendor/supabase/database.types.ts`. A change made in `apps/admin` here must be copied into that repository too (same file names under `src/`); a push to its `main` deploys.
- Vercel settings (Production): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (DEV project values), `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`. The `NEXT_PUBLIC_` values are built into the page, so change them and then redeploy. Never the service-role key. A second, failed Vercel project `dha-works-admin-portal` is a leftover and can be deleted.
- Cloudflare Turnstile widget "DHA Works Admin" (Managed) with the hostname `dhaworks-admin-portal.vercel.app`. A new hostname (for example a custom domain) must be added to the widget.
- Still to do in the Supabase dashboard: add `https://dhaworks-admin-portal.vercel.app/**` under Authentication, URL Configuration, Redirect URLs.
- Chrome showed "Dangerous / deceptive site" on the new vercel.app address (Safe Browsing often flags a fresh address with a password box). It is the owner's own site; a custom domain avoids it.

## Reopen a rejected applicant (15 Nov, migration 0054)

A rejected worker or resident can be given another chance. On the review page of a rejected application the card "Let them apply again" asks for a note (3 to 500 characters, the applicant sees it) and a fresh code, then calls `admin_reopen_rejected(p_profile, p_reason)`: the status goes back to `needs_changes` (the state both apps already handle: the person sees the note, fixes details and documents, sends the application again, and it waits as `pending`). Nothing is deleted; documents, references and earlier decisions stay. It refuses a suspended account, staff acting on themselves, and any status other than `rejected`. It writes an audit row `verification_reopened`, a `verification_decisions` row (`ask_for_changes`) and the usual `verification_decided` notice. pgTAP: `supabase/tests/admin_reopen_rejected.test.sql` (21 checks).

## Clear all (18 Nov)

The list screens Jobs, Worker and Resident verification, Users, Reports, Reviews and Helpline end with a "Clear all" bar (`ClearAllBar` in `src/components/ListBits.tsx`). It appears only when a search or filter is on, names what is on ("Filtered by: ..."), and links back to the plain list; the current tab stays (verification tab, Workers/Residents, Open/Resolved/All). It changes the view only and never deletes data. The search box and the filter dropdowns are keyed on the current value so they show empty after clearing. The Helpline "Log a call" form has a "Clear form" button that empties a half-filled call without saving it. Not on the dashboard, cancellation requests, settings, detail pages or sign-in (no filters there, or a clear button would risk wiping saved settings or be mistaken for a decision).

## Vercel region (18 Nov)

`vercel.json` pins the server functions to `dub1` (Dublin), next to the Supabase DEV project (eu-west-1). Vercel defaulted to `iad1` (Washington), so every database call crossed the Atlantic and tab changes felt slow. A future production Supabase project should be in the same region as the Vercel functions (change `regions` if it is not in Europe). Check with the `X-Vercel-Id` response header: `<edge>::<function region>::...`.

## Dashboard v2 (19 Nov, migration 0063)

Owner content requirements (18 Nov). `admin_dashboard(p_range)` replaces `admin_dashboard()`; `p_range` is `today` (since midnight Karachi time, the default), `7d`, `30d` or `90d`; anything else is refused. The period pills on the dashboard change only the period figures and the activity list; waiting counts, open reports, jobs by stage and the needs-attention list are always the current state.

- **Cards:** workers and residents to review (oldest waiting), open reports (unsafe and poor-work chips), jobs posted today or in the period (with jobs in progress now).
- **Needs attention** (at most 15, total shown in the heading): priority first, then oldest. Urgent = unsafe reports; high = poor-work reports and **suspended workers who still hold a booked or running job**; normal = other open reports, stuck jobs, cancellation requests; low = applications. Each row: reference, title, job and people, status, priority, how long ago; it opens the record.
- **Jobs by stage:** eight stages (open, scheduled, in progress, completed, cash collected, disputed, cancelled, expired). Each opens the Jobs list with the same jobs: grouped stages use the new `admin_jobs_list` argument `p_stage` (`open` = open/interested/quoted, `scheduled` = accepted/scheduled, `cash_collected` = cash_collected/reviewed), the others the exact status. The Jobs page reads `?stage=`, its Scheduled and Cash collected pills now use it (their counts were already grouped), and it has an Expired pill.
- **Recent activity** (at most 20, newest first, within the period): registrations, verification decisions, jobs posted / quote accepted / completed / cancelled (resident or staff) / cancellation declined, reports filed and resolved, account suspensions and reactivations. Period summary line: new workers, new residents, jobs posted, jobs completed, reports filed, reports resolved. Names and record codes only, never a phone number or CNIC.
- Quick-access tiles were left out on purpose (owner choice): the sidebar already links every area with its waiting count.
- Tests: `supabase/tests/admin_dashboard.test.sql` (periods, ordering, suspended worker with a job, activity, stage filter, wrong callers); unit tests in `features/dashboard/dashboard.test.ts`. Deploy order: `supabase db push` first, then the portal (the new portal calls `p_range` and `p_stage`; the old portal keeps working on the new database).

## Settings v2 (19 Nov, migration 0064)

Owner request 19 Nov ("professional Settings page", with "dont make it messy"). Release 1 contains only controls that really change behavior, or live read-only views of data that exists. Layout: a left list of sections in four groups (Platform, Rules, People and security, Records and system) plus a red Danger zone, one section on screen at a time, a search box that narrows the list by words in each section (`matchSections` in `features/settings/rules.ts`); on a phone the list becomes wrapped buttons. Pages: `?tab=<section>`.

- **Editable rules** (`RulesForm`, `admin_rules_get` / `admin_rules_save`): jobs (open-job expiry 24 h, reminder 20 h, photos per job 6, three stuck-job hours 24 / 48 / 48) and workers (Top rated: 10 completed jobs, rating 4.5). These are the existing `app_settings` keys the database already reads, so a change takes effect at once (the expiry also applies to jobs that are open now). Each rule shows meaning, default, allowed range and who last changed it; a changed box is marked, one Save bar appears with "Unsaved changes", Discard and Save; "Reset to default" only fills the box. The database validates every value (range, whole number or one decimal, reminder earlier than expiry, no unknown or missing keys) and writes one `rules_saved` audit row with only the changed values (old and new); saving the same values writes nothing. The list of rules, defaults and limits is `private.rule_registry()`.
- **Kept as before:** Service categories, Areas, Helpline and windows (number, show in apps, report and review windows via `admin_save_settings`), Admin accounts (invite, cancel invite, remove). Admin accounts now also show last sign-in, active sessions, last seen and the IP of the latest session (`admin_staff_activity`, from `auth.users` and `auth.sessions`).
- **Audit log** (`admin_audit_list`, read-only): newest first, filters by admin, action and dates (Karachi days), paged 25, with plain action names and the changed values for rule and helpline saves. It includes sign-in and code events, so it also serves as login history. The audit table has no IP column: the IP is only on the session (Admin accounts).
- **System status** (`admin_system_status` plus live checks from the portal server): database reachable and its answer time, Supabase Auth health, the `admin-2fa` and `send-push` functions answering (it does not send a mail or a push), Turnstile keys present (never shown), push backlog of the last 24 hours and last send, database size, storage per bucket, and the last run of each `dw-*` scheduled job. Twilio, WhatsApp and backups cannot be read from the portal and say so.
- **Security** is a read-only description of today's sign-in (password, Turnstile, emailed code with its limits, signed in until sign-out, new passwords 12+ characters, audit). Password policy and attempt limits live in Supabase Auth, not here.
- **Danger zone:** "Sign out every other admin session" (`admin_signout_other_admins('SIGN OUT')`): ends all other admin sessions on every device, this one stays, audited with the count; the other admins sign in again with a new code.
- **Decisions kept (owner, 19 Nov):** staff roles (Super Admin, Verification Officer, ...) are not built (one admin role); anything the apps do not read yet is Phase 2 (maintenance mode, disabling registrations, app versions and force update, announcements, feature flags, store links, notification channels and templates, general platform name and logo). The 30-minute idle timeout and step-up code stay off (owner, 14 and 18 Nov); the Security page describes the current behavior.
- Tests: `supabase/tests/admin_settings_v2.test.sql` (71 checks: wrong callers, defaults, every refusal, audit contents, that the database reads the new values, audit filters and paging, sign-out, status) and `features/settings/settings.test.ts` (12). Deploy order: `supabase db push` first, then the portal.

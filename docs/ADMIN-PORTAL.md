# Admin portal (apps/admin)

Staff-only web app: Next.js 16 (App Router, TypeScript strict) in the npm workspace, one Supabase backend. UI source of truth: the Claude Design canvas "DHA Works - Admin portal" (screens A01 to A15, one shared stylesheet; `apps/admin/src/app/admin.css` is that stylesheet unchanged apart from the font variable). Business rules live in the database; the portal prepares requests and shows refusals.

## Status (updated 13 Nov 2026)

| Phase | Scope | State |
|---|---|---|
| 1 | Sign-in with emailed code (A01), worker queue and review (A03, A04), resident queue and review (A05, A06); database 0037 to 0039; Edge Function `admin-2fa` | **Built and tested locally.** Migrations 0037 to 0039 are on hosted DEV (7 Nov, verified). The `admin-2fa` function is deployed on DEV (7 Nov) with its Brevo secrets; DEV has no admin account yet. |
| 2 | Reports and case detail (A07, A08), jobs and job detail with staff cancel (A10, A11), cancellation requests, helpline log (A09) | **Built and tested locally (8 Nov):** migration 0041. On hosted DEV (applied 7 Nov). |
| 3 | Dashboard (A02, migration 0040), users and person page (A12, A13), reviews (A15), settings with categories, phases, helpline, windows and staff invites (A14), invite acceptance page | **Built and tested locally (8 Nov):** migrations 0040 and 0042. On hosted DEV (applied 7 Nov). |

## Sign-in (docs/SECURITY.md section 16)

Email + password, then a six-digit code emailed by the Edge Function `admin-2fa`. The database marks that session verified for 12 hours (`admin_verified_sessions`). `is_admin()` requires it, so a password alone opens nothing: not the screens, not the RPCs, not the identity documents. Admin accounts are created only by an existing verified admin (`invite_staff`, one-time token, `accept_staff_invite`). The first admin is seeded by SQL (local: `supabase/dev/seed_local_admin.sql`).

## Screen to backend map (phase 1)

| Screen | Database |
|---|---|
| A01 sign-in + code | Auth password sign-in, `admin-2fa` function, `admin_verify_code`, `admin_session_status` |
| A02 dashboard | `admin_dashboard` (counts, jobs by stage, needs-attention list: unsafe reports first, then oldest; read-only, verified admin only) |
| A03 / A05 queues | `admin_verification_counts`, `admin_verification_queue` (search, filter, paging; never returns a CNIC) |
| A04 / A06 review | `admin_verification_detail` (masked CNIC, audited), signed URLs from the `identity` and `worker-media` buckets (5 minutes), `admin_decide_verification` |
| Suspend / reactivate (A13) | `admin_set_account_status` |
| A07 reports list | `admin_reports_counts`, `admin_reports_list` (open / resolved / all, kind, search; unsafe first) |
| A08 case | `admin_report_detail` (phones for call-back, audited), `admin_report_decide` (keep open / warning / suspend / close), `admin_report_add_note`, `admin_report_log_call`; photos from `report-media` by 5-minute signed URL |
| A10 jobs | `admin_jobs_counts`, `admin_jobs_list` (status, phase, category, posted today, search) |
| A11 job | `admin_job_detail`, `admin_cancel_job`, `admin_job_resume`, `admin_job_replace_worker`; photos and voice from `job-media` |
| Cancellation requests (/jobs/cancellations) | `admin_cancellations_list`, `admin_decide_cancellation` (approve cancels the job; decline needs a note) |
| A09 helpline log | table `helpline_calls` (staff-only, no grants), `admin_log_call`, `admin_helpline_summary`, `admin_helpline_list`, `admin_helpline_callback_done` |
| A12 / A13 users | `admin_users_counts`, `admin_users_list`, `admin_user_detail` (masked CNIC, audited), `admin_add_staff_note`, `admin_send_message` |
| A15 reviews | `admin_reviews_list`, `admin_set_review_hidden` (hidden reviews leave the worker average; a trigger recomputes it) |
| A14 settings | `admin_settings_get`, `admin_save_settings`, `admin_add_category`, `admin_update_category`, `admin_set_phase_active`, `admin_staff_list`, `admin_remove_staff`, `invite_staff`, `revoke_staff_invite` |
| /accept-invite (public) | the invited person signs up with email + password, then `accept_staff_invite` (one-time token) |

## Run it locally

1. Docker + `npm run db:local -- start` (fake people, jobs, reports, reviews and calls for the new screens: also run `supabase/dev/seed_local_operations.sql`;), then `docker exec -i supabase_db_dha-works psql -U postgres -d postgres < supabase/dev/seed_local_admin.sql` (fake staff `admin@dha-local.test`, fake queue).
2. `supabase functions serve --env-file <file with ADMIN_MAIL_MODE=dev-log>`: the code appears in that log (the mode is refused for any hosted address).
3. `apps/admin/.env.local` (git-ignored): `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321` and the local anon key. `npm run admin` and open http://localhost:3000.
4. Checks: `npm run admin:typecheck`, `admin:lint`, `admin:test`, `admin:build`; database `npm run db:local -- test db`; `deno test` in `supabase/functions/admin-2fa`; attack drill `FN_LOG=<function log> node scripts/challenge-admin-local.mjs` (about 70 seconds).

## Rules to keep

- Never use the service-role key in the portal; it acts only as the signed-in staff member.
- Every page and action starts with `requireAdmin()`; the proxy (`src/proxy.ts`) only refreshes cookies and redirects the signed-out.
- New admin database functions: `is_admin()` first, plain-English refusals (`P0001`), audit row, explicit grants, pgTAP for the wrong callers (password-only admin, resident, worker, anon).
- No `select('*')`, paged lists, short-lived signed URLs only, nothing sensitive in URLs.
- Step-up (11 Nov, migration 0048): destructive functions also call `private.admin_fresh()` and raise `confirm with a new code` (P0001). In the portal every action returns `await refusal(error)`, which turns that refusal into a redirect to `/confirm?next=<same-site path>`. New destructive functions must add the freshness check and be listed in `supabase/tests/admin_step_up.test.sql`.
- Idle logout: `src/proxy.ts` signs out after 30 minutes without a request (cookie `dha_active`). `IDLE_LIMIT_SECONDS` (5 to 1800) exists only for tests.
- Sign-in bot check: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (public) and `TURNSTILE_SECRET_KEY` (server only, Vercel). A production build without the secret refuses every sign-in. Cloudflare's published test keys (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`) always pass and are for local runs only.

## State on 13 Nov 2026 (release candidate `admin-v0.9.0`; see docs/RELEASES.md and docs/ADMIN-QA.md)

- **All screens A01 to A15 work on the local stack and are click-tested in a real browser** (fake data). Migrations 0037 to 0048 are on hosted DEV; `admin-2fa` is deployed there. The portal is **not deployed** (no Vercel project yet). Real emailed codes, the Turnstile bot check and the deployed site are **not yet proven**. Local checks: typecheck, lint, 76 unit tests, production build (17 routes), attack drill 39/39.
- An independent audit (13 Nov) found no critical problems; its fixes are in. Findings still open are listed in docs/ADMIN-QA.md.
- **Owner items before going live:** Vercel project (root `apps/admin`), Turnstile site key and secret, a mail provider key for `admin-2fa` (rotate the exposed Brevo key first), a DEV admin email, rotate the Expo token, delete `apps/admin/.env.local-backup`.
- **Open decisions:** (1) the invite link is shown once on screen and is **not emailed**; should the portal email it? (2) approving or rejecting a worker or resident (`admin_decide_verification`), hiding a review, resuming a job and sending a message do **not** ask for a fresh code; add step-up to them? (see docs/OPEN-QUESTIONS.md).

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

# Admin portal (apps/admin)

Staff-only web app: Next.js 16 (App Router, TypeScript strict) in the npm workspace, one Supabase backend. UI source of truth: the Claude Design canvas "DHA Works - Admin portal" (screens A01 to A15, one shared stylesheet; `apps/admin/src/app/admin.css` is that stylesheet unchanged apart from the font variable). Business rules live in the database; the portal prepares requests and shows refusals.

## Status (7 Nov 2026)

| Phase | Scope | State |
|---|---|---|
| 1 | Sign-in with emailed code (A01), worker queue and review (A03, A04), resident queue and review (A05, A06); database 0037 to 0039; Edge Function `admin-2fa` | **Built and tested locally.** Migrations 0037 to 0039 are on hosted DEV (7 Nov, verified). The `admin-2fa` function is deployed on DEV (7 Nov) with its Brevo secrets; DEV has no admin account yet. |
| 2 | Reports and case detail (A07, A08), jobs and job detail with staff cancel (A10, A11), cancellation requests, helpline log (A09) | **Built and tested locally (8 Nov):** migration 0041. Not on hosted DEV yet. |
| 3 | Dashboard (A02, migration 0040), users and person page (A12, A13), reviews (A15), settings with categories, phases, helpline, windows and staff invites (A14), invite acceptance page | **Built and tested locally (8 Nov):** migrations 0040 and 0042. Not on hosted DEV yet. |

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

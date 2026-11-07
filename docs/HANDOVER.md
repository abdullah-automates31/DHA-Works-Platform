# Session handover

Read this first in a new session. It is the detailed record of where the work stands as of **5 Nov 2026**, so nothing from earlier sessions is lost. The product rules are in [DECISIONS.md](DECISIONS.md); the database design is in [DB-API-DESIGN.md](DB-API-DESIGN.md).

## 1. Where we are

- **Admin portal (8 Nov): all screens A01 to A15 are built and tested locally** (migrations 0040 to 0042 are local only, NOT on hosted DEV; 1228 pgTAP assertions in 31 files; 53 portal unit tests). The note below describes phase 1.
- **Admin portal (7 Nov):** phase 1 built and tested locally (see [ADMIN-PORTAL.md](ADMIN-PORTAL.md)): sign-in with emailed code, worker/resident verification screens, migrations 0037 to 0039, Edge Function `admin-2fa`. Migrations 0037 to 0039 and the admin-2fa function are on DEV (Brevo secrets set); no admin account yet. Needs a mail provider and a first admin account on DEV before it can be used there.

- Documentation is complete and rewritten for the competing-quotes model (27 Oct), plus Shariq's 27 Oct feedback.
- **Database and mobile API:** 31 migrations (0001 to 0017, 0020 to 0033; 0018 and 0019 are unapplied proposals in `supabase/proposals/`). **0001 to 0032 are applied to hosted DEV; 0033 (authentication hardening) once pushed (6 Nov)** (0030, protect filed material bills, a 5 Nov audit fix, pushed and verified 5 Nov) (`xiozwoocisesgmegewww`; 0013 to 0015 on 29 Oct, 0016, 0017 and 0020 on 31 Oct, 0021 to 0026 on 3 Nov, 0027 to 0029 on 5 Nov; checked with `supabase migration list --linked`, local and remote match). `supabase db lint --local` is clean apart from the intended unused `p_visit_start`/`p_visit_end` warning on `submit_quote`.
- **Config safety (30 Oct):** the static test OTPs and fake Twilio values are no longer in the tracked `supabase/config.toml`. `npm run db:local -- <cmd>` builds a git-ignored `.supabase-local/` copy with them; `npm run safety:supabase` / `safety:test` guard the tracked file; `npm run supabase:config-push -- <dev|production>` is the only documented hosted config push (check-only without `--run`; not run). The git `pre-push` hook (`.githooks/`, enabled in this clone via `core.hooksPath`) checks the config in each commit being pushed and blocks `main`. Never run a raw `supabase config push` on a hosted project. No hosted command was run. Details: [SECURITY.md](SECURITY.md), [WORKER-APP.md](WORKER-APP.md).
- **Push Edge Function** `supabase/functions/send-push`: FCM sender for both apps, **deployed on DEV 7 Nov** with a notifications insert trigger, a 10-minute retry cron and `FIREBASE_SERVICE_ACCOUNT` set (migrations 20261107100229, 20261107100423, 20261107103106). The worker app registers its FCM token (Android only until there is an Apple account). Details: the function's README.
- **Types:** `packages/supabase/database.types.ts` includes the local `worker_feed.quote_count` from 0017. Regenerate after pushing 0016, 0017 and 0020; 0014 and 0015 only change privileges, so they do not change the types.
- **Worker app** (`apps/worker`): all screens W01-W08 and W10-W18 built (see [WORKER-APP.md](WORKER-APP.md)), plus the 3 Nov work from the mentor's improvement document and Shariq's answers: Introduction/about, materials toggle with itemised list, "Rejected" label, customer-controlled schedule, hidden rejected and cancelled jobs, bill at job completion. Committed and pushed to `dev` up to `1ea890b`, which includes the 5 Nov performance work from the mentor's 9-point list (skeleton loaders, image caching and compression, paged Open jobs / My Jobs / Notifications, one-trip reads, indexes; details, measurements and the audit in [PERFORMANCE.md](PERFORMANCE.md)). Also 5 Nov: profile picture no longer blinks (`ProfilePhoto` caches the signed link and fades the photo over the initials) and the quote Materials boxes are visible on the white card (`LabeledInput onCard`). Not yet tried on a real phone: skeletons, feed Show more, voice at 16 kHz mono, bill photo at 1280 px, profile picture, quote toggle, Complete Job bill photo, Rejected card, Introduction, status timeline, voice. The Customer app is Shariq's; the admin portal is not started (the user, 3 Nov: start it next week or the week after; focus on worker and customer apps first). npm workspace only, no pnpm/Turborepo.
- **Git:** `https://github.com/abdullah-automates31/DHA-Works-Platform.git`. `main` = production (untouched since the first push), `dev` = all work. The linked Supabase project is DEV; no production project exists yet (see SETUP.md). Commit messages end with the `Co-Authored-By` line of the model doing the work.

## 2. Accounts, projects and environment (do not mix these up)

| Thing | Value |
| --- | --- |
| Hosted DEV project | ref `xiozwoocisesgmegewww`, eu-west-1, Postgres 17, org `rtobksutpomecxpibbld`, account `dhaworks.developments@gmail.com`, free tier |
| Production project | does not exist yet; the user creates it later |
| Abandoned project | `dha-suite`, ref `qfxpluotmrxmxqseelnh`. The user said "forget dha suite". Never push there. |
| Other product | **Relay** (ref `crhqgcphpivsjoqzgfzd`, local stack project id `Relay`). Belongs to an older account. **Never touch it.** |
| Supabase MCP connector | Logged in to the OLD account (sees only Relay). Do not use it for this project. Use the Supabase CLI. |
| Working dir | `C:\Users\Abdullah Ali\dha-works`, Windows 11, PowerShell and Bash |
| Tools | Supabase CLI 2.109.1 (2.122.0 available), Docker Desktop 29.7.2, Deno 2.9.4. Python is not usable from the Bash tool here. |
| Who runs what | The user runs `supabase login` and `link`. `supabase db push` to DEV only when the user asks in the current task, after checking branch `dev`, the linked ref and `db push --dry-run`. Never deploy functions or set secrets unless asked. |

Local stack: project id `dha-works`, API on `http://127.0.0.1:55321` (ports 553xx). Docker Desktop may auto-restart a Relay stack; stop it with `supabase stop --project-id Relay` (data is kept).

Rules: schema changes only as new migration files (never edit an existing one); never edit a hosted database by hand; `SUPABASE_SERVICE_ROLE_KEY` never reaches an app or browser; only `.env.example` is committed; no real CNIC or resident data until a backup and restore is tested (free tier has no PITR).

## 3. Migrations (`supabase/migrations/`)

| File | Content | Hosted DEV |
| --- | --- | --- |
| 20261027000001 | enums (no `voice_intro` doc type) and `set_updated_at` | yes |
| 0002 | categories (8), service_areas (phases 1 to 8), app_settings with seed rows, `get_setting` | yes |
| 0003 | profiles, addresses, worker_details (incl. `voice_intro_path`), worker_categories, worker_areas, worker_references, verification_documents, verification_decisions | yes |
| 0004 | jobs (code `DW-####`), job_private, job_photos, job_views, job_interests, quotes (generated `total`; one `sent` per job+worker; one `accepted` per job), job_events, cash_records (write-once trigger), cancellation_requests | yes |
| 0005 | reviews, reports (`RP-####`, `system_generated`), report_photos/notes/calls, notifications, device_tokens, audit_log (append-only incl. truncate), staff_invites | yes |
| 0006 | RLS helpers (`current_user_role`, `is_admin`, `is_active_approved`, `worker_matches_job`, `worker_has_stake`, `is_job_owner`, `is_accepted_worker`, `can_view_job`), SELECT-only grants to `authenticated`, anon gets nothing, policies | yes |
| 0007 | schema `private` helpers (`me`, `setting_int`, `record`, `notify`, `notify_admins`, `recompute_job_stage`); RPCs `register_profile`, `update_my_profile`, `upsert_address`, `add_verification_document`, `set_my_references`, `submit_for_review`, `register_device_token`, `mark_notifications_read`, `file_report` | yes |
| 0008 | resident RPCs: `save_job_draft`, `delete_draft`, `post_job`, `update_job`, `cancel_job`, `accept_quote` (locks the job row; straight to `scheduled`; others become `not_selected`), `reject_quote`, `confirm_cash_resident`, `private.settle_cash`, `submit_review` | yes |
| 0009 | worker RPCs: `set_my_areas`, `set_my_categories`, `set_available_today`, `update_worker_details`, `record_job_view`, `express_interest`, `withdraw_interest`, `submit_quote` (no re-quote after reject), `withdraw_quote`, `start_job`, `complete_job`, `record_cash_worker`, `request_cancellation`, `withdraw_cancellation_request` | yes |
| 0010 | read views (security_invoker = false, filter on `auth.uid()`): `categories_with_counts`, `resident_jobs`, `resident_quotes`, `worker_feed`, `worker_jobs`, and `get_my_earnings()`. The Supabase advisor warns about security-definer views; expected. | yes |
| 0011 | `pg_cron` hourly job `dw-hourly-sweeps` (`5 * * * *`): expire open jobs at 24 h with a 20 h reminder, flag stuck jobs, rating reminders. Drafts are not purged. | yes |
| 0012 | private storage buckets `identity`, `job-media`, `worker-media`, `report-media`, path prefix `<uid>/...`, policies, `public.is_approved_worker` | yes |
| 20261028000013 | Shariq's 27 Oct feedback: `jobs.material_bill_path`; `complete_job(job, bill_path)`; cash difference closes the job as `cash_collected` (never `disputed`, no `cash_price` report); `submit_review` below 3 files a system `poor_work` report; `resident_jobs` gains `material_bill_path`; `job_media_read` lets the resident read the bill | yes (29 Oct) |
| 20261029000014 | send-push grants: column-level privileges for `service_role` only (read push columns of `notifications`, update `push_sent_at`; read `user_id, push_token` of `device_tokens` and delete; read `id, account_status` of `profiles`). Nothing for app users. Hosted grants inspected after push: exact match. | yes (29 Oct) |
| 20261029000015 | default-privileges cleanup: revokes TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on all public tables and views from `anon`, `authenticated`, `service_role`, and removes them from the `postgres` default privileges in `public`. On hosted DEV such grants went from 388 to 0 and the default became `{postgres=arwdDxtm/postgres}`; a before/after fingerprint showed SELECT/INSERT/UPDATE/DELETE (43), column grants (incl. 0014), owners, RLS, 44 policies, platform-schema ACLs, other defaults and function ACLs unchanged. | yes (29 Oct) |
| 20261029000016 | `submit_for_review` no longer requires worker areas (chosen after approval); every other check is unchanged. | yes (31 Oct) |
| 20261029000017 | `worker_feed` gains `quote_count` at the end, counting `sent` quotes only. | yes (31 Oct) |
| 20261030000020 | publishes `public.notifications` for Realtime; job tables stay unpublished. | yes (31 Oct) |
| 20261102000021 | Shariq 2 Nov: `worker_details.about` (text, max 500); `update_worker_details` gets a 4th argument `p_about` (null = unchanged, blank = clear); `resident_quotes` gains `worker_about` at the end. | yes (pushed 3 Nov) |
| 20261103000022 | `replace_worker(p_job_id, p_reason)`: a resident drops the worker of a scheduled job; the job reopens, the worker's quote becomes `rejected` (cannot re-quote), they get `quote_rejected`. From Shariq's draft 0018 (grants also revoke anon). Tests: `replace_worker_profile.test.sql`. | yes (pushed 3 Nov) |
| 20261103000024 | The material bill is uploaded with the quote (3 Nov, mentor): `quotes.material_bill_path`; `submit_quote` gets a last argument `p_material_bill_path`; the job's resident can read a quote's bill; `resident_quotes` gains `material_bill_path`. **The bill-required rules were superseded by 0026**; the columns stay, unused. | yes (pushed 3 Nov) |
| 20261103000025 | Worker-app improvement document, points 4 and 6: the customer controls the schedule (`quotes.visit_*` optional and ignored by `submit_quote`; `accept_quote` takes the time from the job's `preferred_date` and window; `worker_jobs` gains `preferred_date`, `window_from`, `window_to`); rejected and cancelled jobs are hidden from workers (`worker_may_see_job`, `worker_is_rejected_on`, `can_view_job`, `jobs_read`, `job_private_read`, `worker_jobs` masks a rejected job to one bare row, `private.notify` stops updates to a rejected worker). Tests: `schedule_and_hidden_jobs.test.sql`. | yes (pushed 3 Nov) |
| 20261103000023 | `worker_public_profile(p_worker_id)`: trades, areas, about, completion rate, verified date and the last 10 anonymised reviews of a worker who quoted one of the caller's jobs. From Shariq's draft 0019, fixed against the real schema (`about` not `bio`, `profile_id`, no `cancelled_before_start` status, anon revoked). | yes (pushed 3 Nov) |
| 20261103000026 | The material bill goes back to job completion (Shariq, 3 Nov): `submit_quote` no longer requires a bill with materials (its last argument stays, optional and unused); `complete_job` requires the actual bill whenever the accepted quote has materials above 0, for every quote, with no fallback to a quote bill. Replaces the 0024 rule. | yes (pushed 3 Nov, verified: `complete_job` has the 0026 rule, `submit_quote` has none) |
| 20261105000027 | Performance (5 Nov): `worker_feed` gains `thumb_paths` (last column); `worker_jobs` gains `cash_recorded` (last column) and a prefilter on the worker's own jobs, quotes and interests; `notifications_unread_idx`. The app reads both new columns, so this must be on the database before the app build. | yes (pushed 5 Nov) |
| 20261105000028 | Performance: indexes with a real reader (`worker_categories(category_id)`, `report_photos/notes/calls(report_id)`, `reports(against_id)`). | yes (pushed 5 Nov) |
| 20261105000029 | Performance: feed matching rules as plain SQL (were SECURITY DEFINER functions that blocked index use); same rows, proven by `worker_feed_equivalence.test.sql`. Feed 560 ms to 6 ms at 2k open jobs, 4.3 s to 17 ms at 20k (local, synthetic). | yes (pushed 5 Nov) |
| 20261105000030 | Audit fix (5 Nov): a worker cannot delete a stored file that a job or quote refers to as its material bill (storage delete rule plus helper `public.is_filed_bill`); `complete_job` checks the bill file exists; partial indexes on both bill columns. The app does not need it (it uploads the bill before completing), so it could be pushed on its own. | yes (pushed 5 Nov) |
| 20261105000031 | Claim-and-lock (6 Nov): `accept_job(job, labour, materials, materials_note, note)` creates the quote as `accepted`, schedules the job, locks it to the worker, sets `cash_records.agreed_amount` (replacing a stale row after Replace worker) and notifies the resident (`job_accepted`). The older quote RPCs stay for the customer app. | yes once pushed (6 Nov) |
| 20261106000032 | Security hardening (6 Nov audit): `public.can_upload_media(bucket)` gates uploads to job-media, worker-media, report-media and identity (registered, active user of the right role, plus a file cap of 600 / 100 / 100 / 30 per user); `worker-media` files are readable only by the owner, staff and a resident who received a quote from that worker (`public.resident_may_see_worker_media`), and `is_approved_worker` is dropped; check constraints cap free text (quote note 500, materials note 1000, other note 300, report text 1100, cancellation details 500, cash reason 500, references) and amounts (quote parts and visit fee Rs 9,999,999; cash and agreed amount Rs 30,000,000). | no (local until pushed) |
| 20261106000033 | Authentication hardening (6 Nov review of 15 bypass classes): `set_my_references` accepts only a list of at most 5 objects with the keys name / phone / address as strings within their length; the contact phone of a phone account is the verified `auth.users.phone` (client value ignored); unique index `profiles_phone_unique`; `register_profile` serialises one user's requests (advisory lock) and reports a duplicate cleanly. | no (local until pushed) |

Verified: `npm run db:local -- db reset` applies all 28 locally; `npm run db:local -- db lint --local` shows only the intended unused-argument warning. Hosted DEV is at 0030 (all 28 applied, 5 Nov). `db push` prints a harmless pg-delta "certificate file" error after it finishes. `db lint --linked` was last run on 29 Oct (at 0015).

**New tables and views get no app-role privileges by default (since 0015).** Each new migration must grant exactly what is needed.

Worker-only cash remains **unbuilt and pending Shariq**; it is not 0016.

## 4. Tests (run locally; last full run 5 Nov 2026 on all 27 local migrations)

- **pgTAP, `npm run db:local -- test db`: 838 assertions in 24 files, all pass** (6 Nov: `claim_job.test.sql` and `security_hardening.test.sql` added; `supabase/tests/concurrency/claim_race.sh` checks two workers accepting at once). Files cover default privileges, service-role grants, the job lifecycle and edges, profile registration, notifications/privacy, Realtime publication, worker app prep, feed/open jobs, job detail, my jobs, quotes, work steps, cash/cancel, documents and reports, plus `replace_worker_profile` and `schedule_and_hidden_jobs` (3 Nov).
- **Worker app:** `npm run worker:test` 226 pass (6 Nov); `npm run worker:typecheck` and `npm run worker:lint` pass; `npx expo export --platform ios` succeeded earlier in the week.
- **Local phone-auth smoke test (30 Oct):** static WhatsApp OTP request and verify succeed; approved `+923001234567` sees 2 open jobs; pending worker sees 0; no-profile worker registers a profile with `email = null`; `approve_local_phone_worker.sql` promotes the pending worker.
- **Concurrency:** `bash supabase/tests/concurrency/accept_race.sh` (then `npm run db:local -- db reset`): two sessions accept different quotes on one job, exactly one wins. PASS when last run.
- **send-push:** `deno test` in `supabase/functions/send-push`: 23 pass. `bash supabase/functions/send-push/integration/run.sh` (then `npm run db:local -- db reset`): 12 end-to-end checks against the local database and a mock Expo server, using only the grants from the migrations. PASS when last run.
- **Checks done on hosted DEV after 0015 (29 Oct, read-only):** `postgres` and `supabase_admin` keep every privilege on all 29 tables (Studio runs as these); catalog reads work (29 tables, 335 columns, 31 public policies); the `supabase_realtime` publication has 0 public tables there because 0020 is local only; as `authenticated` (rolled-back transaction) categories are readable (8), RLS still hides jobs, SELECT on notifications is allowed, TRUNCATE and MAINTAIN are refused; cron job `dw-hourly-sweeps` is active as `postgres`.
- **Outstanding live checks (not done):**
  - First `dw-hourly-sweeps` run after 0015. 0015 was applied about 10:30 UTC on 29 Oct; the last checked runs (08:05, 09:05, 10:05 UTC) were before it and succeeded. Check with: `supabase db query --linked "select start_time, status, return_message from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'dw-hourly-sweeps' order by start_time desc limit 3"`. Expected `succeeded`, since the sweeps run as `postgres`, which kept all privileges.
  - A live Realtime subscription and live Data API calls with the project's keys (not run; no public tables are in the hosted Realtime publication yet, and Realtime only needs SELECT, which is intact).
  - Supabase Studio in the browser (only checked at the privilege level).
- Not tested yet at all: a real push to a phone, Expo receipts. No `supabase/seed.sql` (reset prints a harmless warning).

## 5. Shariq Bhai's feedback (27 Oct, reported 28 Oct) and its status

| Note | Status |
| --- | --- |
| Worker app needs a mandatory material bill upload; typing the materials list is optional | **Built** in 0013; changed 3 Nov: the quote now carries an itemised materials list and estimated cost (no bill), and the actual bill is required at Complete Job when the quote has materials above 0 (0026, confirmed by Shariq). |
| Rated below 3 means poor work, added inside reports | **Built.** **Assumed:** mean of the three scores below 3. Confirm. |
| A price difference is never disputed by itself; complaints are separate or by rating below 3 | **Built.** Job closes as `cash_collected`, `cash_records.matched = false`. |
| "Cash collected by worker (status should be shown on C13)" and a standalone "Review pending" instead of "Cash paid and review" | **UI only so far.** Written into UI-UX.md section 10. |
| Possible meaning: cash becomes **worker-only** (customer does not confirm cash; no C20) | **NOT built. Pending Shariq.** If yes: a new migration makes `record_cash_worker` close the job directly and retires `confirm_cash_resident`; update tests and docs. |
| Customer status-variation screen like the worker app | UI task (design owner). Not drawn. |
| Remove W11 My jobs action buttons; remove the Direct requests screen | UI tasks (design owner). |
| "v2 need expiry" | **Not understood.** Do not guess; ask Shariq and record the answer in DECISIONS.md. |

The user's instruction: build what is clear, leave what is unsure, they will confirm with Shariq and report back.

## 6. Decisions to flag to Shariq

1. Unsafe and price reports flag the job (`under_review_reason`) but do not change its status.
2. Drafts never expire.
3. The two assumptions in section 5 and the worker-only cash question.

## 7. Security follow-ups

- **Default privileges:** Supabase's default privileges for schema `public` give `anon`, `authenticated` and `service_role` TRUNCATE, TRIGGER, REFERENCES and MAINTAIN on **all 29 public tables and the 5 views** (ACL `Dxtm`, from `pg_default_acl` of role `postgres`; confirmed on hosted DEV, not from our migrations). Locally, a signed-in role could `truncate public.jobs cascade` (15 tables, bypassing RLS); not reachable through the Data API, but real. **Fixed by migration 0015, applied to hosted DEV on 29 Oct** (388 such grants to 0). Production must get 0015 too when it is created.
- Not covered by 0015: `supabase_admin`'s default privileges in `public` (only for objects that role creates; we never do) and Supabase-managed schemas.
- `send-push` uses `verify_jwt = false`; the `x-push-secret` shared secret is the only gate. Use a long random value and rotate it if leaked.
- The service-role key can still call every RPC; keep it server-side only.

## 8. Next steps, in order

0. **5 Nov:** phone-test the performance work (skeletons on a slow network, scroll the feed to the end and tap Show more, voice intro record and play back, bill photo legibility, profile picture on cold start and tab switch, My Jobs tabs); message Shariq: the customer app should compress with the same limits (photos 1280 px at 0.6, voice 16 kHz mono 32 kbps) and upload a 320 px thumbnail for the feed. Six [FAKE] jobs (DW-2010 to DW-2015) are on DEV and expire about 24 h after posting; optionally seed one job per stage for the worker. Earlier 3 Nov item: test the new worker screens on a phone (quote with and without materials, bill photo at Complete Job, Rejected card, Introduction, status timeline, voice); run `supabase/dev/hosted_dev_fake_open_jobs.sql` in the DEV SQL Editor for 4 fake open jobs; wait for Shariq on the customer-app items (show "Rejected", drop the quote visit window, require a date and time for every job incl. ASAP), the claim-lock model and worker-only cash (Shariq confirmed 4 Nov: a worker who lost to another worker cannot quote again on a reopened job either, already how the database works). The admin portal starts next week or the week after (the user, 3 Nov), not before.
1. Follow-up, not blocking: check the first cron run after 0015 (section 4) and, when convenient, open Studio and try a Realtime subscription on DEV.
2. Push is live on DEV (7 Nov). For PROD: apply the three push migrations, deploy `send-push`, create the Vault entries `push_function_url` and `push_webhook_secret`, and set `FIREBASE_SERVICE_ACCOUNT`.
3. When Shariq answers: worker-only cash (new migration) if confirmed; adjust bill and rating assumptions; record "v2 need expiry".
4. Add `supabase/seed.sql` for dev.
5. Scaffold the monorepo (pnpm + Turborepo) and start the Customer app. Needs explicit approval first.
6. Backup routine and a tested restore before any real data.

## 9. Where things live

- Product source of truth: `docs/DECISIONS.md` (wins on conflicts), `docs/DB-API-DESIGN.md` (database and APIs).
- Push function design and security: `supabase/functions/send-push/README.md`.
- Agent instructions: `CLAUDE.md` and `AGENTS.md`.
- UI reference (outside the repo): `C:\Users\Abdullah Ali\DHA-Works-UI\` (`SPEC.md`, screenshots; ignore `.dc.html`). Screen ids: C = customer, W = worker, A = admin.
- Claude's memory index: `C:\Users\Abdullah Ali\.claude\projects\C--Users-Abdullah-Ali-dha-works\memory\MEMORY.md`.
- Old conversation transcript: `C:\Users\Abdullah Ali\.claude\projects\C--Users-Abdullah-Ali-dha-works\5489b549-2150-4e6a-b922-b482bb0cd147.jsonl`.

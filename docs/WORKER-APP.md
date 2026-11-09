# Worker app (apps/worker): build record

Status at **5 Nov 2026**: all worker screens W01 to W08 and W10 to W18 are built and tested against the local Supabase stack; hosted DEV has migrations 0001 to 0030 and 0031 (claim-and-lock) once pushed, so the app also works against DEV. W09 (Direct requests) is out of the MVP. W01 uses phone + WhatsApp OTP; local development uses fixed test OTPs and sends no message. Committed and pushed to `dev` up to `1ea890b`, which includes the 5 Nov performance work (skeleton loaders, image caching and compression, paged lists, one-trip reads; see [PERFORMANCE.md](PERFORMANCE.md)). The 3 Nov screens (quote toggle, Complete Job bill, Rejected card, Introduction, status timeline) and the 5 Nov performance changes (skeletons, Show more, voice at 16 kHz mono, bill photo at 1280 px, profile picture) have unit and database tests but are **not yet tried on a real phone**. Pending design decisions and unconfirmed assumptions are in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md); the product rules are in [DECISIONS.md](DECISIONS.md).

## Stack and layout

- Expo SDK 58, Expo Router, TypeScript, React Native 0.8x, minimal npm workspace (no pnpm yet) with `packages/supabase` (generated `database.types.ts`).
- `apps/worker/src/app`: routes. `features/<area>`: pure rules (`rules.ts`, unit tested with `node --test`) plus hooks and injectable-client calls. `components`: shared UI. `i18n/en.ts`: all text (English first). `lib`: auth, profile context, Supabase client.
- Business rules stay in the database. The app prepares requests, maps refusals to friendly messages and shows state.
- One React copy: the app pins `react` and `react-dom` 19.3.0 (what Expo SDK 58 expects) and the root `package.json` has `overrides` so nothing installs 19.3.1 next to it (31 Oct). If `npm ls react` ever shows two versions or "invalid", fix that before building. Android is untested on a device.
- Profile picture: `components/ProfilePhoto.tsx` shows the worker's `profiles.avatar_path` (private `worker-media` bucket, short-lived signed URL cached in memory, initials until it loads or when there is none) on Home and Profile; Documents refreshes the profile after a new picture is uploaded. Not yet on every screen.
- W04 and the other status screens (visit HQ, rejected, suspended) have a "Check my status" button that reloads the profile; the route gate then moves an approved worker on without signing out. Real-time push of the decision comes with the notification work.

## Screens and the backend each uses

| Screen | Route | Backend |
| --- | --- | --- |
| W01 Sign in (phone/WhatsApp OTP) | `(auth)` | Supabase Auth |
| W02 About you, W03 Documents + references, W03b Your work + voice, W04 Under review | `about`, `documents`, `references`, `work`, `status` | `register_profile`, `add_verification_document`, `set_my_references`, `set_my_categories`, `update_worker_details`, `submit_for_review`, storage `identity` / `worker-media` |
| W05 Areas | `areas` | `set_my_areas` |
| W06 Home | `(tabs)/home` | `worker_feed` (count), `worker_jobs`, `notifications` (unread dot) |
| W07 Open jobs | `(tabs)/open-jobs` | `worker_feed` |
| W08 Job detail | `job/[id]` | `worker_feed`, `record_job_view` (no more `express_interest`: the button is "Accept this job" and opens W10); shows "When the customer wants you" (`worker_jobs.preferred_date`, `window_from`, `window_to`). A rejected or cancelled job cannot be opened (the database hides it). |
| W08b Job details (from W12 "Job details >") | `job/[id]?from=status` | same screen as W08; shows the worker's status chip, bar "Back to job status" + "Create quote" while still quotable, never "I will quote this job" |
| W10 Accept job (was Create quote) | `job/[id]/quote` | `accept_job` (claim-and-lock, 0031; asks "Accept this job?" first, then the job is Scheduled and the status screen opens): labour; With/Without materials toggle; with materials an itemised list (name + price, max 10) whose sum is the automatic "Material cost" (sent as `p_materials` and `p_materials_note`); no "Other" line; no bill and no visit time (a fixed box shows the customer's chosen time; the bill is uploaded at Complete Job) |
| W11 My jobs (Active / Completed / All) | `(tabs)/my-jobs` | `worker_jobs`, `cash_records` |
| W12 Job status | `job/[id]/status` | `worker_jobs`, `job_interests`, `quotes`, `cash_records`, `cancellation_requests`, `start_job`, `complete_job` (+ bill photo to `job-media`) |
| W13 Record cash | `job/[id]/cash` | `record_cash_worker` |
| W18 Request cancellation | `job/[id]/cancel` | `request_cancellation`, `withdraw_cancellation_request` |
| W14 Report a problem / I feel unsafe | `job/[id]/report` | `file_report`, photos to `report-media` |
| W15 Notifications | `notifications` | `notifications`, `mark_notifications_read`, `clear_my_notifications` (Clear all, with a confirmation; migration 0035) |
| W16 Profile | `(tabs)/profile` | `get_my_earnings`, `set_available_today`, `set_my_categories`, sign out |
| Introduction (Profile row; Shariq 2 Nov) | `introduction` | voice introduction (same card and storage rules as W03b) plus a written "about" (max 500), saved with `update_worker_details(p_voice_intro_path, p_about)`. The about box is also on W03b. Needs migration 0021 on the database. |
| W17 Help and support | `help` | `app_settings` (helpline hidden until `helpline_enabled`) |
| Report a problem (from W17) | `report` | `worker_jobs`: "Which job is this about?" lists jobs that can be reported (started, up to 7 days after completion) and opens W14 for the chosen one |
| Live updates | hook `features/live/useLiveRefresh.ts` | Realtime on `notifications` (migration 0020) |

## Desktop browser preview (2 Nov 2026)

- Run `npm run web --workspace @dha/worker` (or `npx expo start --web` in `apps/worker`) and open the printed `http://localhost:8081`. The first build takes about a minute and the page is blank until it finishes.
- It is a preview for demos, not a designed desktop product: `components/WebFrame.tsx` shows the phone layout as a centred 430 px column when the window is wide. `lib/secureStorage.web.ts` keeps the session in `localStorage` (phones keep encrypted device storage). Uses `react-native-web`.
- Not checked in a browser yet: photo and camera picking, voice recording, signed-in screens. A real desktop layout would be a separate design task (the admin portal is the planned desktop product).

## Decisions applied (see OPEN-QUESTIONS.md for the ones to confirm)

- Privacy: before a quote is accepted a worker never sees a resident's name, phone, plot, address or lane; the customer shows as "Customer · Phase N" (design v74, 1 Nov). Call appears only on Scheduled and In progress. Notifications never contain these details (quote not selected: "The customer chose another worker for {job}."). The open-jobs views still return `lane`; it is hidden in the UI only. Helpline 1092 is hidden until DHA approves it.
- No distance filter, no "Nearest", no Requests tab (4 tabs), no "Call, then quote". A rejected worker cannot re-quote. Phone stored as +92 plus 10 digits.
- Cash is worker-only (9 Nov): recording the amount closes the job as `cash_collected` at once and the customer is asked to rate. The `cashRecorded` "waiting for the customer" state is kept only as a guard.
- Material bill photo required to complete a job whose accepted quote has materials above 0 (at Complete Job, never with the quote; 0026).
- Schedule: the customer chooses it. The worker cannot set or change it; the Scheduled screen says "Running late? Call the customer and tell them when you will arrive." An ASAP job has no time yet, so the worker is told to call the customer.
- "Not chosen" is shown as "Rejected" everywhere (card, chip, timeline, notice "Quote rejected"). A rejected job is a bare card that cannot be opened; a cancelled job is invisible and its notice reads "This job has been cancelled. Do not travel to the customer's address."
- The status timeline marks Completed green with a tick; Review stays pending until the customer reviews.
- Cancellation after acceptance is a request that staff decide (scheduled or in progress only).
- Reports: five worker reasons map to `rude_damage`, `unsafe`, `no_show`, `cash_price`, `other`; up to 3 photos; allowed from job start.
- Live updates use notifications as the trigger; job tables are not published to Realtime.

## Phone auth (30 Oct)

- W01 asks for a Pakistani mobile number and requests a six-digit code on WhatsApp. The code step verifies with Supabase `verifyOtp({ phone, token, type: 'sms' })` (Supabase calls the phone OTP type `sms` even when the delivery channel is WhatsApp).
- `auth.users.phone` stores the international number **without** the leading `+` (`923001234567`); `profiles.phone` keeps `+923001234567` for the app. The local seed follows both formats.
- Email sign-in is removed from the worker app. `profiles.email` is still nullable and the local resident seed still uses email; existing email accounts are linked by their auth user id, not by email, and need a one-time phone-link/admin migration if they are to keep signing in.
- `supabase/config.toml` (the file `supabase config push` sends) enables phone sign-up and has Twilio disabled with `env(SUPABASE_AUTH_SMS_TWILIO_*)` references only. The five static test OTPs and fake Twilio values exist only in the generated, git-ignored `.supabase-local/supabase/config.toml` that `npm run db:local` builds. Auth does not call the provider for test numbers, so no WhatsApp/SMS cost is incurred. The test numbers are fake and must never reach a hosted project; `npm run safety:supabase` fails if they appear in the tracked config.
- Production is not configured: it needs a real Twilio or Twilio Verify account with a WhatsApp sender/Messaging Service and the token stored as `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN` on the server. Do not use an ordinary SMS gateway as a substitute for WhatsApp.
- Worker approval is unchanged: phone sign-in only creates the auth session; `verification_status` and `account_status` still gate the feed, quotes and tabs.

## Migrations added for the worker app (all on hosted DEV)

| File | Content |
| --- | --- |
| 20261029000016 | `submit_for_review` no longer needs areas (areas are chosen after approval) |
| 20261029000017 | `worker_feed.quote_count` |
| 20261030000020 | adds `public.notifications` to the `supabase_realtime` publication |
| 20261102000021 | `worker_details.about` and `update_worker_details(p_about)` (Introduction) |
| 20261103000022 / 23 | `replace_worker`, `worker_public_profile` (Shariq's drafts, fixed) |
| 20261103000024 | quote material bill column (superseded by 0026, unused) |
| 20261103000025 | customer-controlled schedule; rejected and cancelled jobs hidden from workers |
| 20261103000026 | actual material bill required at `complete_job` when the quote has materials |
| 20261105000027 | performance: `worker_feed.thumb_paths`, `worker_jobs.cash_recorded`, faster `worker_jobs`, `notifications_unread_idx` |
| 20261105000028 | performance: query indexes (`worker_categories`, report children, `reports.against_id`) |
| 20261105000029 | performance: feed matching rules as plain SQL so indexes are used |
| 20261105000030 | audit fix: filed material bills cannot be deleted; `complete_job` checks the bill file exists |
| 20261105000031 | claim-and-lock: `accept_job` (price + lock in one transaction); also fixes the stale `cash_records` row left by Replace worker |
| 20261106000032 | security hardening: upload gate and file caps, `worker-media` readable only by owner, staff and a resident with a quote from that worker, text and amount limits |
| 20261106000033 | authentication hardening: strict JSON for references, contact phone = verified login phone (trigger), unique phone, race-safe `register_profile` |

Hosted DEV is at 0030 (0016, 0017 and 0020 pushed on 31 Oct; 0021 to 0026 on 3 Nov; 0027 to 0030 on 5 Nov). Two proposals are unapplied in `supabase/proposals/`: 0018 lock identity during review, 0019 owner delete and read of identity files (needs a privacy decision). Run them with `bash supabase/proposals/run_proposal_test.sh`.

## Run it locally

1. Docker Desktop running, then `npm run db:local -- start` (API `http://127.0.0.1:55321`, Mailpit `:55324`, Studio `:55323`). After changing `[auth.sms]`, run `npm run db:local -- stop` and `-- start` so Auth reloads it. Do not use a plain `supabase start`: it has no test OTPs.
2. `apps/worker/.env` (gitignored) holds `EXPO_PUBLIC_SUPABASE_URL` (the PC's LAN address, port 55321) and the local anon key. Windows Wi-Fi must be a Private network with firewall rules for ports 8081 and 55321.
3. From `apps/worker`: `npx expo start --lan`; open the QR code in Expo Go. Enter one of the local numbers below and its fixed code. No WhatsApp message is sent locally.
4. Local test data (fake, local only), applied with `docker exec -i supabase_db_dha-works psql -U postgres -d postgres [-v phone=...] < file`:
   - `supabase/dev/seed_open_jobs.sql`: fake resident and 6 open jobs; `seed_job_photos.mjs` adds photos and a voice note.
   - `supabase/dev/seed_phone_workers.sql`: approved, pending, suspended, rejected and no-profile phone accounts.
   - `supabase/dev/approve_local_phone_worker.sql -v phone=+923...`: approves a phone test worker.
   - `supabase/dev/seed_worker_journey.sql -v phone=+923001234567`: puts the approved worker into every job state plus 3 notifications (safe to re-run).
   - Email-based helpers remain for older local accounts: `approve_local_worker.sql -v email=...` and `seed_worker_journey.sql -v email=...`.

### Local test OTPs

| Phone | Code | Account |
| --- | --- | --- |
| `+923001234567` | `123456` | approved, active (use the journey seed) |
| `+923211234567` | `654321` | pending review |
| `+923331234567` | `112233` | suspended |
| `+923451234567` | `445566` | rejected |
| `+923561234567` | `778899` | no profile (starts at W02) |

These numbers are accepted by Auth without a provider call because `npm run db:local` adds them as `[auth.sms.test_otp]` to the generated local config (list in `scripts/lib/local-config.mjs`). They are not in `supabase/config.toml` and must never be enabled on hosted DEV or production.

### Real SMS on the local stack (optional, with a Twilio trial account)

To see a real code arrive on your own phone while developing:

1. In Twilio: note the Account SID and Auth Token, create a Verify service (Verify > Services, Service SID starts with `VA`), and verify your own phone number (a trial account can only text verified numbers; check SMS geo permissions allow Pakistan).
2. Fill the three values in `.env.twilio.local` at the repo root (git-ignored through `.env.*`; a fresh clone must create it with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`; `TWILIO_MESSAGING_SERVICE_SID` is the alternative to Verify). Never paste them in chat or commit them.
3. `npm run db:local -- stop`, then `npm run db:local -- start`. It prints "real SMS through Twilio". The values reach Supabase only through the process environment (`env(...)` in the generated config); nothing is written to a file.
4. In `apps/worker/.env` set `EXPO_PUBLIC_OTP_CHANNEL=sms` (default `whatsapp`) and restart Metro with `npx expo start --lan -c`. Sign in with your own real number: Twilio sends the code. The five fixed numbers above still skip sending. A new number has no profile yet: finish onboarding, then approve it with `approve_local_phone_worker.sql -v phone=+92...`.

The SMS channel is for development. WhatsApp stays the product channel; its production setup (Twilio plus a Meta-approved sender) is in HANDOVER.md. Verified 31 Oct with dummy values: Auth reaches Twilio and returns Twilio's authentication error, and fixed test numbers keep working.

## Checks (last run 3 Nov, all green; the end-to-end scripts below are from 30 Oct)

- `npm run worker:typecheck`, `worker:lint`, `worker:test` (202 unit tests).
- `supabase test db`: 676 assertions in 18 files, including `replace_worker_profile` and `schedule_and_hidden_jobs` (worker files: `worker_app_prep`, `worker_documents`, `worker_feed_open_jobs`, `worker_job_detail`, `worker_quote`, `worker_work_step`, `worker_my_jobs`, `worker_cash_cancel`, `worker_report`, `realtime_publication`). `supabase db lint --local`.
- Local phone auth smoke test (30 Oct): `signInWithOtp({ channel: 'whatsapp' })` and `verifyOtp({ type: 'sms' })` succeeded for the seeded approved number without a provider call; the approved worker saw the feed; pending returned no feed; the no-profile number registered a profile with `email = null`.
- `npx expo export --platform ios|android` bundles.
- End-to-end scripts drive the real RPCs and storage with the app's own functions. They are kept outside the repo; known non-bugs: one assertion in the Stage A script was too strict, and "staff are notified" is 0 locally because no admin profile exists.

## Open items

- UI movement ("the layout moves here and there"): not reproduced; waiting for a screen recording or a description of the screen and motion.
- Test the 3 Nov screens on a phone; for hosted DEV demos run `supabase/dev/hosted_dev_fake_open_jobs.sql` in the dashboard SQL Editor (4 "[FAKE]" open jobs; cleanup SQL inside). Phone-test the 5 Nov performance changes too (checklist in PERFORMANCE.md). Six "[FAKE]" jobs DW-2010 to DW-2015 sit in DEV Open jobs and expire about 24 h after posting; they appear in Open jobs, not My Jobs (My Jobs lists only jobs the worker showed interest in, quoted or won). The claim-and-lock job flow (final per the user, 1 Nov) is not built yet; it waits on Shariq's answers (docs/OPEN-QUESTIONS.md). Any later migration goes to DEV only on explicit request.
- Decisions: the two proposals, W09 revisit, native vs designed tab bar, public repo, account email named in HANDOVER and SETUP.
- Not built: customer app (Shariq's), admin portal (starts next week or the week after, user 3 Nov) and the staff write RPCs (approve/reject, resolve reports, cancellation decisions, suspend).

# Security

Version 2.0 (draft), 27 Oct 2026 (updated for the competing-quotes model); worker auth updated 30 Oct 2026. Companion to [PRD.md](PRD.md). Items marked **Pending** need a decision from Shariq Bhai.

## 1. Principles

- **Least privilege:** every user and every app reaches only the data its role needs.
- **The database enforces the rules:** access is controlled by Postgres Row Level Security (RLS), not only app code. A modified app must not be able to read or change other people's data.
- **Collect only what we need:** CNIC and address proof are sensitive. Keep them private, restrict who sees them, delete them on a schedule.
- **Log everything important:** verification decisions, suspensions, complaint outcomes, admin actions.

## 2. What we protect

| Data | Sensitivity | Who may see it |
| --- | --- | --- |
| CNIC number and photos (workers and residents) | High | Owner and DHA admin only |
| Utility bill, police certificate | High | Owner and DHA admin only |
| Phone, email, date of birth, gender | Medium | Owner and admin. A worker's phone is also their sign-in identifier but is never shown to residents before acceptance. **A resident's phone number and a worker's phone number are shown to the other party only after the resident accepts that worker's quote.** |
| Home address (phase, lane, plot, floor) | Medium | Owner and admin. Workers see phase and lane on the job post; **plot and floor only after acceptance** (confirmed by Shariq, 26 Oct). |
| Job text, job photos, job voice note | Medium | The resident, workers whose category and phase match (while the job is open), the accepted worker and admin |
| Quotes | Medium | The resident, the worker who wrote it, admin. Competing workers never see each other's quotes. |
| Worker voice introduction, profile picture | Low | Residents viewing the worker |
| Individual reviews | Medium | The resident who wrote it and admin. **Workers never see who rated them or the individual reviews**; they see only their own average. |

## 3. Authentication

- Supabase Auth. The worker app uses **phone number + WhatsApp OTP** (six digits); email sign-in has been removed from that app. Resident and admin apps are not built; their planned sign-in remains email/Google. See [DECISIONS.md](DECISIONS.md).
- The worker's phone number is also their sign-in identifier. It is still private profile data: other users see it only under the contact-release rule. It is never exposed in a job feed or notification.
- **Production WhatsApp is not configured.** It needs Twilio or Twilio Verify with a WhatsApp sender/Messaging Service and the token stored server-side as `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN`. An ordinary SMS gateway is not a WhatsApp substitute. Local fixed test OTPs must never be enabled on hosted DEV or production: they live only in the generated `.supabase-local/` config (git-ignored), never in `supabase/config.toml`, which is what `supabase config push` sends. `npm run safety:supabase` (also run by `npm run db:local` and `npm run supabase:config-push`; the git pre-push hook checks the config in every commit being pushed) fails on any static test OTP, literal or placeholder Twilio credential. Hosted config is pushed only with `npm run supabase:config-push -- <target>`, which also checks the linked project ref against `scripts/supabase-targets.json`, blocks the Relay and `dha-suite` refs, pins the CLI version and, for production, requires real Twilio credentials in the environment. A raw `supabase config push` bypasses these checks and, because the shared config has Twilio disabled, could switch Twilio off on a hosted project, so it is never run against hosted projects.
- Resident and worker accounts are separate. One sign-in identifier maps to one role; a person using both roles needs two accounts.
- Admin portal: email and password with mandatory two-factor authentication. Admin accounts are created by an existing admin only.
- Rate limits on login and OTP requests; lockout after repeated failures.
- Short-lived tokens with refresh. Apps store tokens in secure device storage.

> Note: the Security draft described phone number as the main identity, while the PRD said email and Google first. The worker app now uses phone + WhatsApp; resident/admin identity is still to be built.

## 4. Authorization (roles and RLS)

Roles: **customer**, **worker**, **admin**. The role is stored on the server and checked in every RLS policy; it is never trusted from the app.

| Object | Customer | Worker | Admin |
| --- | --- | --- | --- |
| Own profile | Read, update (not role or status) | Read, update (not role or status) | Read, set verification and account status |
| Jobs | Create, read, cancel own | Read open jobs in their category and phase while approved and active; read jobs they have interest in or won | Read all, cancel |
| Job private details (plot, floor, phone) | Own | Only the accepted worker | Read all |
| Quotes | Read quotes on own jobs; accept or reject | Create and withdraw own quotes; read own only | Read all |
| Reports | Create for own jobs in the allowed window; read own | Same | Read all, record outcomes |
| Reviews | Create once per cash-collected job | **No access** (aggregate rating only) | Read all, hide if abusive |
| Audit log | None | None | Read only; nobody can edit or delete |

**Accept safety.** Accepting a quote is one atomic transaction on a locked job row, allowed only for the owning resident while the job is open, interested or quoted. Interest and quotes are allowed only for Approved, non-suspended workers who match the job's category and phase.

**Privileged actions** (approve a worker or resident, suspend, resolve a report, cancel a job) run only in server-side functions that check the admin role and write to the audit log. The service-role key never ships in either mobile app or the browser.

## 5. Document and image storage

- Supabase Storage with **private buckets** (`identity`, `job-media`, `worker-media`, `report-media`). No public URLs.
- Short-lived signed URLs. Storage policies mirror the table rules: the owner uploads, the owner and admin read.
- Limits on file type (JPEG, PNG, and short audio clips for voice notes and introductions) and size; compress on the phone because the free tier has about 1 GB. Strip EXIF location metadata on upload.
- **Pending:** retention. Suggested: delete CNIC and bill images some time after account closure; keep the verification decision and audit entry.

## 6. Data protection

- HTTPS only. Supabase encrypts data at rest.
- Secrets (database URL, service key, Expo and Vercel tokens, Twilio/WhatsApp provider token) live in the host's environment settings, never in the repository. Commit `.env.example` files without real values.
- Separate Supabase projects for development and production with different keys.
- Backups: the free tier has no point-in-time recovery, so we run our own scheduled backups: a daily `pg_dump` of the database (run from CI or a small scheduled job using a read-only connection string kept as a secret), plus a copy of the Storage buckets (a database dump does not include uploaded files), stored encrypted outside Supabase with limited access, a retention rule for old backups, and a restore test before any real data is held. Backups contain CNIC and bill images, so they get the same protection as the live data (encrypted, access limited to the owner and named staff).
- Logs must not contain CNIC numbers, phone numbers or free-text report content.
- A person can ask for their data to be deleted. Admin follows a written procedure (what is removed, what is kept for the audit trail).

## 7. Abuse and trust controls

- **Contact details hidden until acceptance.** There is no chat in MVP 1. Phone and plot number are released only after a quote is accepted, which reduces side deals before the platform records a choice.
- **Fake accounts.** Workers must be approved (CNIC, police certificate or references, photo) before quoting. Residents must be approved (CNIC and a recent bill matching the address) before posting. Both are manual staff decisions.
- **Fake or retaliatory reviews.** Only the resident of a cash-collected job, one review per job, anonymous to the worker; admin hiding is logged.
- **Spam jobs and quotes.** Limit open jobs per resident, posting rate and quotes per worker per hour. Open jobs expire after 24 hours.
- **Reports.** From Scheduled until 7 days after completion (a staff setting). "I feel unsafe" alerts staff immediately and shows both phone numbers. Outcomes: no action, warning, suspend, with a reason, logged. Staff can cancel a job as a separate audited action.
- **Physical visit safety.** CNIC and police certificate (or references), ratings, the Verified badge, the helpline 1092 and the unsafe-report path are a screening and response step, not a guarantee.

## 8. Hardening

- Apps contain only the public Supabase URL and the anon (publishable) key. All protection comes from RLS.
- Validate every input on the server as well as in the app, using shared types.
- Admin portal: Content Security Policy headers, secure cookies, CSRF protection, no secrets in browser code, role checks on every page and API route.
- Release builds only through EAS Build with signed keys kept by the owner. Back the keystore up in two places.
- Run `pnpm audit` in the pipeline and review updates regularly.

## 9. Audit log

Append-only: who, what, when, which record, old and new value, reason. Covers worker and resident decisions, suspensions, report outcomes, job cancellations by staff, stuck-job actions, review hiding and admin sign-ins. Nobody, including admin, can edit or delete rows.

## 10. Security testing

- **6 Nov audit of the worker app and backend (fixed in migration 0032, tests in `supabase/tests/security_hardening.test.sql`):** upload gate and per-user file caps on every bucket, `worker-media` visible only to the owner, staff and a resident with a quote from that worker, limits on free text and amounts, https-only server URL in release builds and Android backup off. Checked and found sound: RLS on every table, no `anon` privileges, `search_path` pinned on every security-definer function, workers cannot change role, rating, notifications or cash, resident phone and plot reach only the accepted worker, CNIC bucket not readable by its owner, no secrets in git. Still open: see OPEN-QUESTIONS #9, #10 and #12.

- **RLS tests (pgTAP):** per table, prove a customer, a worker and an unrelated user cannot read or write what they should not. The most important test set.
- **Accept race test:** concurrent accepts on one job give exactly one winner; the other quotes become not selected.
- **Supabase advisors:** run the security advisor before each release; fix every warning.
- **Manual abuse checks:** read another user's CNIC link, guess job IDs, post a job in another phase, request a phone number or plot number before acceptance, read a competitor's quote or a review as a worker.

## 11. Incident response (simple version)

1. Detect: user report, unusual log spike, or Supabase alert.
2. Contain: disable the affected account or feature, rotate the exposed key.
3. Review the audit log and storage access to see what was exposed.
4. Tell the affected people and DHA staff.
5. Fix the cause and add a test so it cannot return.

## 12. Pending decisions

| # | Decision | Suggested default |
| --- | --- | --- |
| 1 | Production WhatsApp OTP provider and cost | Twilio or Twilio Verify with a WhatsApp sender; account, sender and cost still to configure. Local test OTPs are not a production substitute. |
| 2 | Retention of CNIC and bill images | Delete after account closure plus a fixed period |
| 3 | ~~Address visibility to workers~~ | **Decided:** area before acceptance; phone, plot and floor after (Shariq, 26 Oct) |
| 4 | ~~Who reviews resident onboarding~~ | **Decided:** DHA staff review CNIC and bill by hand |
| 5 | ~~Extra worker checks~~ | **Decided:** police certificate or 2 references, in the MVP |
| 6 | ~~Backup level~~ | **Decided (27 Oct):** we create our own backups (daily dump plus storage copy, encrypted, restore-tested) |
| 7 | Legal: privacy notice and terms | Short privacy policy and terms at sign-up; get them reviewed |

## 13. Authentication and authorization bypass review (6 Nov 2026, 15 classes)

Each class was checked against the real code and hosted DEV, not assumed. Migration 0033 and `config.toml` changed only where there was a gap.

| # | Class | Result | Where |
| --- | --- | --- | --- |
| 1 | SQL injection | **Already safe.** The apps call SQL functions with typed parameters. No function builds SQL from user text: the only `format()` (in `submit_review`) builds a notification sentence, not a query. No `EXECUTE` on user input. | `supabase/migrations`, checked on DEV |
| 2 | Parameter pollution / tampering | **Already safe.** Signed-in users have SELECT only, plus write on three admin-only catalogue tables guarded by `is_admin()` policies. Role, status, ratings and links change only inside security-definer functions. | 0006, 0015, probed on DEV |
| 3 | Response manipulation | **Already safe.** Nothing is trusted from the client. Every function takes the caller from `auth.uid()` through `private.me(role)` (role, approved, not suspended) and RLS checks the same on reads. The two helpers without a caller check (`get_setting`, `is_filed_bill`) return no private data. | 0007 to 0009 |
| 4 | JSON injection | **Fixed.** `set_my_references` was the only function taking `jsonb`; it accepted any shape. Now: a list of at most 5 objects, only the keys name / phone / address, strings within their length, otherwise one clean refusal. | 0033, `auth_hardening.test.sql` |
| 5 | Session fixation | **Already safe.** GoTrue issues a new session on each OTP verification. The app wipes cached private photos on `SIGNED_OUT` and stores nothing before sign-in. | `lib/auth.tsx` |
| 6 | JWT / algorithm flaws | **Already safe.** PostgREST verifies tokens; the app holds only the anon key. The one Edge Function (`send-push`, not deployed) takes no user JWT: it is gated by a shared secret in a header, compared in constant time, and refuses to run if the secret is unset (23 Deno tests). So there is no custom JWT code to get wrong. | `send-push/handler.ts` |
| 7 | IDOR | **Already safe.** UUID keys plus RLS on every table: a user reads only their own rows, a worker only jobs that match them or that they hold. Probed on DEV as a worker, as a user with no profile and as anon. | 0006, 0025, 0032 |
| 8 | Token extraction | **Already safe.** The session lives in `expo-secure-store` (Android Keystore-encrypted), chunked for its size limit, passed to `createClient` as the storage engine; Android backup is off (0032). A rooted phone can still read a live session, as on any app. | `lib/secureStorage.ts`, `supabase.ts` |
| 9, 10 | Credential stuffing, OTP request flooding | **Tightened (config).** Per IP: sign-ins 10 per 5 min, verifications 10 per 5 min, one SMS per number per 60 s (was 30 / 30 / 5 s). The 30 SMS per hour limit is project-wide, so a flood can use it up and block real logins until CAPTCHA or Twilio Fraud Guard is on. | `supabase/config.toml` (local); **on hosted DEV set the same values by hand in the dashboard (Authentication > Rate Limits and Providers > Phone), not with `supabase:config-push`: config.toml has the Twilio provider disabled and no test numbers, so a push could switch off phone sign-in and the dashboard test OTPs** |
| 11 | Phone enumeration | **Already safe.** `signInWithOtp` with create-user returns the same result whether or not the number exists. The wrong-code message is one message for wrong, expired and unknown. A duplicate CNIC says only "unavailable". | `features/auth/*`, `profile/errors.ts` |
| 12 | OAuth / social login | **Not in use.** The worker app has only phone OTP. For the future admin and customer apps: enable only the providers needed, set the client id, keep `skip_nonce_check = false`, add exact redirect URLs, and never trust the provider's email unless `email_verified`. Supabase verifies the provider's signed token itself. | blueprint only |
| 13 | OTP brute force | **Mitigated, not solved.** GoTrue cannot cancel one code after N wrong tries. Compensating limits: 10 verifications per 5 min per IP, a short code life (set the SMS OTP expiry to 60 s in the dashboard), CAPTCHA on request. The real fix is Twilio Verify (5 tries per code, then it is cancelled, plus Fraud Guard): `[auth.sms.twilio_verify]`. Needs the Twilio account (OPEN-QUESTIONS #5, #12). | config and Twilio |
| 14 | Number change / identity reset | **Not offered.** The contact phone of a phone account is the number that signed in and the client value is ignored. The app has no way to change the sign-in number (Shariq, 6 Nov), and migration 0034 (trigger `lock_login_phone` on `auth.users`) refuses any change of a phone that is already set and any pending change, so a direct API call fails too. Setting a phone for the first time (null to a number) is still allowed. Moving an account to a new number is a staff/database action (disable the trigger for that statement). | 0033 |
| 15 | Registration races | **Fixed.** `register_profile` serialises one user's requests with an advisory lock and turns any unique violation into "profile already exists" or the original key error. Phone and CNIC are unique at the engine. Two sessions racing for one user or one CNIC give exactly one profile (`concurrency/register_race.sh`). | 0033 |

Before real users: on hosted DEV set sign-ins and verifications to 10 per 5 min, one SMS per number per 60 s, and the SMS OTP expiry to 200 s in the dashboard (the DEV expiry is 500 s today); for production use `npm run supabase:config-push -- production` only once the real Twilio values are in place, switch to Twilio Verify, and remove the fixed DEV test OTPs (OPEN-QUESTIONS #12).

## 15. Sign-in and takeover hardening (7 Nov 2026, migration 0036)

Sign-in is a phone number and a one-time code. These controls limit what a SIM swap, a recycled number or code guessing can do. Each was attacked on purpose (`scripts/challenge-auth-local.mjs`, `scripts/challenge-guess-hosted.mjs`).

| Risk | Control | Status |
|---|---|---|
| Code guessing | Config: 10 sign-ins and 10 verifications per 5 min per IP, 1 code per number per 60 s. **Local test:** the per-number 60 s limit works. The local auth server does not enforce per-IP limits at all (no rate-limit IP header), so they cannot be proven locally. **Hosted DEV drill (7 Nov): first FAIL** (30 wrong codes per 5 min, the Supabase default), because `config.toml` is never pushed to DEV. After the user set token verifications and sign-ins to 10 by hand in the dashboard, the drill printed **PASS** (cut off after 8 wrong codes). Re-run `HOSTED_ANON_KEY=... node scripts/challenge-guess-hosted.mjs` after any dashboard change. | **Fixed on DEV (7 Nov), by hand** |
| Long code life | SMS OTP expiry 200 s (user decision 7 Nov; 60 s is stricter but tight on slow networks; DEV was 500 s). Dashboard only. | **Open on DEV** |
| Fixed test OTPs | They exist on hosted DEV by design for Shariq's testing; the tracked config can never hold them (guard). `npm run safety:prod-ready` fails while a test OTP, default rate limit, missing CAPTCHA, missing Twilio Verify or missing session limit would reach production. | **Open until production (OPEN-QUESTIONS #12)** |
| No CAPTCHA, no 5-tries-per-code | Needs the Twilio account (Verify + Fraud Guard) and hCaptcha/Turnstile. `safety:prod-ready` reports them as blockers. | **Open, needs Twilio** |
| Silent takeover | Migration 0036: every sign-in after the first creates a `new_sign_in` notification (no data in it; shown in the app and sent as a push once `send-push` is deployed). A failing notice never blocks a sign-in. | Built, tested |
| Attacker keeps access | Profile > "Sign out other devices" (`signOut({scope:'others'})`). Verified on the local auth server: the other session cannot refresh, this one stays. | Built, tested |
| Suspended worker keeps a session | 0036 trigger ends every session and removes the push tokens at the moment of suspension (on top of every RPC refusing a suspended account). Verified end to end. | Built, tested |
| Sensitive actions after a takeover | Not built: no fresh-code check before cash entry or other sensitive steps. Recommended before launch. | **Open (design decision)** |
| `send-push` | Reviewed: POST only, shared secret compared in constant time, fails closed with no secret, recipients only from the database, no phone, plot or amount in any push (tested), tokens of suspended accounts skipped. Still **not deployed**; deploying needs the secret, a scheduler and the user's go-ahead. | Reviewed, 24 Deno tests |

## 16. Admin portal sign-in (7 Nov 2026, migrations 0037 to 0039, docs/ADMIN-PORTAL.md)

Staff sign in with email + password and then an emailed six-digit code (Supabase's authenticator-app MFA needs a paid plan, so this is the interim second factor). Every control was attacked directly against the API, bypassing the screens (`scripts/challenge-admin-local.mjs`, 38 checks, all held), and the screens were driven in a real browser.

| Risk | Control | Status |
|---|---|---|
| Stolen admin password | `is_admin()` also needs this session verified (`admin_verified_sessions`, 4 hours since migration 0046, deleted with the session). Password-only sessions are refused by every admin RPC, read no other profile, no audit log and no identity document; they cannot mark themselves verified. | Built, tested (pgTAP 67 + 84 assertions, live drill) |
| Guessing the code | 5 wrong tries lock that code (a refused call returns a status instead of raising, so the count is kept); even the real code is refused once locked; 10 minute life; 1 code per minute and 5 per hour per account; a code works only for the session it was issued to and only once. | Built, tested |
| Code leaks | Only a salted hash is stored; the code is never returned by the function, never written to the audit log, never in a URL. The function reads the user and session from the verified JWT and mails only that account's own address; the body cannot name anyone. | Built, tested (Deno 11 tests) |
| Becoming an admin | No code path creates an admin except `accept_staff_invite`: needs an invite made by a verified admin, the one-time token (hash stored, 7 days, one use) AND a session for that same email. Invalid cases all give one message. `register_profile` still refuses `admin`. | Built, tested |
| Identity data access | Opening an applicant is audited (`verification_viewed`); the queue never returns a CNIC, the detail only a masked one; documents open by signed URLs of 5 minutes; storage paths are validated; decisions need every checklist item (approve) or a reason (others) and are audited with a notification. | Built, tested |
| Abuse of suspend | Cannot suspend yourself or another admin; reason required; ends sessions and push tokens (0036) and flags the worker's live jobs for staff. | Built, tested |
| Web layer | No service-role key in the app; server actions re-validate everything; proxy refreshes cookies and redirects the signed out; CSP, no framing, no referrer, no-store, nosniff, HSTS. | Built. CSP still allows inline scripts (OPEN-QUESTIONS, admin portal item 4). |
| Hardening 10 Nov (migration 0046, not yet on DEV) | Verified session 4 hours (was 12). Wrong code guesses are capped per ACCOUNT (10 an hour across all codes, each one audited as `admin_code_wrong`). The invitation page checks the one-time token (`check_staff_invite`) before it creates any account. CSP uses a per-request nonce with `strict-dynamic`: no `'unsafe-inline'` for scripts, `base-uri 'none'`, `upgrade-insecure-requests`. Session cookies are HttpOnly, SameSite=Lax, Secure in production (`lib/cookies.ts`). Extra headers: CORP same-origin, HSTS preload, no source maps. | Built, tested (pgTAP `admin_hardening` 14, unit 55, live check of nonces) |
| Weaker second factor | One mailbox can reset the password and read the code. Move to TOTP on a paid plan before production (`safety:prod-ready` blocker `ADMIN_2FA_EMAIL`). | **Open (decision)** |
| Mail delivery | `admin-2fa` needs a mail provider and secrets; not deployed. | **Open** |

## 17. Admin portal operations (8 Nov 2026, migrations 0041 and 0042)

Every new admin function starts with `is_admin()` (a verified, second-factor session) and raises the same "not available" error for everyone else. pgTAP `admin_operations.test.sql` calls all 32 functions as a password-only admin, a resident and a worker and checks anon has no execute right; it also checks that the staff-only tables (`helpline_calls`, `staff_notes`) cannot be read directly.

| Risk | Control |
|---|---|
| Staff act without a trace | Every action writes `audit_log` with the staff member and reason in the same transaction: report decisions, calls and notes, job cancel / resume / replace, cancellation decisions, review hide / show, settings, categories, phases, staff removal, messages, helpline calls. Opening a case, a person or an applicant is audited too. |
| Identity data | Lists never return a CNIC; person pages return it masked. Documents open by 5-minute signed URL. Phone numbers appear only on the case, job and person pages (for call-back). |
| Cancelling paid work | A job in cash collected or reviewed can never be cancelled; unpaid jobs need a written reason; both people are told. |
| Locking everyone out | The last active category, the last active phase and the last active admin cannot be switched off or removed; nobody removes themselves. |
| Review manipulation | Reviews are hidden, never deleted, with a reason; the average is recomputed by a trigger so a new rating cannot undo a hide. |
| Invite abuse | /accept-invite is public but only works with the one-time token (hash stored, 7 days); every failure shows the same sentence. The invite list never shows tokens. The invite link is shown once. |
| Search and paging | One escaped, length-capped search helper; pages are capped at 50 rows. |

## 18. Admin portal and worker app hardening (11 Nov 2026, migration 0048, docs/TEST-PLAN.md section 7)

Added after a code-level review of both apps. Everything below is built and tested locally; the hosted pieces (Vercel, Turnstile keys, the dashboard settings) are listed at the end as things the owner must do.

| Risk | Control | Status |
|---|---|---|
| A stolen but verified admin session (4 hours) does the most damaging actions | **Step-up:** invite or remove staff, suspend or reactivate, cancel or replace on a job, decide a cancellation, settings, categories and phases need a code typed in the last 15 minutes (`admin_verified_sessions.fresh_at`, `private.admin_fresh()`). The database raises `confirm with a new code`; the portal sends the person to `/confirm`, then back to the page they were on (the return path is a same-site path only, `lib/stepup.ts`). Every confirmation is audited as `admin_step_up`. The same limits apply to codes (1 a minute, 5 an hour, 10 wrong guesses an hour). | Built, pgTAP `admin_step_up` (37), unit tests, live browser run |
| An abandoned screen stays signed in | **Idle logout:** 30 minutes without a request signs the staff member out on the server (HttpOnly `dha_active` cookie in `src/proxy.ts`, pure rules in `lib/idle.ts`). Supabase's own session timebox needs a paid plan. | Built, unit tests, live browser run (20 s test limit) |
| Bots and password guessing on the sign-in form | **Cloudflare Turnstile** on the password step, verified on the server (`lib/turnstile.ts`); fails closed if Cloudflare is unreachable or, in a production build, if the secret is missing. Supabase's own CAPTCHA switch is NOT used: it is project-wide and would also block the worker and customer apps. Limit: a direct call to Supabase's auth API skips the form, but a password alone opens nothing (code needed) and Supabase rate-limits it. | Built, unit tests, live run with Cloudflare's test keys |
| Leaked key in git (the Brevo key was one) | **gitleaks** job in CI over the full history (`.gitleaks.toml` allows only `.env.example` files and published local/test keys); **Dependabot** weekly (`.github/dependabot.yml`; Expo-pinned packages ignored). | Built; first CI run pending |
| Referrer leaks | `Referrer-Policy: same-origin` (the step-up page needs the page a form came from); other sites receive nothing. | Built, tested |
| Worker app: unneeded Android rights and plain-http | `app.base.json` via `expo-build-properties`: cleartext traffic off, R8 code shrinking and resource shrinking on in release builds; `SYSTEM_ALERT_WINDOW` and `WRITE_EXTERNAL_STORAGE` blocked. Checked in the generated manifest after `expo prebuild`; `src/lib/androidHardening.test.ts` fails if any is switched back. Already in place: session in the Android Keystore, `allowBackup: false`, https-only release servers, cached private photos cleared on sign-out, no logging of data. | Built, tested; needs a new EAS build to reach a phone |

**Deliberately not done, and why:** certificate pinning (breaks the app whenever Supabase rotates a certificate); root/jailbreak detection (easy to bypass, blocks honest users); Supabase CAPTCHA (would lock out both mobile apps); a fresh SMS code before a worker records cash (needs a server-side fresh-login rule, kept in OPEN-QUESTIONS); app lock and screenshot blocking in the worker app (need two new native modules and a new build; offered as an optional next step).

**Owner actions (cannot be done in code):** rotate the Brevo API key and the Expo token; delete `apps/admin/.env.local-backup` (git-ignored but holds secrets); create a free Turnstile site and set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in Vercel (a production build refuses every sign-in until the secret exists); set `IDLE_LIMIT_SECONDS` only for tests (never above 1800); apply migration 0048 to DEV when ready; keep the Supabase dashboard settings from section 15 (OTP expiry, rate limits); TOTP and session limits need a paid plan.

### 18.9 Admin portal: 13 Nov follow-ups

- **Idle-logout cookie:** `dha_active` is now cleared whenever nobody is signed in. Before, an old timestamp from an earlier session signed the next sign-in straight out. The idle limit stays 30 minutes.
- **A failed session check is not "not an admin":** a database or network fault shows a "try again" page; only a rejected or expired token goes to sign-in. The check still fails closed (nothing is shown).
- **Error pages never show internals:** `app/error.tsx` prints only a short reference (the digest); `app/not-found.tsx` shows no record details.
- **Independent audit (13 Nov, local stack, production build):** no critical findings. Checked and passed: nonce CSP with no inline script, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, HSTS, same-origin referrer policy, HttpOnly + SameSite cookies, no service-role key or JWT in the browser bundle, `requireAdmin()` on every server action except the intentionally public invite acceptance, `/confirm?next=` rejects off-site addresses, bad ids and odd query strings return a plain page.
- **Open, needs a decision:** `admin_decide_verification` (approve or reject a worker or resident), `admin_set_review_hidden`, `admin_job_resume` and `admin_send_message` do not require a fresh code. Approving a worker gives access to residents' details (docs/OPEN-QUESTIONS.md, 13 Nov).
- **Open, low:** every detail-page view writes an audit row (duplicates on reload); the portal's own database calls have no timeout.
- **Not yet proven on a live site:** real emailed codes, Turnstile, the deployed headers and cookie flags over HTTPS.

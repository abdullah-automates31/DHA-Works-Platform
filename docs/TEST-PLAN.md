# Test plan: DEV demo readiness (11 Nov 2026)

Goal: prove that the customer app, the worker app and the admin portal work together on the shared DEV backend, then rehearse the demo twice. This is a **DEV demo**, not a real-user pilot (section 9 lists what a pilot still needs). Passing automated tests is necessary but not enough: every item below is also run by hand on real devices.

## 1. Ground rules

- DEV only (`xiozwoocisesgmegewww`). No production project exists.
- **Synthetic data only.** No real CNICs, police certificates, utility bills or real residents' addresses in DEV. Photos used in tests are stock or blurred.
- Separate identities for separate roles: each tester signs in with their own number (never one account switching roles).
- Test codes live in the git-ignored `.env.dev-test-otps` and in the Supabase dashboard. Never paste them in chat or commit them.
- Write down every failure with: screen, steps, expected, actual, time. Fix, then re-run the whole section, not just the failed step.

## 2. Cast (accounts)

| Role | Who | Notes |
| --- | --- | --- |
| Resident 1 | Abdullah (+923000000101) | customer app |
| Resident 2 | Shariq (+923342477874) | customer app, second independent resident |
| Worker A | Abdullah's worker account (+923323524005) | real phone, push test device |
| Workers B, C, D | Demo Worker Plumber, Electrician, All-rounder (+923000000201 to 203) | created by `supabase/dev/seed_dev_demo_workers.sql`; add their codes in the Supabase dashboard first |
| Admin | one of the 3 admin accounts on DEV | portal, password + emailed code |

Before the run: seed the demo workers, check `supabase db query --linked "select count(*) from public.profiles where role='worker' and verification_status='approved'"` is at least 4, and that every worker covers the phases and trades of the test jobs.

## 3. Pre-flight (30 minutes before every rehearsal)

| # | Check | Pass when |
| --- | --- | --- |
| P1 | `supabase migration list --linked` | local and remote columns match, last = latest migration |
| P2 | DEV project is awake (free tier pauses when idle) | the dashboard opens, a worker sign-in works |
| P3 | Edge Functions `admin-2fa` and `send-push` | `supabase functions list` shows both ACTIVE |
| P4 | Installed worker build is the latest EAS build | version/commit shown in Settings or build page matches |
| P5 | Customer app build points at DEV | sign-in with a test number works |
| P6 | Admin portal URL loads over HTTPS | sign-in page shows, response headers include a nonce CSP |
| P7 | Phones: battery above 50%, notifications allowed, data/wifi on, battery saver off | |
| P8 | Test codes available for every number in section 2 | |

## 4. End-to-end job (the main demo path)

Run once with Resident 1 and Workers A and B competing; keep the log of what each screen showed.

| Step | Actor / app | Action | Expected result |
| --- | --- | --- | --- |
| 1 | Admin | sign in (password + emailed code) | dashboard loads; second factor email arrives within a minute |
| 2 | Resident (customer) | sign in with phone code | home shows the 8 categories |
| 3 | Resident | post a job: category, title, description, 1 photo, voice note optional, date and time (arrival) or ASAP | job appears in "My jobs" as Open |
| 4 | Workers A, B (worker) | pull to refresh Home; push on A's closed phone | job in feed within 10 s; **push "New Job Available" arrives with the app closed** |
| 5 | Worker A | open the job: no resident name, phone or plot shown | privacy rule holds |
| 6 | Workers A and B | both tap Accept at about the same time with a price | exactly one wins; the other gets a neutral "no longer available" message |
| 7 | Resident | open the quote (view quote): price lines, worker, visit window | quote shows; push "quote received" arrives |
| 8 | Resident | Accept the quote | job becomes Scheduled; worker sees the resident name and phone only now |
| 9 | Worker (winner) | Start job | status In progress; resident sees In progress |
| 10 | Worker | with materials in the quote: open the "Material bill" card, add a photo | card shows "Bill added" |
| 11 | Resident | open view quote again | the bill photo is shown (customer app change, PR in the customer repo) |
| 12 | Worker | Mark complete: without a bill the app refuses (materials above 0); with the bill it completes | job Completed |
| 13 | Worker | record the cash amount (write-once) | job closes as Cash collected; resident is asked to rate; push arrives |
| 14 | Resident | rate (three scores + hire again), optional comment | job Reviewed |
| 15 | Admin | Jobs: open the job | full timeline visible, audit entries for each step |
| 16 | Admin | Reviews: the new review is listed | listed, not hidden |

## 5. Edge cases and negative tests

**Customer / worker flow**
- N1 Resident rejects a quote, then another worker claims: only the new worker can proceed; the rejected worker cannot re-claim.
- N2 Resident taps Replace worker on a Scheduled job: job goes back to Open, old worker is excluded and told neutrally, a new push goes out.
- N3 Resident cancels an Open job; resident requests cancellation on a Scheduled job; admin decides it.
- N4 Quote unanswered: the job stays locked to that worker until the posting expires (known gap, section 9).
- N5 Worker cannot complete a job with materials without a bill; cannot attach a bill before the job is started; cannot change the cash amount after it is recorded.
- N6 Resident files "Report a problem" and "I feel unsafe"; admin sees both in Reports, unsafe first.
- N7 A rating below 3 files a poor-work report automatically.
- N8 Offline: turn off data on the worker phone, try an action: friendly message, no crash, retry works.
- N9 Kill the worker app, post a job: push still arrives; tapping it opens the right job.
- N10 Two residents at once: neither sees the other's job, quote or phone.

**Admin portal**
- A1 Verification: approve a pending worker; reject one with a reason; send one to Visit HQ.
- A2 Suspend an active worker: their sessions end, their live jobs are flagged "under review"; reactivate.
- A3 Cancel a job as staff with a reason; resume or replace a flagged job.
- A4 Cancellation requests: approve one, decline one with a note.
- A5 Helpline log: log a call, mark a call-back done.
- A6 Settings: change a window, add a category, deactivate a phase, invite staff (link shown once, works once), remove staff.
- A7 Sign-out, then open a portal URL directly: redirected to sign-in. Wait for the 4-hour verification to expire: the portal asks for a new code.

## 6. Automated checks (run on every push by `.github/workflows/ci.yml`)

| Check | Command | Today |
| --- | --- | --- |
| Config guard | `npm run safety:supabase`, `npm run safety:test` | green |
| Worker typecheck, lint, 251 unit tests | `npm run worker:typecheck`, `worker:lint`, `worker:test` | green |
| Admin typecheck, lint, 55 unit tests | `npm run admin:typecheck`, `admin:lint`, `admin:test` | green |
| Database, 34 files, 1339 assertions | `npm run db:local -- test db` (CI: `supabase test db`) | green |
| Concurrency, local only (3 workers claim one job; resident accepts two quotes) | `bash supabase/tests/concurrency/claim_race.sh`, `accept_race.sh` | green (11 Nov: exactly 1 of 3 wins, different winners on repeat) |
| Edge Functions | `deno test` in `supabase/functions/admin-2fa` (15) and `send-push` | green |
| Customer app (its own repo) | `./gradlew jvmTest` | run before every customer PR |

CI is read-only (no secrets, no deploys). It does not replace sections 4 and 5.

## 7. Security checks before a demo

- `npm run safety:prod-ready`: lists the blockers for production. A DEV demo may carry them, but they must be known and written down (section 9).
- Admin portal response headers: `Content-Security-Policy` has a nonce and no `unsafe-inline` for scripts; session cookies are HttpOnly (browser devtools, Application tab).
- A resident cannot read another resident's job or quote; a worker cannot read a quote that is not theirs (covered by pgTAP; spot-check in the apps).
- No service-role key, Brevo key, FCM key or Expo token appears in any app bundle, repo file or chat.
- Credentials exposed earlier (Brevo key, Expo token) must be **rotated before the admin portal is deployed**.

## 8. Rehearsal log and exit criteria

The milestone "Complete DEV demo readiness" is reached when all of these hold:

| Requirement | Evidence |
| --- | --- |
| Customer app completes the lifecycle (section 4 steps 2 to 14) | rehearsal log |
| Worker app completes the lifecycle on a real phone | rehearsal log |
| Admin portal verification and management work on the deployed URL (A1 to A7) | rehearsal log |
| All three apps use the same DEV backend, changes show in the other apps | steps 4, 7, 11 |
| Push delivery verified with the worker app closed (N9) | screenshot or recording |
| Two independent residents and at least 3 workers took part (N10, step 6) | cast list |
| Two full rehearsals with zero blocking failures | the table below |

| Rehearsal | Date | Build / commit | Participants | Failures | Pass |
| --- | --- | --- | --- | --- | --- |
| 1 | | | | | |
| 2 | | | | | |

## 9. Known gaps (decide, document, do not hide)

These do not block a DEV demo but block a real-user pilot:

- No production Supabase project; DEV is the free tier (no real backups, can pause when idle).
- `safety:prod-ready` blockers: CAPTCHA, Twilio Verify (5 wrong guesses per code), authenticator-app 2FA for staff, session time limits.
- Sign-in code channel: dev build is SMS, the decision was WhatsApp; real numbers need a working Twilio sender.
- An unanswered quote keeps the job locked until the posting expires (no timeout).
- Pending answers from Shariq (docs/OPEN-QUESTIONS.md, 10 Nov): is the bill still required at Complete Job, should the customer get a "bill added" push.
- Admin portal is not deployed yet; hosted email delivery of the second-factor code is unproven.

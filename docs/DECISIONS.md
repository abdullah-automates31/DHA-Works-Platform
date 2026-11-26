# Decisions Log

Most recent first within each group. "Confirmed" means agreed with Shariq Bhai; "Proposed" means recommended but awaiting confirmation. Worker auth was updated to phone + WhatsApp OTP on 30 Oct 2026.

## Product (22 to 23 October 2026)

| Decision | Status |
| --- | --- |
| **Push notifications (7 Nov):** one sender, `send-push`, sends through FCM directly for both apps (the Expo dispatcher is retired); both apps register raw FCM tokens (worker app: `expo-notifications` `getDevicePushTokenAsync`; Android only until there is an Apple account); every job event is pushed. Customer pushes may name the worker and show the quote amount (e.g. "Ahmed quoted 2,500 Rs"); worker pushes show the job title only; resident details never appear. Firebase project `dha-works`; worker ids `pk.dhaworks.worker` and `pk.dhaworks.worker.dev` | Decided by Shariq, 7 Nov |
| Two mobile apps and one web admin portal | Confirmed |
| Customer and worker accounts are separate | Confirmed (23 Oct) |
| Payment is cash only | Confirmed |
| Sign-in by email and Google first; phone OTP later | **Superseded 30 Oct for the worker app:** worker sign-in is phone + WhatsApp OTP. Resident/admin sign-in remains email/Google until those apps are built. |
| Worker app: phone number + WhatsApp OTP, six digits; email sign-in removed from the worker app; local fixed test OTPs only; production provider not configured | Approved by Shariq Bhai (WhatsApp verification and static development OTPs), confirmed by the user, 30 Oct |
| WhatsApp OTP delivery: Twilio (or Twilio Verify) for the MVP; Meta's WhatsApp Cloud API is a possible later integration, not planned now | Decided by user, 30 Oct |
| **6 Nov: keep WhatsApp as the only sign-in code channel for now. SMS delivery is added later** (the app already has the `EXPO_PUBLIC_OTP_CHANNEL` switch, used with `sms` only for DEV testing until a Twilio WhatsApp sender exists). Twilio Verify's 5-tries-per-code limit works over WhatsApp too, so it does not depend on SMS | Decided by user, 6 Nov |
| Matching by category plus DHA phase (1 to 8); no GPS | Confirmed |
| **Customer approves the price (9 Nov, Shariq; amends the claim-and-lock row below):** a worker's claim makes the job `quoted` and locks it to that worker; it is scheduled only when the customer accepts the quote. Before accepting, the customer can Replace worker (`reject_quote`: job back to open, worker excluded) or Cancel (`cancel_job`). After accepting: Replace worker (`replace_worker`) or Request cancellation | Built 9 Nov (migration 0043) |
| **Claim-and-lock model (6 Nov, supersedes the competition model below):** a worker accepts an open job with a price and it locks to them at once (`accept_job`, migration 0031); the customer does not compare quotes and can only Replace worker (reason, job back to open, old worker excluded). Defaults used, both to confirm with Shariq: the worker still states a price when accepting (so the agreed amount, the material-bill rule and cash work unchanged), and the customer has no approval step before the worker comes | Built 6 Nov at the user's request (final since 1 Nov) |
| ~~Competition model:~~ many workers mark interest and send quotes on a job; the customer compares and accepts one; the others are told "not selected". No claim lock, no discussion timeout. Source: UI designs (`DHA-Works-UI/SPEC.md`) | Confirmed by user, 26 Oct (supersedes the claim-lock rows below) |
| Worker verification is manual, by DHA staff. Documents per the UI: CNIC, police certificate, photo (supersedes "CNIC only"). Outcomes: Approve / Visit HQ / Reject | Confirmed by Shariq (reported by user, 26 Oct) |
| Residents are also verified by staff (CNIC + utility bill, one time) before they can post | Confirmed by Shariq (reported by user, 26 Oct) |
| Job statuses: open, interested, quoted, accepted, scheduled, in_progress, completed, cash_collected, reviewed; side states disputed and cancelled | Per UI design (SPEC.md) |
| Cash: worker records the amount, resident confirms; ~~a mismatch moves the job to disputed~~ | **Superseded 27 Oct**: a price difference never disputes a job (next rows) |
| A price difference never disputes a job by itself; the resident complains separately or rates below 3. A rating below 3 adds a `poor_work` report automatically | Shariq, 27 Oct (reported by user, 28 Oct) |
| Worker must upload a material bill (mandatory); typing a materials list is optional | Shariq, 27 Oct (reported by user, 28 Oct). **Changed 3 Nov (Shariq):** the quote carries an itemised materials list and estimated cost (toggle With/Without materials, no "Other" line); the actual bill is uploaded at Complete Job, only when the quote has materials above 0. **Changed 10 Nov (Shariq):** the worker can attach (or replace) the bill photo any time until the job is completed (`attach_material_bill`, migration 0045), and the customer sees it in view quote (`resident_quotes.material_bill_path`); Complete Job still needs a bill when the quote has materials, but accepts the one already attached. |
| The customer controls the job schedule; workers cannot set or change it; a worker told late must call the customer | Shariq, 3 Nov (the mentor's improvement document) |
| Rejected (including "customer chose another worker") and cancelled jobs disappear from the worker; a rejected job shows as one bare "Rejected" card; cancel notice: "This job has been cancelled. Do not travel to the customer's address." | Shariq, 3 Nov |
| Safety: "Report a problem" and "I feel unsafe" in both apps; helpline 1092; staff see both phone numbers | Per UI design; helpline wording to confirm |
| **MVP 2 (not MVP 1, per Shariq 26 Oct):** quote revisions: max 2 per job; allowed before work starts; after start only for unexpected extra work with explanation and itemised prices; resident must approve explicitly; all versions kept | Decided by user, 26 Oct; **superseded 9 Nov: cash is worker-only, the worker's amount closes the job** |
| ~~Discussion timeout is 24 hours~~ | Superseded by the competition model |
| ~~Rejected quote: job returns to Open; same worker cannot reclaim~~ | Superseded: a rejection does not reopen anything (other quotes stay live); see the no re-quote row below |
| Complaints allowed during the job and up to 7 days after; outcomes no action / warning / suspend | Decided |
| ~~Photos allowed in chat; phone numbers blocked best-effort~~ | Superseded: no chat in MVP 1 |
| English first; all text through a translation file | Decided |
| Commission deferred | Decided |
| Manual assignment of jobs by staff excluded from the MVP | Decided (23 Oct) |
| Cancellation rules | Proposed (see USER-FLOWS.md) |

## Technical

| Decision | Status |
| --- | --- |
| React Native + Expo + TypeScript for both apps | Agreed with Shariq |
| Next.js + TypeScript admin on Vercel | Agreed |
| Supabase for Postgres, Auth, Storage, Realtime, Edge Functions | Agreed |
| EAS Build; Android first; no Mac available, iOS later | Agreed |
| pnpm + Turborepo monorepo | Proposed (architecture not yet approved) |
| ~~Claim implemented as one atomic conditional UPDATE~~ | Superseded by the competition model. Replaced by: accept-quote RPC that atomically accepts one quote, rejects the others and moves the job to accepted (guard: job not already accepted/cancelled) |
| Supabase on the free tier for now; upgrade once funded | Confirmed by Shariq, 25 Oct |
| Build order: database and mobile APIs, then the mobile apps, then the admin portal | Confirmed by Shariq, 25 Oct |

## Design

| Decision | Status |
| --- | --- |
| Customer app uses the green design (19 screens) | Shariq Bhai, 24 Oct 2026 |
| Reduce shades, boxes and decoration ("calm pass") | Shariq Bhai, 24 Oct 2026; applied |
| Blue prototype superseded | 24 Oct 2026 |

## Workers and voice (26 Oct, Shariq Bhai)

| Decision | Status |
| --- | --- |
| Distance (km) filter and "Nearest" sort are out of the MVP; matching stays category + phase, no GPS | Confirmed (user, 26 Oct) |
| No re-quote after a rejected quote on the same job (other workers can still quote) | Decided by user, 26 Oct; design copy to be updated |
| Residents can save draft jobs (private, no notifications, no expiry until posted) | Decided by user, 26 Oct; **superseded 9 Nov: cash is worker-only, the worker's amount closes the job** |
| Reports allowed from Scheduled until 7 days after completion; existing reports stay reviewable after that | Decided by user, 26 Oct; **superseded 9 Nov: cash is worker-only, the worker's amount closes the job** |
| Categories (all apps): Plumbing, Electrical, AC & Refrigeration, Carpentry, Painting, Cleaning, Welding & Ironwork, General Handyman; stored in the database, admin-managed | Decided by user, 26 Oct; **superseded 9 Nov: cash is worker-only, the worker's amount closes the job** |
| Cash: both sides enter the amount (either order, immutable once submitted); equal closes the job and records any difference from the quote; unequal flags disputed for staff | Decided by user, 26 Oct; **superseded 9 Nov: cash is worker-only, the worker's amount closes the job** |
| Report outcomes: no action / warning / suspend; staff can cancel a job as a separate audited action; no refunds (cash, off-platform) | Decided by user, 26 Oct; **superseded 9 Nov: cash is worker-only, the worker's amount closes the job** |
| No chat in the MVP; workers and residents communicate by phone | Confirmed by Shariq (WhatsApp, 26 Oct, 11:18 PM: "Just call and figure out everything.") |
| Stuck job = same stage too long: Scheduled 24h past start time; In progress 48h; Completed with cash not recorded 48h. Flag for staff review and notify; never auto-cancel; open jobs just expire | Decided by user, 27 Oct |
| Suspended worker with an active job: job flagged under review, staff decide (resume, replace, cancel); nothing auto-cancelled | Proposed default (user, 27 Oct); confirm with Shariq |
| After acceptance, cancellation is by request and staff decide (neither side cancels unilaterally); the request is separate from job status; both apps need a Request cancellation flow; before acceptance the resident cancels | Decided by user, 27 Oct; confirm with Shariq |
| Resident reviews within 7 days of completion; Top rated = 10+ jobs and 4.5+ average, review count shown. Workers rating residents NOT in MVP 1 | Proposed default (user, 27 Oct); confirm with Shariq |
| Retention periods configurable and pending legal review; no fixed period committed; identity documents restricted to owner and staff | Decided by user, 27 Oct |
| Commission is 0% in MVP 1 | Decided by user, 27 Oct |
| Helpline 1092 is NOT published (buttons and FAQ hidden) until DHA confirms it is correct and authorised; number and an enabled flag live in settings | Decided by user, 27 Oct |
| Backups: we create our own (daily database dump plus storage copy, encrypted, kept outside Supabase, restore tested) instead of relying on the free tier | Decided by user, 27 Oct |
| From 27 Oct the builder decides remaining product and technical defaults; Shariq Bhai's confirmation is no longer required unless stated. Helpline 1092 stays hidden behind a setting until DHA approves. Worker authentication moved to phone + WhatsApp OTP on 30 Oct; resident/admin authentication remains email/Google until those apps are built. | Decided by user, 27 Oct; worker auth updated 30 Oct |
| A worker can have several categories | Confirmed (WhatsApp, 26 Oct) |
| Voice notes (resident job voice note, worker voice intro) are in the MVP; supersedes SPEC.md's post-MVP list | Confirmed (WhatsApp, 26 Oct) |
| Open jobs expire after 24 hours (repost allowed; accepted jobs never expire); accepting a quote goes straight to Scheduled | Decided 26 Oct (user) |
| Resident phone and plot number visible only after a quote is accepted; before that, only the area (phase and lane) is shown | Confirmed by Shariq (WhatsApp, 26 Oct, 11:33 PM: "No after they accept it. Only area will be shown.") |

## 1 Nov 2026 (Shariq Bhai, design v74)

| Decision | Status |
| --- | --- |
| The competition model stays as built (workers quote, the customer accepts one, the job locks to that worker). "In discussion" in Shariq's document is only his label for `accepted`, which stays unused | Shariq said "keep it what we have currently, dont change it" on 1 Nov, then later the same day described a claim-and-lock flow (next row). **Conflict: pending Shariq's final answer; nothing changed in the build** |
| Proposed by Shariq, 1 Nov (later message): when a job is open any worker can accept it and the job locks to that worker (the worker may then quote); the customer can cancel the job or "Replace worker", which asks for a reason and sends the job back to Open. This is the old claim-lock model that the competition model replaced | Confirmed as final by the user, 1 Nov. The customer does not compare quotes (only one worker holds a job at a time). **Built 6 Nov** (migration 0031, `accept_job`), with the worker stating a price when accepting |
| Before acceptance the worker sees "Customer · Phase N" only: no name, no lane, no Call. Call only on Scheduled and In progress | Design v74; can workers call before acceptance is still pending (OPEN-QUESTIONS.md) |
| Help and support "Report a problem" opens a job picker, then the per-job report form (reports stay per job) | Built 1 Nov |

## Direct booking and chat

| Decision | Status |
| --- | --- |
| Booking a specific worker (C06 to C09, W09) is out of the MVP | Per UI SPEC.md ("build last or skip") |
| Worker-customer chat is not designed in the UI | Out of MVP 1 (see above) |

## Where the source documents disagree

These were found while assembling these docs. Until resolved, the resolution below is used.

| Conflict | Resolution used |
| --- | --- |
| PRD scope table says language "English, Sindhi, Urdu"; later decision says English first | **English first**; other languages later |
| Security draft says phone number is the main identity; PRD and MVP Plan say email and Google first | **Split by app:** worker app uses phone + WhatsApp OTP (30 Oct); resident/admin apps remain email/Google until built |
| Product Brief and MVP Plan say two-way ratings; PRD v1.1 says customer rates worker only | **Customer to worker** (PRD, newer). Worker rating of customers is pending |
| Product Brief mentions licence details for workers; PRD says CNIC only; UI asks CNIC + police certificate + photo | **UI list** (26 Oct), no licence; to confirm with Shariq |
| PRD / architecture describe claim-lock with a 24h discussion; UI describes competing quotes | **UI** (confirmed by user, 26 Oct). PRD, ARCHITECTURE, USER-FLOWS, DATA-MODEL, TESTING, FEATURES, SECURITY, IDEA, ROADMAP, GLOSSARY, UI-UX and README rewritten on 27 Oct |
| Product Brief says disputes can start "from In Progress"; PRD says "during the job and up to 7 days after" | **PRD** |
| Architecture state table has *Accepted*; PRD has *Scheduled* | Store one status per PRD stage, including *Scheduled* |
| MVP Plan lists "Worker verification checks" as out of scope | **Superseded**: manual verification is in the MVP |
| Product Brief says rejected workers "cannot claim again"; consistent everywhere | No conflict |
| Who sets the visit time (3 Nov: "the customer controls the schedule") | **Superseded 9 Nov (Shariq):** the worker proposes the arrival window (day, from, to) when claiming, for ASAP and dated jobs; the customer's day is a request. The worker may change price and/or window **once**, before the customer accepts; accepting books the worker's window, and an accept of a quote changed since the customer loaded it is refused (`quotes.revision`). Migration 20261109140000 |

## 11 Nov 2026: admin step-up and idle logout (user, security hardening)

- Destructive admin actions need a code typed in the last 15 minutes; a verified session alone is not enough. A verified session lasts 4 hours; 30 minutes without activity signs the staff member out.
- The bot check on the admin password step is Cloudflare Turnstile, verified by the portal's server. Supabase's project-wide CAPTCHA stays off because it would block the worker and customer apps.
- Worker app: no certificate pinning, no root detection; Android hardening (cleartext off, shrinking on, unneeded permissions blocked) is on.

## 12 Nov 2026: the job lock rule (user), verified end to end

- A posted job is **open**. When a worker quotes it, the job becomes **quoted**: no other worker can see it in the feed or quote it, and it cannot be read directly.
- If the customer **rejects** the quote, the job returns to **open** at once: every matching worker except the rejected one sees it again, and the rejected worker cannot quote it again (they keep only a bare Rejected card with the title and status).
- If the customer **accepts** the quote, the job is **scheduled** and locked to that worker; every other worker, including the rejected one, cannot see it or quote it.
- This is the claim-and-quote model of migrations 0043/0044 (`accept_job`, `accept_quote`, `reject_quote`). Pinned by `supabase/tests/quote_lock_flow.test.sql` (35 assertions). An unanswered quote keeps the job quoted until the customer rejects it or the posting expires (no timeout yet).
- Known gap, deliberately not changed: the older competing-quote functions `express_interest` and `submit_quote` are not used by any app but can still be called through the API, and they still allow a second quote on a quoted job. Retiring them means rewriting six older pgTAP files (`job_lifecycle`, `schedule_and_hidden_jobs`, `worker_app_prep`, `worker_job_detail`, `worker_my_jobs`, `worker_reads_round_trip`). Recommended as a separate task.

## 13 Nov 2026: releases are tracked by tags, not by per-app branches (user)

- One repository holds the worker app, the admin portal, the database and the docs. Each app gets its own **release tags**: `admin-vX.Y.Z` and `worker-vX.Y.Z` (0.9.x = release candidate, 1.0.0 = first live). A tag is never moved. Shariq Bhai finds them at the repository's Tags page and in `docs/RELEASES.md`.
- A branch holding only one app's code is not used: the apps share `packages/supabase`, the root files, CI and `supabase/`, so such a branch would not build and would be painful to merge.
- Current tags: `admin-v0.9.0` (commit 5d2b4a1) and `worker-v0.9.0` (commit b6ff619). After launch: short-lived feature branches with pull requests into `dev`, CI path filters per app, protected `main` and `dev`, CODEOWNERS. The customer app (Shariq's repository) already works by branch and pull request only.

## 13 Nov 2026: admin portal behaviour decisions

- The idle-logout activity cookie is cleared whenever nobody is signed in, so a new sign-in is never signed out by an old timestamp.
- A failed session check (database or network trouble) shows a "try again" page; only a rejected or expired token goes to sign-in, and only a real "not an admin" answer shows "That account cannot use the portal".
- Forms keep what was typed after a refusal or the trip to the new-code page (kept in this browser tab for 15 minutes; a save clears it).

## Decisions of 14 to 16 Nov 2026 (owner)

- **Admin sessions never expire** (14 Nov, 0051): no idle logout and no 4-hour limit; the 15-minute fresh-code check for sensitive actions stays.
- **Admin second factor is the emailed code** (15 Nov, 0055): code by email at sign-in and for the sensitive actions only (suspending, deleting, approving or rejecting, settings, staff, reopening), never on every page. This reverses the authenticator app of 14 Nov (0052); the owner knows the emailed code is weaker.
- **A rejected applicant can apply again** (15 Nov, 0054): staff open the application again with a note; it returns to "needs changes".
- **A worker does one job at a time, but may line up the next** (15 Nov, 0057; a first hard block, 0056, was dropped): a worker with a job in progress still sees and accepts jobs; he tells the customer how long the current job will take (minutes, typed after accepting, popup from a notification); the customer decides to wait, reject, or replace the worker. A second job cannot be started while one is in progress. An unanswered quote is withdrawn after 30 minutes (my choice, to be confirmed).
- **Not part of the product:** the Bloom desktop app the owner downloaded for personal customising.

## 16 Nov 2026: busy workers, one visiting time, reminders, calls (owner notes; migration 0058)

These notes replace the "wait and give a finish time" part of the 15 Nov busy-worker rule (0057). 0057's held quote and `set_busy_eta` stay in the database only so that a quote already waiting can still expire; nothing creates a new one.

- **Parallel jobs:** a worker with a job in progress may **start** another only when it is for the **same customer on the same day** (Karachi calendar day of the booked visit). Jobs of different customers, or on different days, can never run in parallel: `start_job` refuses until the running ones are completed.
- **A busy worker may accept and quote** a new job (they still see the feed), but the quote must carry a **day and time**. There is no "as soon as possible" for a busy worker. When the customer accepts, the job is a **scheduled** job at that time. The quote reaches the customer at once (no estimate step).
- **One visiting time, not from/to:** the worker picks a day and one time (buttons, no sliders). The database still stores a start and an end (the customer app reads both): the end is **start + 1 hour**, the worker app sends it and the database fills it when it is missing. Show only the start.
- **Job reminder:** a switch on the worker's profile ("Job reminders", on by default, `worker_details.job_reminders`, `set_job_reminders`). One notice (`job_reminder`) goes out about **one hour before** a scheduled visit (every 5 minutes a sweep, once per visit; a visit booked less than an hour ahead is not reminded; a visit that moves is reminded again).
- **Call:** the customer's phone number is offered to the worker from acceptance on through every later stage (scheduled, in progress, completed, cash, reviewed, disputed). The worker's number is already in the customer's accepted quote.
- **Change quote (requote):** unchanged: once, while the customer has not decided. The button is in the worker app on the job's status screen ("Change quote (once)").

## 17 Nov 2026: the customer picks the visiting time (owner; migration 0059)

- **Supersedes** the line above that says the worker picks a day and one time. The visit time is **always the one the customer chose** when posting the job (`jobs.preferred_date` + `window_from`, Karachi time). The worker only quotes a price. Any time a worker app sends is ignored (parameters stay so older builds keep working). Stored end = start + 1 hour (placeholder).
- A job with no date (old "as soon as possible" job) is quoted without a time, except by a busy worker, who is refused. A visit time that has already passed cannot be quoted.
- The worker app's time picker (`ArrivalPicker`) is removed. The customer app must let the customer pick a date and **one** visiting time when posting (Shariq).

## 17 Nov 2026: customer details page (worker app)

- Tapping the "Verified resident" bar opens a full page (`job/[id]/customer`), not a pop-up. After the customer accepts: name, phase, Call button, phone, address (plot, floor, phase), visit time and the job summary. Before acceptance only the phase and the job summary show, with a "contact details are locked" card (privacy rule unchanged).

## 17 Nov 2026: customer app shows the worker's details only after both sides accept (owner; customer PR #18)

- Owner rule: the customer sees the worker's important details like the worker app shows the customer's, and the **phone number and booking details unlock only after both sides have accepted** (the worker quoted, the customer accepted that quote).
- Server: `resident_quotes.worker_phone` is null unless the quote status is `accepted` (tested in `job_lifecycle.test.sql`). App: `unlockedPhone()` in `WorkerProfileScreen.kt` repeats the rule, so a wrong server value could not leak a number. Before acceptance the profile shows name, rating, trades, phases, Verified badge, voice intro, stats and a lock note; after acceptance it adds the phone with a Call button and a "Your booking" card (visit time, total). Branch `abdullah/worker-details-and-call`, commit 44b11c8, 3 unit tests. Not run on a phone.

## 18 Nov 2026: the admin code is asked only at sign-in (owner; migration 0060)

- Owner: typing a new emailed code before every sensitive action was too slow. The six-digit code is now asked **once, at sign-in**. After that the session can invite or remove staff, suspend, approve or reject, decide reports, cancel or replace on a job, change settings, categories and phases, hide reviews and send messages without a new code.
- How: `private.admin_fresh()` now returns true for any verified session of the caller (migration 0060). Every sensitive function still calls it, so the 15-minute step-up can come back by restoring the 0048 body. The portal's `/confirm` page stays but is never reached. Sessions still do not expire (0051).
- Cost: a stolen session that already passed the code can now do these actions without the staff member's mailbox (docs/SECURITY.md section 18).

## 18 Nov 2026: admin sign-in lasts until sign-out; old authenticator functions closed; customer app blocks backups (audit; migration 0061, customer PR #19)

- Audit finding: a session that never expires plus no step-up code means a stolen portal cookie is admin access until that staff member signs out. A 7-day limit was built and tested, then the **owner chose to keep sign-in lasting until sign-out** (same day). Signing out ends it at once: the verification row is deleted with the session, a stolen access token stops working, and a stolen refresh token cannot restart it. Staff should sign out on shared computers.
- The six authenticator-app functions from 0052 (unused since 0055) are closed to all app roles (migration 0061).
- Checked by pgTAP (`admin_step_up`, `admin_totp`) and a live drill against the local API, `scripts/challenge-admin-session-local.cjs` (28 attacks: password only, self-enrolled authenticator, code guessing, forged and unsigned tokens, editing its own row, stolen tokens after sign-out; all refused).
- Customer app (Shariq's repo, PR #19): `allowBackup="false"` plus backup and data-extraction rules, so the sign-in session cannot be copied off the phone.
- Email sign-up stays on (the staff-invite page creates accounts with an email), but since migration 0062 `register_profile` refuses any account without a proven phone: an email-only stranger cannot become a resident or worker applicant with a typed number, and has no profile, so it can read nothing.

## 19 Nov 2026: worker app Settings

- New Settings area (Profile > Settings, or tap the profile header): Personal information, Professional details, Service area, Verification and documents, Notifications, Privacy and security, help rows, legal rows, app version, log out with confirmation. Only for approved workers (routing guard).
- Personal information: the name is editable only while the application is open (the database locks it after approval); the phone number is the sign-in and is never editable; the profile picture can be changed any time (only `avatar_path` changes, the verification photo stays with staff).
- Verification screen: the database records one decision per application, not per file, so each file shows the application's state, and the staff reason is shown once. Since the owner cannot read their own document rows after submission, migration 0065 adds `get_my_document_summary()` (type, upload time, reference count; never a path).
- Notifications: migration 0065 adds four switches (new jobs, job updates, report updates, announcements) next to the existing job reminders. They stop only the PUSH (a BEFORE INSERT trigger marks the row handled); the in-app list always shows every notice. Account warnings, verification decisions, suspensions and requests that need an answer are never switchable.
- Terms and Privacy Policy rows say "Coming soon" with no link. No password or device list screen: sign-in is a one-time code and the server keeps no device list.
- Migration 0065 applied on DEV 19 Nov (owner asked). pgTAP 43 files, 1,768 assertions; worker 300 tests.

### 19 Nov 2026: worker can change name and sign-in phone (migration 0066, owner decision; applied on DEV)

- Reverses two earlier locks on purpose. Phone (0034, Shariq 6 Nov "no change-number feature"): a WORKER's number may change, but only after a code sent to the NEW number is confirmed (`auth.updateUser` then `verifyOtp` type phone_change). The lock still stops customers and staff, clearing a number, and any move to a number no code was sent to. The profile phone follows by trigger and the move is written to the audit log (`worker_changed_phone`).
- Name: `change_my_name` works at any status; every change is audited (`worker_changed_name`, old and new name) so staff can compare with the CNIC in the admin Audit log. No staff notice or approval step exists yet.
- Number-change codes go by SMS (GoTrue's default for a phone change); the sign-in code itself stays WhatsApp. Check this when Twilio goes live.

### 19 Nov 2026: worker requests, replacement documents, my phones (migration 0067, owner decision; applied on DEV)

- New table `worker_requests` (no grants; apps reach it only through functions). Four kinds: `support` (worker message, staff answer), `document` (replacement CNIC, certificate or photo from an APPROVED worker), `name_change` and `phone_change` (written automatically by `change_my_name` and the phone trigger from 0066, so staff see every change).
- Support: worker sends a title and message (max 3 open, 5 a day); staff answer in admin portal > Worker requests; the answer shows in the app and arrives as a `staff_message` notice.
- Documents after approval: the file is uploaded as `<uid>/update-<type>-...` (the identity bucket now accepts that name from an approved worker); staff approve (the verification file and, for the photo, the profile picture are swapped) or reject with a reason; the old document stays valid until approval. The worker is told either way.
- Name and number changes: shown as items staff mark "reviewed". There is no approve or undo step.
- My phones: `my_sessions()` lists the account's sessions (plain labels, no IP or raw user agent); `sign_out_other_sessions(keep_token)` ends the other sessions and removes their push registrations, keeping this phone.
- Not done: staff do not get a push or email for new requests (the sidebar badge and the page show them); the send-push function was not changed.

### 20 Nov 2026: admin portal profile pictures (no migration)

- Customer and worker pictures show in the portal (Users and verification lists, job page, worker and resident detail, Worker requests). One same-origin route `/avatar?p=<path>` (staff only, `worker-media` bucket, image types only, `Cache-Control: private, max-age=604800, immutable`) replaces signed links, which change on every page load (no browser cache) and expire while a page is open. A picture's file name is new for every upload, so the long cache never shows an old picture. `AvatarPhoto` keeps the initials underneath and fades the picture in; a failed picture simply leaves the initials. Paths come from `profiles.avatar_path` in one read per page (`loadAvatarSrcs`).
- Not browser-tested yet (owner to look). Code: `apps/admin/src/lib/avatars.ts`, `components/AvatarPhoto.tsx`, `app/(portal)/avatar/route.ts`. Dev `2f5a068`; standalone portal repo `29439b5`.

### 20 Nov 2026: admin Forgot password (migrations 0068 and 0069, owner decisions; applied on DEV)

- Flow: Forgot password link on sign-in, email, six-digit code by email (our own function `admin-password-reset`, sent through Brevo, not Supabase's built-in mail), new password, back to sign-in. The page says plainly when an email is not an admin (owner choice; limits and the bot check keep guessing slow).
- Rejected by the owner, do not propose again: another admin must approve a reset; a same-message-for-everyone page; emails to other admins; any authenticator app.
- Safeguards: one code a minute and five an hour per address; five tries per code, ten wrong tries an hour lock; Cloudflare Turnstile; a reset ends every session of that person; audit rows for every step; the password must be 12 to 72 bytes.
- Takeover paths closed in the database: a trigger refuses any admin password change except through the reset functions (Supabase's own recover link no longer works for admins), and emailed sign-in codes are issued only to sessions that came from a password sign-in (a magic link or recovery session cannot get one).
- 0069: the first password sign-in after a reset does not ask for the emailed code again (10-minute one-use marker, audit `admin_signed_in_after_reset`). Tradeoff accepted by the owner: knowing the new password within 10 minutes skips the code once.
- Eye button on every password box; bot-check fixes (`Turnstile` component draws the box explicitly).

### 20 Nov 2026: worker My jobs cards have no buttons

- The cards show the job only; tapping a card opens the job status screen, where the worker starts, quotes, completes and records cash. The cash-due text stays on the card. (apps/worker, dev 7f3d75a; needs a new phone build to be seen.)

### 20 Nov 2026: no Docker (owner)

- "I dont want to use docker anymore." Database tests and drills run on the separate hosted TEST project; the worker app uses hosted DEV. See docs/ADMIN-PORTAL.md.

## 20 Nov 2026: Open jobs gets "Newest / Nearest" and "Within X km" (owner request)

Reverses the 26 Oct line "Distance filter and Nearest are out of the MVP". The worker app Open jobs screen now has the Newest / Nearest switch and a "Within 1, 3, 5, 10 km or any distance" sheet (default any distance), as in the design. Jobs carry no coordinates (privacy; the customer app does not send any), so the distance is an **estimate** to the middle of the job's DHA phase, from the worker's phone location (asked once, while using the app; ignored if far from Karachi) or, when location is off or refused, from the nearest of the worker's chosen phases. Shown as "Phase 6 · ~0.8 km". The phase centres in `apps/worker/src/features/feed/distance.ts` are approximate and need checking against a map. No database change: sorting and filtering run on the loaded feed (the screen pulls the remaining pages in while Nearest or a km limit is on). Matching is still category + phase. For real distances the customer app would have to send a job location (question for Shariq).

## 20 Nov 2026: busy worker tells how long the current job will take (owner request, design W12d "Current job time")

The 16 Nov rule (a busy worker only quotes a booked time, no finish estimate) is extended: when a worker who has a job in progress accepts another job, the Accept job form now asks first "How much longer will your current job take?" (chips 30 min to 4 hours, or typed minutes, 5 to 4320) and shows a "What the customer will see" card. The minutes go to `accept_job` as `p_busy_eta_minutes` (the database already stores them on the quote and `resident_quotes.busy_eta_minutes`; no migration). The worker cannot send the quote without them. The customer sees the time with the quote and can wait or replace the worker (customer app PR #17 shows it). Not enforced in the database yet: `accept_job` still treats the minutes as optional, so a later migration (0070 or higher) should require them for a busy worker. Worker app only: `BusyTimeSection`, `features/quote/busy.ts`.

**Refined the same day (owner answers, migration 0070):** the "current job time" question is asked only when it is needed: the worker has a job in progress **and** the customer's visiting time is within 6 hours (`app_settings.busy_estimate_window_hours`, default 6; a visit tomorrow shows nothing). The screen first asks "Will you be free by then?": Yes sends at once (the app sends the minutes until the visit, so the customer sees "free by the visit time"); No asks how much longer (chips or typed). The database refuses a busy worker's quote without minutes when the visit is inside the window (`accept_job`), so an old app version cannot skip it. Tests: `supabase/tests/busy_estimate_when_soon.test.sql` (hosted TEST project, all 48 files pass). **Migration 0070 is applied on the TEST project only, not on DEV yet** (needs the owner's go-ahead; tell the other session before pushing).

**Screen as designed (20 Nov, owner):** the "current job time" question is its own full screen (design W12d), not a section of the price form. Flow: price form, "Continue", then "Current job time" (your current job with its start time, the job waiting, "How much longer will your current job take?", chips, typed minutes, "What the customer will see", "Open current job" link, "Tell the customer"), then the usual confirm and send. A quick "I will be free by <visit time>" choice sits above the chips. The screen shows no customer name (before a quote is accepted the app never shows it). The hardware back button returns to the price form. Component: `CurrentJobTimeScreen`.

## 21 Nov 2026: one-week demo plan, iPhone without an Apple account, distance dropdown, keyboard rule

- **Demo week (owner, 21 Nov):** finish all three platforms and run a heavy DHA demo on **Fri 27 Nov**. The plan, the demo story, the clean demo data and the E2E bug log are in [DEMO-SCRIPT.md](DEMO-SCRIPT.md). A demo-ready MVP in a week is possible; a launch to real residents is not (Twilio WhatsApp approval, the Apple account and a tested restore are on other people's clocks).
- **The demo needs iPhones, but the Apple Developer account is bought next month (Shariq, 21 Nov).** So this week there is **no signed iOS build and no iOS push**. Worker app on an iPhone: Expo Go (Metro, or a published EAS Update that needs no PC). Customer app on an iPhone: Shariq's Mac with Xcode and a free Apple ID (7-day certificate), installed the day before. Push is shown on Android only. The worker app already skips push on iOS (`features/push/device.ts`), so Expo Go does not crash on it.
- **The demo gets its own clean data, tagged [DEMO]; the shared DEV project is not cleaned.** DEV holds about 66 old jobs with junk titles and Shariq's own test history. DW-2088, DW-2090 and DW-2091 are scheduled jobs with accepted quotes, kept as fixtures for the busy-worker flow. Nothing on DEV was deleted.
- **Open jobs distance picker (owner request, replaces the 20 Nov bottom sheet):** "Within X km" is a dropdown under the button with **1, 2, 3, 5, 10 km and Any distance** (2 km is new). The chosen option is bold green with a tick; tapping outside or the button closes it. The "estimates to the middle of each DHA phase" note is no longer in the picker (cards still show the distance with a "~").
- **Keyboard rule (worker app):** the Submit button must never be hidden by the on-screen keyboard. The app draws edge to edge (`edgeToEdgeEnabled`), which makes `adjustResize` stop moving the screen on current Android, and every `KeyboardAvoidingView` lifted on iOS only. All of them now use `behavior="padding"` on both platforms, and `lib/keyboardRules.test.ts` fails the build if one is iOS-only or has no behavior. The Report a problem screen had no behavior at all. **Tried and reverted:** a fixed Send footer on Report and Support left the form so short on an iPhone that the text box showed as a thin sliver (owner screenshot). Still open: scroll the focused box above the keyboard and add a Done button.
- **Admin portal:** `lib/auth.ts` and `lib/supabase/server.ts` import `server-only`, so a client component that imports them fails the build. No secret reaches the browser (checked in the built bundle on 21 Nov); the only public values are the Supabase URL and anon key and the Turnstile site key.
- **Rate limiting (analysis only, not built):** per-account limits exist in the database (sign-in and reset codes: one a minute, five an hour, 5 wrong tries per code, 10 an hour across codes; Turnstile on the password step). There is **no per-IP or global limit**. The cheapest fix is a Vercel firewall rate-limit rule on `/signin*` (a dashboard setting, plan permitting); an in-code limit would need an external store. Not needed for a demo; worth doing before real use. Owner decides.

## 22 Nov 2026: DHA fee and My Dues (owner and Shariq Bhai; reverses "commission 0%" of 27 Oct)

- **The fee comes OUT of the worker’s quote; the customer pays the quote only.** (First drafted as a fee added on top; the owner changed it the same day: "customer will get the actual quote only".) The worker collects the full quote in cash and then owes DHA the fee. Nothing changes in the customer app.
- **Base = the worker’s LABOUR price only** (owner, 22 Nov): materials are the worker’s cost and are never charged. Fee = 0 with no labour price, else least(labour, greatest(minimum, round(labour x percent / 100))). One decimal in the percent. Example: Rs 400 labour + Rs 100 materials at 20%, minimum Rs 50: Rs 500 quote, Rs 80 to DHA, the worker keeps Rs 420.
- **It ships switched off** (percent 0, minimum 0). Staff set the rule in Settings > DHA fee and dues (registry defaults 20 / 50 / 5 days). A change applies to new quotes and to quotes a worker changes; an accepted quote keeps its fee (snapshot in quotes.dha_fee).
- **The worker app shows the breakdown while quoting:** total quote, pay to DHA, you get (card "WHAT YOU GET"; only while the fee is on).
- **My Dues (worker app):** each finished job (cash recorded) adds a due, payable within the due days (default 5). The worker pays by JazzCash, Easypaisa or bank and enters the transaction ID (no screenshot, to fit one day); staff confirm it or reject it with a reason, or record office cash, waive a due (reason) or send a warning. Confirmed payments clear the oldest dues first; an overpayment stays as credit. Up to 3 payments may wait at once; a transaction ID cannot be used twice.
- **Suspension stays MANUAL** (admin Suspend on the worker profile). Automatic suspension for expired dues comes later. A suspended worker is signed out on the server at once and the app is locked to the Suspended screen (reason, amount owed, how to pay, call and WhatsApp DHA support from the helpline number); they can still open My Dues to pay. Signing in again lands on the same screen. A literal sign-out to the sign-in screen was not built (it would need a saved copy of the dues info on the phone).
- **Instant lock:** the worker app listens, for the whole session, for its own account_suspended / account_reactivated notice (one Realtime channel in lib/profile.tsx, an exception to the "channel only on the focused screen" rule in docs/PERFORMANCE.md) and reloads the profile when the app returns to the foreground.
- **Money is never lost in the middle:** the allocation of payments to dues is worked out on read (private.dues_rows), so waiving a due or confirming payments out of order needs no re-allocation.

**The customer must not be able to learn about the fee (owner, 22 Nov; migration 0072).** Nothing the customer app shows carries it (views, totals, cash amount, notices, push text). A customer’s own login is also shut out of the two places it lived: quotes.dha_fee (authenticated has SELECT on every quotes column except it; a new quotes column needs its own grant) and the fee and dues rows of app_settings (dha_fee_percent, dha_fee_min, dues_due_days, dues_pay_to are readable by staff and workers only, also through get_setting). A worker reads their own fee on a job with my_job_fee(job). Tested in supabase/tests/dues.test.sql section 13. When you add anything about the fee, check that a customer cannot read it.

**Payment screenshot and more ways to pay (owner, 22 Nov; migration 0073).** A worker must attach a screenshot of the payment when sending it (the transaction ID stays required too); staff see the picture next to Confirm and Reject in the queue and in the worker’s ledger. Ways to pay: JazzCash, Easypaisa, Bank, SadaPay, NayaPay and Other (office cash is recorded by staff only). Screenshots live in the private bucket dues-proof, one folder per worker; the worker uploads to their own folder (a suspended worker too, who pays to be reactivated), staff read everything, nobody else reads anything. The path must be exactly worker id / dues / file and the file must really exist in the bucket, or the payment is refused ("attach a screenshot of your payment"). An old worker build that sends no screenshot is refused with that message.

**A due is a card that opens (owner, 22 Nov; migration 0074).** In My Dues every due is a card; tapping it opens the due in full, like a job in My jobs: the job (title, code, category, where: phase and lane, when it was completed and the cash recorded), the money (what the worker quoted with labour and materials, the DHA fee, what they earned, the cash collected), the fee on that job (fee, paid, left, due date and state) and, when something is left, the payment form with the amount filled in. A button opens the job itself. The customer’s name, phone and address are never part of it. Payments still clear the oldest dues first (the screen says so), so a payment made from one due may also pay older ones.

**DHA’s payment accounts are entered one by one (owner, 22 Nov; migration 0075).** "Where to pay" was one block of free text that workers had to retype. Staff now enter each account in Settings > DHA fee and dues as how workers pay (JazzCash, Easypaisa, bank, SadaPay, NayaPay, Raast ID, other) + account title + number (+ the bank name), up to six; My Dues and the Suspended screen show each as its own card with a large number (press and hold to copy; a Copy button needs a native module and waits for the next phone build). The old free text stays as an optional note. Changing the accounts needs a fresh sign-in code and is audited, because it decides where workers send money. **Open for the owner and Shariq:** which real accounts DHA uses (business wallets and a bank account or Raast ID in DHA Works’ name are the proper choice; a personal wallet only for a small pilot); the DEV placeholder number is fake. A payment gateway (automatic confirmation, no screenshots) is a later upgrade.

**My Dues has a search box, not "Clear all" (owner, 22 Nov; migration 0079).** A "Clear all" for lists of 20 cards was built (0077, 0078) and then dropped: a worker may need to show a paid due later, and the dues are money records. Instead a search over every due and payment finds a card by job, number, amount, transaction ID or state.

**A rejected payment is explained (owner, 22 Nov).** When staff reject a payment the worker sees a red block at the top of My Dues: what was rejected (amount, way of paying, transaction ID), the reason staff typed, and a note to try again; the rejected card in the history shows "Reason: ...". Rule `latestRejection` in the worker app: the newest payment, if it is rejected.

**Worker profile shows the dues at a glance (owner, 22 Nov).** A "DHA dues" card on the worker profile in the portal: dues paid, dues left to pay (red when overdue), payments pending and all dues, with a link to the full Dues tab.

**Refund and reversal are not built (22 Nov).** The product has no refunds. A confirmed payment cannot be undone in the portal; an overpayment becomes credit that covers the next dues. Waive (reason required) and office cash (confirmed at once) are live and were tried by the owner. A "Reverse payment" button is an option, not a decision.

**The feature was checked live on DEV (owner, 22 Nov)** and judged complete; the fee stays on in DEV until the owner says the full test passed, then it goes back to 0 and real activation waits for the owner.

## 24 Nov 2026: automatic check of the dues payment screenshot (owner and Shariq Bhai; migration 0080)

**What it is.** When a worker sends a dues payment with its screenshot, DHA's own reader service reads the picture and the database decides whether it matches. Staff see a badge ("Screenshot matches", "Needs a closer look" with reasons, "Could not read", "Not checked yet") and what the worker typed beside what the screenshot shows, with a filter on the queue. **The admin still confirms or rejects by hand.** No auto-confirm, no auto-unlock, no amount limit.

**Our own SDK, no third party (Shariq, 24 Nov).** The screenshot is never sent to another company (not Claude, not Google). The reader is our own service (`services/screenshot-reader`) with an open-source OCR (PaddleOCR) running on our own server; it hands fixed fields to the database. Training our own OCR model was ruled out (months of work, reads worse). Open-source OCR inside the service is the owner's reading of "own SDK"; Shariq has not yet confirmed that wording.

**The reader only reads, the database decides.** `dues_check_apply` (service role only) applies fixed rules to the fields: the amount in the screenshot against the amount typed (exact, no tolerance) and against what is owed (a part payment is flagged "Less than owed" but can still be confirmed); the transaction ID against the one typed, and not used on another payment or picture; the receiver is one of DHA's saved accounts (0075); the status is successful; the date is not older than 7 days before sending, not after it, and not before the oldest due existed; the app matches the way the worker said they paid. Text written inside a picture cannot change a rule.

**It never blocks the worker.** The call to the reader is a trigger that never raises (as for push); a cron job (`dw-dues-check-retry`, every 5 minutes for an hour) asks again; if the reader is down the payment stays in the normal manual queue. The check is closed to workers and residents (closed table, no grant; `my_dues` is unchanged).

**Honest limit.** A matching badge means the picture looks right and agrees with what was typed. An edited screenshot can still pass and it does not prove the money arrived; staff keep the final decision and, for large amounts, glance at the real account. A later, free upgrade is matching against DHA's own statement export.

**Docker on the server only (owner, 24 Nov).** The 20 Nov "no Docker" decision is about the developer PC and the local Supabase stack and stands. The reader runs in a container on a server (plain Docker Compose with an HTTPS front); never start Docker on the PC.

**Two phases (owner, 24 Nov).** Phase 1 (done): migration 0080, the rules, the admin portal badge and comparison, tests, a demo seed. Phase 2: the real OCR engine on a server, the per-app parsers tuned on 30 to 50 sample screenshots, then switched on. Test screenshots must be synthetic, or the owner's own small transfers kept out of git (the repository is public).

## 25 Nov 2026: Shariq confirms open-source libraries are fine (screenshot check)

Shariq on WhatsApp: "It's okay to use libraries. Just don't share images outside of our system." So the reader may use an open-source OCR library (PaddleOCR) inside our own code on our own server. The hard rule stays: no payment screenshot is ever sent to any outside company or service (no Claude/Anthropic, Google, or hosted OCR API). Model files are downloaded once and bundled into our image. This closes the open question about "own SDK" in the 24 Nov entry.

## 26 Nov 2026: Shariq says keep the screenshot reader OFF; DHA approves dues by hand; new QR flow is second priority

Source: Shariq on WhatsApp, 26 Nov, around 1:49 AM (the owner sent screenshots of the chat).

1. **The OCR (screenshot reader) stays OFF for now.** Shariq: "for now keep this off. DHA will manually approve due." So no server, no Vault entries `reader_url` and `reader_secret`, no local runner. Everything already built stays in the repository (migration 0080 on DEV, the admin badge code, `services/screenshot-reader`); it does nothing while the two Vault entries are missing. The owner had told Shariq a server is needed before production for the reader to work 24/7: that stays true if the reader is ever switched on.
2. **New dues flow described by Shariq, marked second priority.** When a worker taps a due, the app first checks whether it is already paid. If not paid, it opens a details screen with a QR code and, under it, a short guide: "Open any banking app, click pay via QR, scan QR." Further down the same screen is a "Verify payment" option: after paying, the worker comes back and taps it. DHA has no P2M integration yet, so it "will verify payment anyway and the due becomes paid." (Not built.)
3. Shariq also sent a 15 second voice note at 1:29 AM that is not written down anywhere; the first priority is probably in it.

Open questions for the owner and Shariq (also in OPEN-QUESTIONS 26 Nov): what is the first priority; what exactly "Verify payment" does today (does the tap make the due paid at once, or does it only send DHA a request that staff approve by hand); where the QR comes from (one DHA QR image set by staff in Settings, or one per account); whether the QR flow replaces the screenshot and transaction-ID form or sits beside it; whether the admin badge ("Not checked yet" on every payment) should be hidden while the reader is off.

### 26 Nov 2026, clarification from the owner (Shariq's answer): the QR flow is the P2M integration, to be done after DHA is onboarded

The QR details screen and "Verify payment" button Shariq described above are the **P2M integration** (merchant QR payments). It is built **later, once DHA is successfully onboarded with the payment provider**; it is not a task for now and not a quick app screen. Until then the current flow stays: the worker pays by JazzCash, Easypaisa, bank and so on, attaches the screenshot and transaction ID, and **DHA staff approve the due by hand** in the admin portal. The screenshot reader stays off (see above). When P2M goes live, "Verify payment" would confirm a payment from the provider's own record instead of from a screenshot, which is a stronger check than reading a picture. Needs then: the provider and its API (not chosen), the merchant account for DHA, and a decision on how it sits next to the manual flow.

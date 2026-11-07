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
| **Claim-and-lock model (6 Nov, supersedes the competition model below):** a worker accepts an open job with a price and it locks to them at once (`accept_job`, migration 0031); the customer does not compare quotes and can only Replace worker (reason, job back to open, old worker excluded). Defaults used, both to confirm with Shariq: the worker still states a price when accepting (so the agreed amount, the material-bill rule and cash work unchanged), and the customer has no approval step before the worker comes | Built 6 Nov at the user's request (final since 1 Nov) |
| ~~Competition model:~~ many workers mark interest and send quotes on a job; the customer compares and accepts one; the others are told "not selected". No claim lock, no discussion timeout. Source: UI designs (`DHA-Works-UI/SPEC.md`) | Confirmed by user, 26 Oct (supersedes the claim-lock rows below) |
| Worker verification is manual, by DHA staff. Documents per the UI: CNIC, police certificate, photo (supersedes "CNIC only"). Outcomes: Approve / Visit HQ / Reject | Confirmed by Shariq (reported by user, 26 Oct) |
| Residents are also verified by staff (CNIC + utility bill, one time) before they can post | Confirmed by Shariq (reported by user, 26 Oct) |
| Job statuses: open, interested, quoted, accepted, scheduled, in_progress, completed, cash_collected, reviewed; side states disputed and cancelled | Per UI design (SPEC.md) |
| Cash: worker records the amount, resident confirms; ~~a mismatch moves the job to disputed~~ | **Superseded 27 Oct**: a price difference never disputes a job (next rows) |
| A price difference never disputes a job by itself; the resident complains separately or rates below 3. A rating below 3 adds a `poor_work` report automatically | Shariq, 27 Oct (reported by user, 28 Oct) |
| Worker must upload a material bill (mandatory); typing a materials list is optional | Shariq, 27 Oct (reported by user, 28 Oct). **Changed 3 Nov (Shariq):** the quote carries an itemised materials list and estimated cost (toggle With/Without materials, no "Other" line); the actual bill is uploaded at Complete Job, only when the quote has materials above 0. |
| The customer controls the job schedule; workers cannot set or change it; a worker told late must call the customer | Shariq, 3 Nov (the mentor's improvement document) |
| Rejected (including "customer chose another worker") and cancelled jobs disappear from the worker; a rejected job shows as one bare "Rejected" card; cancel notice: "This job has been cancelled. Do not travel to the customer's address." | Shariq, 3 Nov |
| Safety: "Report a problem" and "I feel unsafe" in both apps; helpline 1092; staff see both phone numbers | Per UI design; helpline wording to confirm |
| **MVP 2 (not MVP 1, per Shariq 26 Oct):** quote revisions: max 2 per job; allowed before work starts; after start only for unexpected extra work with explanation and itemised prices; resident must approve explicitly; all versions kept | Decided by user, 26 Oct |
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
| Residents can save draft jobs (private, no notifications, no expiry until posted) | Decided by user, 26 Oct |
| Reports allowed from Scheduled until 7 days after completion; existing reports stay reviewable after that | Decided by user, 26 Oct |
| Categories (all apps): Plumbing, Electrical, AC & Refrigeration, Carpentry, Painting, Cleaning, Welding & Ironwork, General Handyman; stored in the database, admin-managed | Decided by user, 26 Oct |
| Cash: both sides enter the amount (either order, immutable once submitted); equal closes the job and records any difference from the quote; unequal flags disputed for staff | Decided by user, 26 Oct |
| Report outcomes: no action / warning / suspend; staff can cancel a job as a separate audited action; no refunds (cash, off-platform) | Decided by user, 26 Oct |
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

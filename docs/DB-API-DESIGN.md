# DB and Mobile API Design (draft for Shariq Bhai's review)

Status: **design draft; the worker auth change was implemented on 30 Oct 2026.** Scope agreed with Shariq on 25 to 26 Oct: design the database and the **mobile-app APIs** first, then build the mobile apps, then the admin portal. This doc supersedes the claim-lock parts of [DATA-MODEL.md](DATA-MODEL.md) and [ARCHITECTURE.md](ARCHITECTURE.md); see [DECISIONS.md](DECISIONS.md). Source for screens: `DHA-Works-UI/` (`SPEC.md` + screenshots), read screen by screen on 26 Oct.

Conventions: "API" on Supabase means (a) **RPC** = a Postgres function called with `supabase.rpc()` for every write that changes state, and (b) **reads** = PostgREST queries on tables/views, protected by RLS. Apps never update status columns directly.

## 1. Business model in one paragraph

A verified resident posts a job. Approved workers whose category and phase match see it, mark interest (and may call the resident), then send a quote (labour, materials, other, visit window). The resident compares quotes and accepts one; all other quotes become "not selected". Visit is scheduled, worker starts and finishes, then **both sides record the cash amount**; matching amounts close the job, different amounts flag it `disputed` for staff. The resident then rates the worker. Staff verify every worker and resident and handle reports.

## 2. Job state machine

```
draft -> open -> interested -> quoted -> accepted -> scheduled -> in_progress -> completed -> cash_collected -> reviewed
                                                                   \-> disputed (from in_progress onward)
           open|interested|quoted -> expired (24h, system);  any of open|interested|quoted -> cancelled (resident);  any non-final -> cancelled (staff, with reason)
```

| Transition | RPC | Caller | Guard | Side effects |
| --- | --- | --- | --- | --- |
| draft -> open | `post_job` / `publish_job` | resident (approved) | required fields, 1 to 6 photos | notify matching workers |
| open -> interested | `express_interest` | worker (approved, matches category + phase) | job status open/interested/quoted | notify resident; count updates |
| (stage recompute) | internal `recompute_job_stage` | system | before accepted: no live interest = open; live interest, no live quote = interested; any live quote = quoted | |
| -> quoted | `submit_quote` | worker with interest | job not yet accepted; no other live quote by this worker | notify resident |
| quoted -> accepted/scheduled | `accept_quote` | owning resident | job in (interested, quoted); quote status sent; **row-locked, single transaction** | accepts this quote, marks every other sent quote `not_selected`, sets accepted worker and schedule from quote, notifies all |
| open (or interested/quoted) -> scheduled | `accept_job` (6 Nov, claim-and-lock) | approved, active worker matching the job's trade and phase | job in (open, interested, quoted), not expired, no accepted worker, the worker has no `rejected` quote on it; **row-locked, single transaction** | inserts the worker's quote as `accepted` (labour, materials, note), marks any older `sent` quotes `not_selected` (and tells those workers), sets accepted worker and the schedule, replaces a stale `cash_records` row with `agreed_amount` = the total, notifies the resident (`job_accepted`) |
| (reject) | `reject_quote` | owning resident | quote sent | reason stored; **that worker cannot quote this job again (provisional)**; job stays open to others; recompute stage |
| (revision, **MVP 2, not built in MVP 1**) | `request_revision(job_id, items, reason)` | accepted worker | job scheduled or in_progress; fewer than 2 approved/pending revisions for the job; after start, reason required and only for additional work | new `quotes` row (`revision_of`, `revision_no`, status `revision_pending`); notify resident |
| (revision, **MVP 2**) | `approve_revision`, `reject_revision` | owning resident | revision pending | approve: new quote becomes the agreed one, old one `superseded`, `cash_records.agreed_amount` updated; reject: original quote stands (rejected revision still counts toward the limit) |
| (withdraw) | `withdraw_quote`, `withdraw_interest` | worker | before accepted | recompute stage |
| scheduled -> in_progress | `start_job` | accepted worker | | |
| in_progress -> completed | `complete_job(job, bill_path)` | accepted worker | | material bill photo required when the accepted quote has materials above 0 (confirmed by Shariq, 3 Nov; the quote itself carries only the itemised list and estimate); prompts both for cash |
| (cash) | `record_cash_worker`, `confirm_cash_resident` | worker / resident | job completed; either side may go first | when both present -> `cash_collected` always. Worker/resident gap and gap against the quote stay on `cash_records`. A price difference never disputes a job (Shariq, 27 Oct) |
| cash_collected -> reviewed | `submit_review` | resident | one per job | updates worker rating; mean score below 3 also files a system-generated `poor_work` report |
| -> cancelled | `cancel_job` | resident before accept; staff later (admin phase) | reason | notify workers who quoted |
| -> disputed | no longer set by cash mismatch; `disputed` stays in the enum, unused for now. `file_report` flags the job (`under_review_reason`) without changing status | either party | job from scheduled onward | staff alert |

Recommendation (needs Shariq): `accept_quote` moves the job straight to `scheduled` because every quote carries a visit window, so `accepted` is never visible to users. Keep `accepted` in the enum (SPEC lists it) but treat it as transient.

Every transition function: checks caller role and current status, updates, writes `job_events` (the timeline shown in both apps and admin) and `audit_log`, all in one transaction. Quote `total` is computed in the database, never trusted from the client.

## 3. Tables

### Identity and verification
| Table | Fields |
| --- | --- |
| `profiles` | id (= auth.users.id), role (`resident`, `worker`, `admin`), full_name, email, phone, gender, date_of_birth, cnic, verification_status (`pending`, `approved`, `needs_changes`, `visit_hq`, `rejected`), verification_reason, account_status (`active`, `suspended`), avatar_path, locale. One sign-in identifier = one role (accounts separate). The worker's auth identifier is `auth.users.phone`; `profiles.email` is nullable for phone-only accounts. |
| `resident_details` | profile_id, default_address_id |
| `addresses` | id, resident_id, label, phase (1 to 8), lane, plot_no, floor, is_default (design: "My addresses 2") |
| `worker_details` | profile_id, experience_years, visit_fee, voice_intro_path, available_today, rating_avg, rating_count, jobs_done (maintained by triggers) |
| `worker_categories` | worker_id, category_id (join table: onboarding says "pick every trade", profile says one category; schema supports both) |
| `worker_areas` | worker_id, phase |
| `worker_references` | worker_id, name, phone, address (alternative to police certificate: "2 references from DHA residents") |
| `verification_documents` | id, profile_id, doc_type (`cnic_front`, `cnic_back`, `utility_bill`, `police_cert`, `profile_photo`, `voice_intro`), storage_path, uploaded_at |
| `verification_decisions` | id, profile_id, decision, reason (shown to the user), checklist (jsonb), decided_by, decided_at |

### Catalogue and settings (admin-editable)
`categories` (id, name, subtitle, active, sort), `service_areas` (phase 1 to 8, active), `app_settings` (key/value: `helpline_number` (empty until DHA confirms), `helpline_enabled` = false, `report_window_days` = 7, `review_window_days` = 7, `top_rated_min_jobs` = 10, `top_rated_min_rating` = 4.5, `stuck_scheduled_hours` = 24, `stuck_in_progress_hours` = 48, `stuck_cash_hours` = 48, `job_expiry_hours` = 24). Categories are rows, not an enum, because staff add them in Settings.

### Jobs and quotes
| Table | Fields |
| --- | --- |
| `jobs` | id, code (`DW-2043`, from a sequence), resident_id, category_id, address_id, phase, lane (workers see these before acceptance), title, description (max 1000), urgency (`asap`, `scheduled`), preferred_date, window_from, window_to, voice_note_path, status, accepted_quote_id, accepted_worker_id, scheduled_start, scheduled_end, started_at, completed_at, stuck_since, stuck_reason, under_review_reason, cancelled_by, cancel_reason, created_at, updated_at |
| `job_private` | job_id, plot_no, floor, resident_phone. Readable only by the owner, the accepted worker and staff. Nothing here is visible before a quote is accepted. |
| `job_photos` | job_id, storage_path, sort (max 6) |
| `job_views` | job_id, worker_id (unique) for "4 workers viewed" |
| `job_interests` | job_id, worker_id, created_at, withdrawn_at. Unique per job + worker |
| `quotes` | id, job_id, worker_id, labour, materials, materials_note, other_amount, other_note (required when other > 0), total (computed), visit_start, visit_end (day + 2-hour window), note, status (`sent`, `accepted`, `rejected`, `not_selected`, `withdrawn`, `superseded`, `revision_pending`), reject_reason, revision_of, revision_no. **A sent quote is immutable**; changes are new rows. Partial unique index: one `sent` quote per job + worker. |
| `job_events` | id, job_id, event_type, actor_id, payload, created_at (drives the timeline) |
| `cash_records` | job_id (unique), agreed_amount (accepted quote total), worker_amount, worker_reason, worker_recorded_at, resident_amount, resident_confirmed_at, matched, quote_difference (final amount minus agreed). Each side's amount is write-once. |

### Reviews, reports, notifications
| Table | Fields |
| --- | --- |
| `reviews` | job_id (unique), resident_id, worker_id, behaviour, completeness, quality (1 to 5 each), hire_again, comment. **Anonymous to the worker**: workers get no read access, only the aggregate on `worker_details`. |
| `reports` | id, code (`RP-0412`), job_id, reporter_id, against_id, reporter_role, kind (`unsafe`, `cash_price`, `no_show`, `poor_work`, `rude_damage`, `other`), reason_text, status (`new`, `in_review`, `resolved`), assigned_to, action (`no_action`, `warning`, `suspend`), action_reason, created_at |
| `report_photos`, `report_notes`, `report_calls` | evidence, staff notes, call tracking for unsafe cases (who was called, when, outcome) |
| `notifications` | id, user_id, type, job_id, payload, read_at, created_at |
| `device_tokens` | user_id, push_token, platform |
| `cancellation_requests` | id, job_id, requester_id, reason, status (`pending`, `approved`, `declined`), decided_by, decided_at, decision_note (after acceptance; staff decide) |
| `audit_log` | actor, action, table_name, record_id, old, new, reason, created_at. Append only. |
| `staff_invites` | email, invited_by, status (admin phase) |

Report kind mapping from the two apps: customer reasons (unsafe, worker did not show, incomplete or poor, asked more cash, rude or damage) and worker reasons (customer rude, felt unsafe, not at home, refused to pay, other) both map onto the `kind` values above; the raw choice is kept in `reason_text`.

## 4. Mobile API contract

Reads are RLS-filtered queries; writes are RPCs. Names are proposals.

### Shared
| API | Type | Used by |
| --- | --- | --- |
| Sign in and sign out | Supabase Auth: worker uses phone + WhatsApp OTP (`signInWithOtp({ channel: 'whatsapp' })`, then `verifyOtp({ type: 'sms' })`); C01 email/Google is planned, not built | C01, W01 |
| `register_profile(role, fields)` | RPC | C02, W02 |
| `get_my_profile`, `update_my_profile` | read / RPC | C17, W16 |
| `upload_verification_document(type)` | Storage signed upload + insert | C03, W03 |
| `submit_for_review()` | RPC; sets `pending` | C03, W03b |
| `list_notifications`, `mark_notifications_read` | read / RPC | C16, W15 |
| `register_device_token` | RPC | both |
| `get_app_settings` (helpline, report window, categories, phases) | read | both |
| `file_report(job_id, kind, text, photos)` | RPC | C14, W14 |
| `get_job_timeline(job_id)` | read of `job_events` | C13, W12 |

### Resident (customer app)
| API | Type | Screens |
| --- | --- | --- |
| `list_categories_with_nearby_counts` ("412 pros nearby") | read / view | C05 |
| `save_job_draft`, `post_job`, `update_job` (open only), `cancel_job` | RPC | C10, C11 |
| `list_my_jobs(filter: active/completed/all)` with stage, quote count, lowest quote, viewed count | view | C05, C11 |
| `list_quotes(job_id)` with worker name, rating, jobs done, years, price, start slot; sort lowest / top rated / soonest | view | C19 |
| `get_quote(quote_id)` breakdown | read | C12 |
| `accept_quote`, `reject_quote(reason)` | RPC | C12 |
| `revise_quote(quote_id, labour, materials, materials_note, note, visit_start, visit_end)` | RPC (worker, once per quote while `sent`; 0044) | W10 change mode |
| `confirm_cash_resident(job_id, same_or_amount)` | RPC | C20 |
| `submit_review` | RPC | C15 |
| `list_addresses`, `upsert_address` | read / RPC | C03, C10, C17 |

### Worker (worker app)
| API | Type | Screens |
| --- | --- | --- |
| `set_my_areas(phases)`, `set_my_categories`, `set_available_today` | RPC | W05, W16 |
| `list_open_jobs(sort: newest/urgent)` matching category + phase, excluding mine | view | W06, W07 |
| `get_job_for_worker(job_id)` photos, description, voice note, interested count | read | W08 |
| `express_interest`, `withdraw_interest` | RPC | W08 |
| `submit_quote(...)` , `withdraw_quote` | RPC | W10 |
| `list_my_jobs(filter)` and today's jobs | view | W06, W11 |
| `start_job`, `complete_job` | RPC | W12 |
| `record_cash_worker(amount, reason)` | RPC | W13 |
| `get_my_earnings(week)` ("Rs 38,500 cash this week"), own average rating and jobs done | view | W16 |

### Cancellation requests (both apps, after acceptance)
| API | Type | Used by |
| --- | --- | --- |
| `request_cancellation(job_id, reason_code, details)` | RPC | new screens C22 and W18 |
| `withdraw_cancellation_request(request_id)` | RPC | C22, W18 |
| `get_cancellation_request(job_id)` and the derived `cancellation_pending` flag on job reads | read | job status screens |

Out of the first API cut: quote revisions (MVP 2), direct booking (C06 to C09, W09), chat, saved workers, helpline log, dashboards, review list screens.

## 5. Row-level security summary

| Data | Resident | Worker | Admin |
| --- | --- | --- | --- |
| own profile | read, limited update (no role/status columns) | same | all |
| `jobs` | own jobs | open/interested/quoted jobs matching their category + phase while approved and active; jobs they have interest in or won | all |
| `job_private` | own | only the accepted worker, after acceptance | all |
| `quotes` | quotes on own jobs | own quotes only (never competitors') | all |
| `job_interests` | counts only via view | own | all |
| `reviews` | write once for own cash-collected job; read own | **no access** (aggregate only) | all |
| `reports` | own | own | all |
| `verification_documents`, identity bucket | own upload, no read-back after submit | same | read |
| `audit_log` | none | none | read; nobody can update or delete |

Unapproved or suspended users can read their own profile and status but cannot post, quote, accept or see the feed. Approval status checks live in RLS helper functions, not in the apps.

## 6. Storage (private buckets, signed URLs only)

`identity` (CNIC, utility bill, police certificate), `job-media` (photos, voice note), `worker-media` (profile photo, voice intro), `report-media`. Path prefix is the owner's user id so policies can check ownership. Free tier gives about 1 GB, so apps must compress images before upload and limit voice clips (job voice note and worker intro are 14 to 30 seconds in the designs).

## 7. Background jobs and notifications

- DB triggers write `notifications` rows for: new matching job, quote received, quote accepted, quote not selected, scheduled reminder, cash recorded, rating reminder, account verified, report received. An Edge Function sends push via Expo (still the only Edge Function for the mobile phase).
- `pg_cron`: expire jobs not accepted within 24 hours (hourly sweep, reminder at 20h), flag stuck jobs (see section 9, item 15), send rating reminders. Drafts are not purged. Both are available on the free tier.
- Unsafe reports trigger an immediate staff alert row now; the admin UI shows it later.

## 8. Free-tier constraints that shape the build

- Only two free projects: use **local Supabase (Docker)** for development and one hosted project as the shared environment. Prod needs the upgrade.
- Free projects pause after inactivity and have no point-in-time backups. **We create our own backups (decided 27 Oct):** daily `pg_dump` plus a copy of the storage buckets, encrypted, kept outside Supabase, with a tested restore. Do not hold real resident or CNIC data until the first restore has been tested.
- Built-in auth email is heavily rate limited: use a custom SMTP provider before inviting testers to the resident/admin apps (Google sign-in avoids it). The worker app no longer sends auth email; production worker auth uses Twilio or Twilio Verify with a WhatsApp sender, not an ordinary SMS gateway.
- Migrations only through `supabase/migrations`; seed data (categories, phases, settings) in `supabase/seed.sql`.
- Test with pgTAP: each transition, the accept-quote race (two concurrent accepts), cash match/mismatch, and every RLS row above.

## 9. Mismatches and questions for Shariq (also in OPEN-QUESTIONS.md)

1. ~~Worker category: one or many?~~ **Decided 26 Oct (Shariq): several.** `worker_categories` join table stays; the worker profile and admin Settings screens must be changed from "one category" to multi-select, and a worker sees jobs in any of their categories.
2. ~~Distance filter~~ **Decided 26 Oct: out of the MVP.** Matching stays category + DHA phase, no GPS. The W07 "how far will you travel" sheet, km labels and "Nearest" sort are removed from the app build; the feed sorts by newest and urgent first.
3. ~~Job expiry~~ **Decided 26 Oct: open jobs expire after 24 hours** from posting; residents can repost with one tap (copies the job); accepted jobs never expire. Implementation: an unaccepted job becomes `expired` (side state), its live quotes become `expired`, workers are notified, resident reminded at 20h; hourly pg_cron sweep.
4. **Quotes after a rejection: no re-quote** (decided by user 26 Oct; mention to Shariq since the design copy differs). A worker whose quote was rejected cannot quote the same job again; other workers still can. `submit_quote` refuses when that worker already has a `rejected` quote on the job. This differs from the design: C12 says "If you reject it, he can send a new quote" and the reject sheet says "This helps Usman send a better quote"; that copy must change. Revisions are a separate rule, see 14 below.
5. ~~Phone and address visibility~~ **Confirmed by Shariq 26 Oct (11:33 PM):** the resident's phone and full address (house number, floor) are shown **only after the resident accepts a worker's quote**, to protect privacy and discourage deals outside the platform. Before acceptance workers see only phase and lane. This **replaces** my earlier call-first choice. Consequences: no `get_job_contact`; workers quote without calling first, so the quote's scope note and visit window must carry the detail; the resident also sees a worker's phone only after accepting. Design copy to change: W06/W07 "Call, then quote", the Call buttons before acceptance, and C12 "Usman set this price after talking to you".
6. ~~`accepted` vs `scheduled`~~ **Decided 26 Oct: yes**, accepting a quote goes straight to `scheduled` (the quote carries the visit window). `accepted` stays in the enum, unused for now.
7. ~~Draft jobs~~ **Decided 26 Oct (user): yes.** `draft` is a status before `open`. Residents can create, edit and delete their own drafts; drafts are invisible to workers (RLS), send no notifications, and do not expire. Posting (`post_job`) validates required fields and moves the draft to `open`, which starts the 24-hour clock. Adds `delete_draft` to the resident APIs.
8. ~~Reports window~~ **Decided 26 Oct (user):** `file_report` is allowed only to the job's resident or accepted worker, from `scheduled` through `report_window_days` (setting, default 7) after `completed_at`. Not before scheduled. After the window, new reports are blocked but staff can still review, update and resolve existing ones. The window is read from `app_settings`, so staff can change it in admin Settings.
9. ~~Voice recordings~~ **Decided 26 Oct (Shariq): in the MVP.** Both the job voice note (resident) and the worker voice intro are built. Needs `voice_note_path` and `voice_intro_path` (already in the schema), a `worker-media`/`job-media` upload limit (about 30 s, compressed), and storage budgeting on the free tier.
10. ~~Category list~~ **Decided 26 Oct (user):** one list everywhere, seeded in `supabase/seed.sql` and managed in the `categories` table (admins enable/disable, never hardcoded in apps): Plumbing, Electrical, AC & Refrigeration, Carpentry, Painting, Cleaning, Welding & Ironwork, General Handyman. Design changes needed: customer Home (add Welding & Ironwork and General Handyman; the "Others" tile is replaced by General Handyman), worker onboarding and profile category pickers, admin Settings (add Cleaning and the two new ones).
11. ~~Chat~~ **Decided 26 Oct (user): out of the MVP.** Workers and residents talk by phone; no `messages` table, no chat bucket, no chat Realtime channels. Phone numbers are revealed per the visibility rule (item 5).
12. ~~Cash rules~~ **Decided 26 Oct (user):** resident and worker each enter the amount paid, in either order. Equal amounts close the job (`cash_collected`) even if different from the accepted quote; the difference is stored in `cash_records.quote_difference` (and an event is logged) so staff can see it. Different amounts set `disputed` and create a `cash_price` report; the job never closes automatically. **Entries are immutable after submission** (no UPDATE policy; corrections only through staff dispute resolution, built in the admin phase). Stored for audit: accepted quote, both amounts, both timestamps. Matching entries show both parties agree on the reported payment; they do not prove the payment happened.
14. **Quote revisions are MVP 2, not MVP 1 (Shariq, 26 Oct).** MVP 1 has no revision RPCs, no `revision_pending` status and no revision screens; a sent quote is final. If the price changes on the day, the worker records the different cash amount with a reason and the resident approves or disputes it (existing W13/C20 flow). The rules below are kept for MVP 2 and are the plan then: max 2 per job; allowed before work starts; allowed after start only for unexpected additional work with an explanation and updated itemised prices; nothing is final until the resident explicitly approves; every version is kept (`quotes` rows chained by `revision_of`). A rejected revision still counts toward the limit.
13. ~~Report outcomes~~ **Decided 26 Oct (user):** a report is resolved with one of `no_action`, `warning`, `suspend` (against the resident or worker, with a reason). Staff can also **cancel a job** (reason required, notifies both parties) but that is a separate audited admin RPC (`admin_cancel_job`), not a report outcome, though it can reference the report. No refunds: payments are cash and off-platform, so staff only mediate. Suspension timing (temporary or permanent) is a staff policy detail; schema stores `suspended_at`, `suspended_until` (nullable) and reason. All built in the admin phase; mobile apps only see the effects (suspended users are blocked by RLS).

15. **Stuck jobs (decided 26 to 27 Oct, user):** a job is stuck when it stays in one stage longer than allowed with no progress. Scheduled: work not started 24 hours after `scheduled_start`. In progress: not completed 48 hours after `started_at` (the app has no separate progress updates, so the status change is the only progress signal). Completed: cash not recorded by both sides 48 hours after `completed_at`. Open jobs are never stuck (they simply expire after 24 hours). The proposed "accepted, awaiting scheduling, 48 hours" rule does not apply: accepting a quote goes straight to Scheduled with the visit window. Handling: an hourly pg_cron sweep sets `stuck_since` and `stuck_reason` on the job (the status does not change and nothing is cancelled), notifies both parties and staff, and staff investigate and resolve in the admin portal. Jobs already waiting on a response inside the allowed time are not flagged; resolved or progressed jobs clear the flag. The thresholds are settings (`stuck_*_hours`, `job_expiry_hours`), not code. An automated call stays later.

16. **Suspended worker with an active job (proposed default, 27 Oct, user):** suspending a worker immediately blocks new interest, quotes and jobs. Any active job (`scheduled` or `in_progress`) is flagged `under_review_reason = 'worker_suspended'` (status unchanged, nothing cancelled), the resident and staff are notified, and staff decide: resume, replace the worker, or cancel. History, quotes, photos and cash records are kept. Nobody is assumed to owe payment for unfinished work.
17. **Cancellation after acceptance (proposed default, 27 Oct, user; flow refined 27 Oct):** before acceptance the resident cancels directly (`cancel_job`). After acceptance, neither side can cancel unilaterally. Flow: the user opens an accepted, scheduled or in-progress job and taps **Request cancellation**, picks a reason (`schedule_conflict`, `no_longer_needed`, `price_dispute`, `safety_concern`, `worker_unavailable`, `other`) and may add details; `request_cancellation(job_id, reason_code, details)` creates a row in `cancellation_requests` (job, requester, requester_role, reason_code, details, status `pending`, decided_by, decided_at, decision_note). **The request is separate from the job's status:** the job keeps its status (scheduled or in_progress) and a derived flag `cancellation_pending` (exists a pending request) drives the banner "Cancellation requested, under review" in both apps. The other party and staff are notified. Staff decide (`admin_decide_cancellation`, admin phase): approved makes the job `cancelled` (reason, requester and decision recorded), declined leaves it active; both outcomes are written to `job_events` and `audit_log`. One pending request per job; the requester can withdraw it (`withdraw_cancellation_request`) before a decision. For jobs in progress the app must say clearly that the request does not stop the work or settle any payment dispute, and that staff will give instructions where safety is a concern (safety issues should use "I feel unsafe" and the report flow). Staff can also cancel directly (`admin_cancel_job`). Needs new screens in both apps: see UI-UX.md section 8.
18. **Reviews (proposed default, 27 Oct, user):** the resident can review within **7 days after the job is marked completed** (and after cash is collected); `review_window_days` is a setting. **Top rated** = at least **10 completed jobs** and an average of **4.5 or higher** from eligible reviews (`top_rated_min_jobs`, `top_rated_min_rating` settings); always show the review count next to the average. **Workers rating residents is NOT adopted for MVP 1:** it contradicts the earlier decision (resident to worker only, anonymous) and has no screens. Parked for MVP 2 and still to confirm with Shariq.
19. **Document retention: configurable, pending legal review (27 Oct, user).** No fixed period is committed. Retention periods are settings (`retention_*_months` in `app_settings`, unset by default so nothing is auto-deleted until policy is approved). Access to identity documents (CNIC, bill, police certificate) is restricted to the owner and staff. Earlier figures (5 years for job, quote, cash, report and audit records; 1 year for photos and evidence) are only placeholder suggestions for the legal review, not decisions. A documented deletion procedure and account-deletion handling (remove or anonymise where legally allowed, keep records that must be retained) are needed before launch.
20. **Commission: 0% in MVP 1 (decided 27 Oct).** No commission fields, deductions or payment processing. Quotes and cash records already store amounts, so a commission model can be added later by migration.
21. **Helpline 1092: unverified, hidden until DHA confirms (27 Oct, user).** The number must not be published as an official DHA Works helpline until DHA confirms it is correct and authorised for this purpose. `app_settings` holds `helpline_number` (empty until confirmed) and `helpline_enabled` (false). While disabled, the apps hide every Call helpline button and the FAQ lines that mention the number; Report a problem and I feel unsafe still work and alert staff in the portal. Once confirmed, suggested wording: "For assistance with DHA Works, contact the helpline at [number]. For emergencies or immediate danger, contact the appropriate emergency services." Do not promise an immediate response. Draft FAQ answers (need Shariq's approval): workers are reviewed and approved by DHA before they can accept jobs; the full address and phone number are revealed to the worker only after you accept their quote; payment is made directly to the worker in cash; if something goes wrong, report it in the app and DHA staff review it; after accepting a quote you can request cancellation but DHA staff may need to review it; both parties confirm payment in the app and mismatches go to staff.

## 10. Next steps

1. Shariq reviews this doc and answers section 9.
2. Update PRD, USER-FLOWS, ARCHITECTURE, DATA-MODEL, TESTING to match.
3. Write migrations in this order: extensions and enums; identity and verification; catalogue and settings; jobs, interests, quotes; cash, reviews, reports; notifications and audit; RLS; RPCs; seed; pgTAP tests. Review each before the next.

## 11. Changes from Shariq's feedback (27 Oct, applied 28 Oct, migration 0013)

- `jobs.material_bill_path`; `complete_job` requires it when the accepted quote has materials above 0.
- A cash difference no longer disputes the job or files a `cash_price` report; the job closes as `cash_collected`.
- `submit_review` with a mean score below 3 files a system-generated `poor_work` report.
- Drafts are not purged (section 7 updated).

### attach_material_bill (0045, 10 Nov)

`attach_material_bill(p_job_id uuid, p_bill_path text)`: worker only. Files or replaces the bill photo (`job-media`, first folder = the worker's id, the file must exist) on the worker's own sent or accepted quote while the job is interested, quoted, scheduled or in progress and the quote has materials above 0. Records `bill_attached` (resident-visible). `complete_job(p_job_id, p_bill_path default null)` uses the attached bill when no path is given and files a given path on the quote too.

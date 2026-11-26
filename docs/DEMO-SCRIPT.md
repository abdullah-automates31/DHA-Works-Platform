# DHA Works demo: script, seed data and E2E checklist

> **26 Nov 2026 (owner): the 27 Nov demo is NOT a DHA Works demo.** Tomorrow's demo is for another thing and DHA Works stays out of it. Do not prepare this demo; this file is kept as history and for any later DHA Works demo.

Written 21 Nov 2026 for the demo on **Fri 27 Nov**. Three products, one backend: the worker app, the customer (resident) app and the admin portal.
Decisions behind it: the demo needs iPhones, but the Apple Developer account is bought next month, so there is no signed iOS build and **no iOS push** this week (memory: project-demo-week-iphone-plan).

## 1. Who uses what on the day

| Role in the story | Device | How it runs |
|---|---|---|
| Resident (customer) | Android phone A, plus an iPhone if Shariq installs it from Xcode (free Apple ID, 7-day certificate) | Customer app built from Shariq's repo (`main`, or our branch `abdullah/busy-time-rebased` until PR #17 is merged) |
| Worker 1 (free) | moto g05 (Android) | Worker release build (EAS preview APK), no PC needed. Push works here. |
| Worker 2 (busy, has a job in progress) | iPhone | Expo Go against Metro or a published EAS Update. **No push on iPhone.** |
| DHA staff | Laptop, browser | Admin portal on Vercel |

Push is shown on Android only. If something must be shown on the iPhone, say it is "the same screen, Android shows the notification".

## 2. Clean demo data (do not use the shared DEV project as it is)

DEV holds about 66 old jobs, junk titles and Shariq's own test history, so the demo gets its own clean data. Tag everything **[DEMO]**.

**Accounts** (fake names, fake phone numbers on the dashboard test list, no real CNIC or utility bill):
- 2 residents, both **approved**: "Demo Resident Ayesha" (Phase 6, with an address) and "Demo Resident Bilal" (Phase 8).
- 3 workers, **approved**, trades and phases that match the jobs below: Plumber (Phase 6 and 8), Electrician (Phase 6), AC technician (Phase 6 and 7).
- 1 worker left **pending** with documents uploaded, so staff can approve live.
- 1 resident left **pending**, same reason.
- 1 admin (staff) account with a known password and an inbox that receives the emailed code.

**Jobs** (create them the evening before; an open job expires after 24 hours, so make the "open" ones the morning of the demo):
- 3 open jobs in the workers' trades and phases, one **with a visit within 6 hours** (this triggers the busy-worker question) and two on later days.
- 1 completed and reviewed job (so ratings and history are not empty).
- 1 cash-collected job awaiting a review.
- 1 job with an open report, so the staff Reports screen has a case.
- Worker 2 needs one job already **in progress** (that is what makes them "busy").

The accounts are created through the apps (the sign-in code needs the test numbers); the jobs can come from a script (`supabase/dev/hosted_dev_fake_open_jobs.sql` is the model; adapt the title tag to [DEMO]). Staff approvals are done in the portal.

## 3. Story, about 25 minutes

Each step: who, what to do, what must appear, what to say. If a step fails, use the fallback and keep going.

1. **Staff verifies a worker (portal, 3 min).** Open Workers, open the pending worker, show CNIC, police certificate and photo, press Approve. *Say:* every worker is checked by DHA staff before they see a single job. *Fallback:* use the pre-approved worker and show the Approve screen on the pending one without pressing.
2. **Resident posts a job (customer app, 3 min).** Plumbing, photos, a voice note, choose **one visiting time** tomorrow 11:00. *Must appear:* the job as Open, with no worker details. *Say:* the resident picks the time, not the worker.
3. **Worker sees and quotes (worker app, 4 min).** Open jobs: show **Newest / Nearest** and the **Within 3 km** dropdown. Open the job, fill labour and materials, send the quote. *Must appear:* quote sent; the job disappears from other workers' feeds (claim and lock). *Say:* the resident's name, phone and plot stay hidden until they accept.
4. **Busy worker (worker app on the second phone, 4 min).** Worker 2 has a job in progress and quotes a job whose visit is within 6 hours. *Must appear:* the full-screen **Current job time** asking how much longer, with the customer's view of the answer. Enter 90 minutes, send. *Must not appear:* this question for a visit that is more than 6 hours away. *Say:* the customer sees the time and can wait or replace the worker.
5. **Resident decides (customer app, 3 min).** See both quotes (and the busy worker's time if PR #17 is in the build). Accept one. *Must appear:* the job is Scheduled with the worker's contact and a **Call** button. Replace the other worker once, to show the rule.
6. **Work and cash (worker app, 3 min).** Start the job, attach the material bill photo, mark complete, record cash. *Must appear:* statuses Completed then Cash collected; the bill pop-up if no bill was attached.
7. **Rating and report (customer app, 2 min).** Rate the worker with a comment. Then file a report on a different job. *Must appear:* the report shows in My reports.
8. **Staff handles the report (portal, 3 min).** Dashboard, global search for the job code, open the report, resolve it with an outcome (no action, warning or suspend). Show the audit log in Settings. *Say:* staff cannot be bypassed, and every action is logged.
9. **Close (1 min).** Dashboard numbers move: jobs by stage, recent activity with "Show more".

## 4. Day-before and one-hour-before checklist

**Day before**
- [ ] Customer app, worker app and portal all point at the **same** Supabase project (the clean one).
- [ ] All phones charged, on the same Wi-Fi, notifications allowed for both Android apps.
- [ ] Sign-in works for every demo account (code arrives; test numbers still listed on the dashboard).
- [ ] Admin sign-in works and the emailed code arrives within a minute (Brevo).
- [ ] Forgot password sends a code (Turnstile secret was set 21 Nov; **not yet tried**).
- [ ] Open jobs seeded so they are still open on demo day (24-hour expiry), or seed them in the morning.
- [ ] Backup screen recording of the whole story saved on the laptop and on a phone.

**One hour before**
- [ ] Run the whole story once on the real devices.
- [ ] Supabase project is awake (free projects pause when idle).
- [ ] Metro or the EAS Update link works from the iPhone if the iPhone worker is used.
- [ ] Silence other notifications; screen timeout set to 10 minutes.

## 5. Things not to show (known limits)
- iOS push notifications (no Apple account yet).
- A free worker who quotes and then becomes busy is not asked for an estimate.
- The busy estimate is the worker's own word, not checked.
- Distances are estimates to the middle of each DHA phase (marked with "~").
- Unapproved applicants do not appear in global search.
- Real payments: cash only, recorded by the worker.

## 6. E2E hunt log

Filled in during the E2E hunt (21 Nov onward). Severity: **S1** breaks a demo step, **S2** wrong but a workaround exists, **S3** cosmetic.

| # | Where | What happens | Sev | Status |
|---|---|---|---|---|
| | | | | |

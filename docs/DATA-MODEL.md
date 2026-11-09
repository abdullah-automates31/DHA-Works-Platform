# Data Model

Postgres on Supabase. Every table has Row Level Security enabled ([SECURITY.md](SECURITY.md)). Types are generated into `packages/supabase`.

**The full table list with fields, status values, RPCs and the RLS matrix is in [DB-API-DESIGN.md](DB-API-DESIGN.md) (section 3 onward).** That document is the source of truth; this page is the summary. The earlier claim-lock model (`worker_id` on a claimed job, `discussion_deadline`, `messages`, direct-booking columns) is gone.

## Groups

| Group | Tables |
| --- | --- |
| Identity and verification | `profiles`, `resident_details`, `addresses`, `worker_details`, `worker_categories`, `worker_areas`, `worker_references`, `verification_documents`, `verification_decisions` |
| Catalogue and settings | `categories`, `service_areas`, `app_settings` |
| Jobs and quotes | `jobs`, `job_private`, `job_photos`, `job_views`, `job_interests`, `quotes`, `job_events`, `cash_records` |
| Reviews and reports | `reviews`, `reports`, `report_photos`, `report_notes`, `report_calls` |
| Platform | `notifications`, `device_tokens`, `audit_log`, `staff_invites` |

## Relationships

```
profiles 1--1 resident_details 1--* addresses
profiles 1--1 worker_details
worker -- worker_categories --> categories     (several trades per worker)
worker -- worker_areas --> phases 1 to 8
profiles(verification) 1--* verification_documents, verification_decisions
resident 1--* jobs 1--* job_photos
jobs 1--1 job_private                          (plot, floor, phone: only after acceptance)
jobs 1--* job_interests, job_views, job_events
jobs 1--* quotes (one live quote per worker per job)
jobs 1--1 accepted quote, 1--1 cash_records, 1--0..1 reviews
jobs 1--* reports 1--* report_photos, report_notes, report_calls
```

## Rules that live in the database

- **Status transitions** only through SQL functions (RPCs) that check role and current status, then write `job_events` and `audit_log` in the same transaction.
- **Accepting a quote** is one transaction on a row-locked job: that quote is accepted, every other sent quote becomes not selected, the job becomes Scheduled. It can happen only once.
- **Quote total** is computed by the database from labour, materials and other. A sent quote is immutable.
- **No re-quote** after a rejection: `submit_quote` refuses a worker who already has a rejected quote on the job.
- **Open jobs expire** 24 hours after posting (hourly pg_cron sweep); accepted jobs never expire.
- **Cash:** worker-only (Shariq, 9 Nov). The worker's amount is write-once; when it is in, the job closes as `cash_collected` and `quote_difference` is stored for staff (`matched = true`; `resident_amount` stays empty for new jobs). A price difference never sets Disputed (Shariq, 27 Oct).
- **Material bill:** `jobs.material_bill_path`, required by `complete_job` when the accepted quote has materials above 0 (assumed rule).
- **Low rating:** `submit_review` below 3 (mean of three scores) files a system `poor_work` report.
- **Reviews:** one per job, only by the job's resident after Cash collected; the worker cannot read them (aggregate rating only).
- **Contact release:** `job_private` (plot, floor, resident phone) is readable only by the owner, the accepted worker and staff.
- **Reports:** allowed only from Scheduled until `report_window_days` after completion.
- **Audit log** has no UPDATE or DELETE policy for anyone.
- Approval status checks (approved, not suspended) live in RLS helper functions, not in the apps.

## Storage buckets (private)

`identity` (CNIC, utility bill, police certificate), `job-media` (photos, voice note), `worker-media` (profile photo, voice introduction), `report-media`. Signed URLs only.

## Open items

- Retention for identity files (pending).
- Rules for a suspended worker's jobs in progress (pending).
- Cancellation rules after acceptance (pending).

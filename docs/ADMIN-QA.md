# Admin portal: QA log for the Saturday 14 Nov 2026 handover

Local stack, real browser, fake `[FAKE]` data only. Updated as each pass is done.

## Thursday 12 Nov: local walkthrough

| Area | Result |
|---|---|
| Sign-in: email + password, then the emailed code (dev-log mode) | Works. |
| All list pages (dashboard, workers, residents, reports, jobs, cancellations, helpline, reviews, users, settings, confirm) | Load, no errors (200). |
| All detail pages (worker, resident, report, job, user), `/accept-invite` | Load, no errors. |
| Worker review: tick checklist, Approve | Works. Banner shown, queue counts update. |
| Document viewer (identity bucket, signed links) | Works when the file exists; a missing file shows "Could not load". Needs real uploads to confirm on hosted DEV. |
| Attack drill (`scripts/challenge-admin-local.mjs`) | 39 of 39 pass: code limits, lock-out, verified-session rules, sign-out. |
| `admin:typecheck`, `admin:lint`, `admin:test` (74), `admin:build` | Pass. |

### Bugs found and fixed

1. **Sign-in was refused right after the password step** ("signed out after 30 minutes without activity"). The activity cookie (`dha_active`) lives 30 days and was not cleared on a normal sign-out or an expired session, so the next sign-in read the old time. Fix: `src/proxy.ts` clears the cookie whenever nobody is signed in (`staleActive` in `src/lib/idle.ts`, with a test).
2. **Attack drill failed two checks** because its fake account reused an id from the operations seed. The drill now uses its own id.

## Still to do (needs the owner, see handover)

- Deploy to Vercel, set env vars (Supabase URL and anon key, Turnstile site key and secret).
- A mail provider key for `admin-2fa` (rotate the exposed Brevo key first); prove a real email arrives.
- First sign-in on hosted DEV with a real admin email; repeat the walkthrough there.
- Confirm documents and voice notes load from real uploads on hosted DEV.

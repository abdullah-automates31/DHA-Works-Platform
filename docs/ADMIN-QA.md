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

## Thursday 12 Nov, late: click-through of the action screens (local, fake data)

| Screen and action | Result |
|---|---|
| Report case: Mark in review (assigns to me) | Works. |
| Report case: Suspend the account (reason required) | Works; case resolved, activity log updated, badge count drops. |
| User page: Reactivate (reason required) | Works; status back to Active. |
| Cancellations: decline with no note | Refused with a clear message. |
| Cancellations: decline with a note | Works; request leaves the waiting list. |
| Helpline log: log a call | Works; list and counts update. |
| Reviews: hide with a reason | Works; marked Hidden, "Hidden 1" filter updates, no longer counts in the average. |
| Settings: add a category | Works; shown at once in the list. |
| Settings: areas tab, helpline tab | Load. |
| Settings: create a staff invite | Works; one-time link shown on screen. |
| Idle logout (30 min) | Fired correctly while I was away. |

### Fixed after the click-through

- **Helpline log table** was wider than its panel (Outcome and "Mark done" cut off): added a compact table style (`.tbl.compact`) and used it for the helpline log and the user page's recent jobs.
- **User page stat card:** text values such as "Suspended" use a smaller size (`.stat b.txt`).
- **Sign-in pages (sign-in, code, accept-invite):** notices and headings sat beside the form instead of above it. `SignInShell` now wraps its content in a column (`.si-col`); the accept-invite heading matches the sign-in heading.

### Also clicked and working

Resident Reject (reason required, button disabled until written); job Replace the worker (job reopens, "No worker yet"); job Cancel (reason required, job closed); send a message to a user; Settings save (time windows; the step-up check passed because the session was 11 min old, under the 15 min limit); accept-invite with a valid token (account created, sent to sign-in with the "account is ready" notice).

### Frontend engineering review (13 Nov)

Checked: code scan of all 51 components, an accessibility pass over 17 routes (page language, titles, headings, labels, button and link names, image alt), console errors on three pages, and the production build.

Fixed:
- **No error page or not-found page:** a crash or a bad link showed the framework default. Added `app/error.tsx` (friendly message, Try again, back to dashboard, short reference, no error details) and `app/not-found.tsx`.
- **Unnamed dropdown:** the "Who did you call?" select (and every select built by `FormKit`) had no accessible name; it now uses its label.
- **Two main headings on the invite page:** the form heading is now a level-2 heading.
- **Keyboard focus and reduced motion:** every link, button and field shows a focus outline; people who ask their system for less motion get none.

Result: language, title, one main heading, no unlabelled fields, no images without alt, no console errors. Typecheck, lint, 74 tests and build pass.

Not verified: layouts narrower than about 1000 px. The portal refuses to be framed (correct security header) and the browser tool cannot resize the viewport, so I could not measure them. The portal is a desktop tool; there are breakpoints at 1240, 1000 and 760 px. Check on a real tablet or a narrow window before launch.

### Independent audit (performance-qa-auditor agent, 13 Nov) and fixes

Verdict: yes with fixes, no critical findings. Production build pages render in about 30 to 90 ms on the local database; no N+1 queries, no `select('*')`, every list is paged. Security checks (headers, nonce CSP, cookies, open redirect, auth on every action, no secrets in the browser) passed.

Fixed (commit `4a720c8` and the form fix below): static assets cached (reload 683 KB to 47 KB), logo 434 KB to 40 KB, unique page titles, badge contrast, Sign out kept on narrow screens, `<main>` landmark and skip link, database trouble shows "try again" instead of "not an admin".

**Forms keep what was typed.** Before: a refused submit, or the trip to the new-code page, left an empty box. Now the shared form (`FormKit`) keeps the text in memory for refusals and in the browser tab (15 minutes) for the new-code trip; the report decision form keeps its choice and reason the same way. Verified in a real browser: duplicate category name refused with the text kept; a stale session sent to the code page and back with both fields restored (settings form and report Suspend form); a successful save clears the form and the draft.

Open, decision needed: approving or rejecting a worker or resident does not ask for a fresh code (`admin_decide_verification`, also hide review, resume job, send message). Approving gives access to residents' details.

Lower priority, not done: every detail-page view writes an audit row (duplicates on reload); no timeout on the portal's own database calls; jobs list search has no trigram index (fine below about 50k jobs).

### Still open

1. **Invite email:** creating an invite does not email the person. The one-time link is shown once on screen and the admin has to send it. Decide with Shariq whether the portal should email it (needs the mail provider).
2. **Cash card on a job with no worker:** after "Replace the worker" or a cancel, the card still shows the old agreed amount. Minor.
3. Not clicked: resident Approve and Visit HQ (same screen as Reject and the worker flow), phase switch, a stale-session step-up prompt in the browser (covered by pgTAP and the 11 Nov browser test).

## Still to do (needs the owner, see handover)

- Deploy to Vercel, set env vars (Supabase URL and anon key, Turnstile site key and secret).
- A mail provider key for `admin-2fa` (rotate the exposed Brevo key first); prove a real email arrives.
- First sign-in on hosted DEV with a real admin email; repeat the walkthrough there.
- Confirm documents and voice notes load from real uploads on hosted DEV.

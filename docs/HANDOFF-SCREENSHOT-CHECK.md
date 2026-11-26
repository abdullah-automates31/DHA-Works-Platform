> **26 Nov UPDATE (Shariq): keep the reader OFF for now; DHA approves dues by hand. A QR payment flow is described in docs/DECISIONS.md 26 Nov as second priority. Do not build a server, a local runner or merge portal PR #1 until the owner says so. Steps C to E below are on hold.**

# HANDOFF: automatic check of dues payment screenshots (written 25 Nov 2026)

Plain-words handoff so any person or any AI tool (for example opencode) can carry on without the earlier chat.
Read this file first, then `CLAUDE.md` (project rules) and `docs/HANDOVER.md` section 0.

----------------------------------------------------------------------------------------------------
## 1. What this feature is (five lines)

- Workers owe DHA a fee after each cash job. They pay it in the worker app (My Dues) and attach a screenshot of the payment.
- We want the backend to READ that screenshot automatically and show the admin: "Screenshot matches", "Needs a closer look",
  "Could not read" or "Not checked yet", with what the worker typed next to what the screenshot shows.
- The ADMIN STILL CLICKS CONFIRM OR REJECT BY HAND. No auto-confirm, no auto-unlock. The badge only shows where to look.
- The reader only READS fixed fields. The DATABASE decides, using fixed rules. Text written inside a picture cannot change a rule.
- If the reader is down or fails, nothing breaks: the payment stays in the normal queue as "Not checked yet".

----------------------------------------------------------------------------------------------------
## 2. RULES THAT MUST NOT BE BROKEN

1. NO THIRD PARTY SERVICE. Shariq (owner of the customer app) said "our own SDK, no 3rd party". The owner repeated it 25 Nov.
   No Claude/Anthropic, no Google (Vision, ML Kit), no hosted OCR API, no AWS/Azure OCR. Nothing that receives an image.
2. Shariq confirmed 25 Nov (WhatsApp): "It's okay to use libraries. Just don't share images outside of our system."
   So an open-source OCR library running INSIDE our own code on OUR OWN server is allowed. PaddleOCR is the choice.
   Download model files once and bundle them into our image so the server never calls out for them.
3. Amount rule (owner): compare three numbers exactly, no tolerance: what the screenshot shows (paid), what the worker typed
   (submitted), and what is owed. Any mismatch is flagged. A part payment is flagged "Less than owed" but the admin can still confirm.
4. NO DOCKER on the developer PC (owner decision 20 Nov). Docker is allowed on a SERVER only. Tests run on the hosted TEST project.
5. Work on the git branch `dev` only. Never push to `main`. Ask the owner before: `supabase db push` to DEV, deploying functions,
   merging anything that deploys (the standalone admin portal deploys to Vercel when its `main` changes).
6. Never print, paste or commit secrets (service-role key, reader secret, passwords). The owner or Shariq sets secrets on the server and in Vault.
7. The repository is PUBLIC. Real payment screenshots show names and account numbers: keep them in `services/screenshot-reader/fixtures/real/`
   (git-ignored), never in git.
8. Do not touch the Relay project or the abandoned ref `qfxpluotmrxmxqseelnh`. Do not use the Supabase MCP connector (wrong account).
9. Do not clean or reseed the shared DEV project without the owner saying so (Shariq tests on it).
10. Commit messages end with: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (keep the line for the Claude sessions).

----------------------------------------------------------------------------------------------------
## 3. WHAT IS DONE (Phase 1 is built and on DEV)

### 3.1 Database: migration 0080 (applied on DEV and on the hosted TEST project)
File: `supabase/migrations/20261124100000_dues_screenshot_check.sql`. Next free migration number: 0081.
- Closed table `public.dues_payment_checks` (verdict, reasons, extracted fields, owed, image SHA-256, engine, checked_at).
  No app role can read it (anon, authenticated and service_role are revoked). Staff see it only through two functions.
- `public.dues_check_context(payment_id)` and `public.dues_check_apply(payment_id, fields, sha, engine)`: only the service role may run them.
  `dues_check_apply` cleans the fields, applies the rules, saves the check, writes an audit row `dues_screenshot_checked`.
- Trigger `dues_payments_screenshot_check` (after a new pending payment with a screenshot) -> `private.post_screenshot_check` calls the
  reader over HTTPS (`net.http_post`). It never raises. The URL and secret come from Vault names `reader_url` and `reader_secret`.
  If those two Vault entries do not exist, the trigger quietly does nothing.
- Retry cron `dw-dues-check-retry` every 5 minutes (payments 2 minutes to 1 hour old with no check, 20 at a time).
- `admin_dues_list` (pending_payments) and `admin_dues_worker` (payments) now also return `check`. The worker's `my_dues` is NOT changed (workers never see the check).
- Reason codes (the rules): amount_mismatch (red), amount_unreadable, amount_less_than_owed, amount_more_than_owed, txn_mismatch (red),
  txn_unreadable, txn_reused (red; same transaction ID or same image hash on another non-rejected payment), receiver_unknown (red) /
  receiver_unreadable / receiver_not_checked (match on last 4 characters of the account number or on name words against `dues_pay_accounts`),
  status_not_success (red) / status_unreadable, date_old (more than 7 days before sending), date_future (red), date_before_due, date_unreadable
  (calendar days, Asia/Karachi), method_mismatch, nothing_readable.
  Verdicts: matches / flagged / unreadable.
- pgTAP test: `supabase/tests/dues_screenshot_check.test.sql`. All 51 pgTAP files pass on the hosted TEST project.

### 3.2 Admin portal (Next.js 16)
Files in `apps/admin/src/features/dues/`: `screenCheck.ts` (+ `screenCheck.test.ts`), `CheckPanel.tsx`; edits to `parse.ts`, `DuesView.tsx`,
`WorkerDuesPanel.tsx`, `dues.test.ts`. Shows the badge, the reasons in plain words, a table "worker typed vs screenshot shows"
(amount, transaction ID, sent to, status, date, paid with), red "Amount does not match" with both numbers, and a queue filter
(All / Screenshot matches / Needs a closer look). Admin tests: 149 pass; typecheck, lint, build green.
The portal exists in TWO copies kept in step by copying files: the monorepo `apps/admin` and the standalone repo
`C:\Users\Abdullah Ali\DHA-Works-Admin-Portal` (GitHub `abdullah-automates31/Dha-Works---Admin-Portal`, Vercel builds from its `main`).
The standalone copy is on branch `dues-screenshot-check`, commit `cc0c5bb`, PULL REQUEST #1 (NOT MERGED, merging deploys to Vercel).
https://github.com/abdullah-automates31/Dha-Works---Admin-Portal/pull/1
Until that PR is merged the live portal does NOT show the badge.

### 3.3 Reader service (our own SDK) in `services/screenshot-reader/`
- Python 3.11, FastAPI. `POST /check` (header `x-reader-secret`, answers 202 at once, works in the background), `GET /health`.
- `app/pipeline.py` image -> SHA-256 -> shrink -> OCR -> text rows -> parsers. `app/supabase_io.py` the three Supabase calls.
- `app/engines/`: `base.py` (OcrLine, Engine), `paddle.py` (class `PaddleEngine`, handles PaddleOCR 2.x and 3.x answer formats), `stub.py`.
- `app/parsers/common.py` (amount, date, transaction ID, masked account, status) and `extract.py` (label sets per app: JazzCash, Easypaisa,
  SadaPay, NayaPay, banks, Other). THE LABEL SETS ARE STARTER SETS made without real screenshots. They must be tuned.
- Files for the server: `Dockerfile`, `docker-compose.yml`, `Caddyfile` (HTTPS), `.env.example`, `requirements.txt` (pinned),
  `requirements-engine.txt` (paddlepaddle, paddleocr, numpy; NOT pinned yet), `README.md` (run and deploy steps).
- 47 pytest tests pass (no OCR engine needed). CI job `screenshot-reader` in `.github/workflows/ci.yml`.
- THE REAL PADDLEOCR ENGINE HAS NEVER BEEN RUN. THE DOCKERFILE HAS NEVER BEEN BUILT. Nothing is deployed.

### 3.4 Demo seed (not run yet)
`supabase/dev/seed_dues_checks.sql`: for up to 4 pending payments that have a screenshot, it feeds made-up readings through
`dues_check_apply` (one matches, one amount x10, one different transaction ID, one empty) with engine name `demo-seed`.
Run: `supabase db query --linked -f supabase/dev/seed_dues_checks.sql` (from the repo root, DEV is the linked project). Ask the owner first.

### 3.5 Git
Monorepo `dev` commits: `1f58316` (feature), `1ee5ab5` (generated types), `06c222d` (docs status), then today `87f8314` (crest),
`ae19161` (worker Suspended screen buttons), `7569cdc` (Shariq's answer in docs). All pushed.

----------------------------------------------------------------------------------------------------
## 4. STATE OF THE DEV DATABASE RIGHT NOW (25 Nov)

- Migration 0080 is applied on DEV. DHA fee rule is ON for testing: percent 20, minimum Rs 50, due after 5 days.
  (Do not switch it off until the owner says the test passed.)
- The test worker (SYED ABDULLAH ALI, phone ends 4005, id starts ba8426a9) now OWES Rs 160, credit Rs 0, 3 unpaid dues:
  DW-2095 (Rs 60), DW-2094 (Rs 50), DW-2783 (Rs 50). DW-2092 and DW-2719 (Rs 50 each) are paid.
- Today the owner asked why My Dues was empty. Cause: a leftover confirmed Rs 250 payment (22 Nov) whose dues had been deleted directly
  in the database became Rs 90 credit and auto-paid new dues. With the owner's OK (option "clean reset") that Rs 250 payment was set to
  Rejected with reason "DEV cleanup: orphaned test payment" and an audit row `dues_payment_voided_dev_cleanup` was written. Nothing else changed.
- DEV has 0 pending payments. A payment can be at most what is owed (Rs 160), at most 3 pending at once, and needs a screenshot.
- Jobs DW-2088, DW-2090, DW-2091 (busy-worker test jobs) have no fee on purpose: their quotes were made before the fee was switched on.
  A fee is fixed when the quote is created or revised.

----------------------------------------------------------------------------------------------------
## 5. OTHER WORK DONE 25 NOV (worker app, separate from OCR)

- Crest (logo) without the green square: `apps/worker/assets/images/crest.png` made transparent outside the badge (same fix the admin got 18 Nov).
- Suspended screen (`apps/worker/src/components/SuspendedScreen.tsx`): two new outlined buttons.
  "Email Support" opens the mail app to `dhaworks.developments@gmail.com` (subject "Suspended account", phone and amount owed filled in;
  shows the address if there is no mail app). "Back to Home" re-reads the account: if DHA reopened it the worker goes Home, otherwise a note
  says it is still suspended. New `OutlineButton` in `AuthForm.tsx`; `SUPPORT_EMAIL` and `supportMailLink` in `features/dues/rules.ts` (+ test).
  The address is fixed in the app for now; making it a staff-editable setting needs a new migration (0081). 361 worker tests pass.
  Not yet tried on a phone.

----------------------------------------------------------------------------------------------------
## 6. WHAT TO DO NEXT, IN ORDER

### Step A. Merge PR #1 so the live portal shows the badge (needs the owner's yes)
Merging deploys the standalone portal to Vercel. It is safe: the portal works without the reader. After merging, check the Dues page on
https://dhaworks-admin-portal.vercel.app (the badge shows "Not checked yet" until a check exists).

### Step B. Demo for Friday 27 Nov (works without any OCR)
1. The owner sends 3 or 4 small test payments from the worker app (each with a screenshot; total at most Rs 160; for example Rs 50, Rs 50, Rs 60).
2. Run the demo seed (see 3.4). The portal then shows: Screenshot matches, Amount does not match (red, both numbers), different transaction ID, Could not read.
3. Be honest in the demo: the rules and the portal are real; the real picture reading is not running yet.
Shariq asked 25 Nov ("any update on the whole process? can we test?"). Suggested reply: rules and admin screen done and on DEV; reader written but
not running on a server yet; the admin side can be tested now with test payments; the library question is answered.

### Step C. DONE 25 Nov (kept for the record): PaddleOCR on the dev PC with FAKE screenshots
Result: PaddleOCR 3.7.0 + paddlepaddle 3.3.1 work; 5 fakes plus dark, blurred and compressed copies read 100 of 100 fields correctly, about 5 s each (small PP-OCRv6 models, 1200 px, oneDNN off). See services/screenshot-reader/README.md. Venv is `services/screenshot-reader/.venv`; run `tools	ry_ocr.py`. NEXT is Step D (real screenshots) and Step E (server). The text below is the original instruction.
Needs about 1 to 2 GB of downloads. Nothing is sent out. Do it in a throwaway Python venv inside `services/screenshot-reader`:
```
cd services/screenshot-reader
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m pip install -r requirements-engine.txt
```
Then write a small script (a .py file; bash one-liners with apostrophes break in this shell) that:
1. generates a fake payment screenshot with Pillow (a phone-sized image with text such as "Transaction successful", "Rs 50", "Transaction ID 123456789012",
   "To: DHA WORKS", a date) and saves it under `fixtures/synthetic/`;
2. runs `from app.engines.paddle import PaddleEngine; PaddleEngine().read(Image.open(path))` and prints the text rows;
3. runs `from app.pipeline import read_picture; read_picture(bytes, PaddleEngine())` and prints the fields it extracts.
Fix `paddle.py` (the answer format differs between PaddleOCR 2.x and 3.x) and the parsers until amount and transaction ID come out right.
After it works, pin the exact versions in `requirements-engine.txt` (`pip freeze`) and keep them.
Also decide how the model files get bundled into the image (download once, copy in, so the server does not fetch them again).

### Step D. Real accuracy test (needs the owner)
The owner makes 30 to 50 small transfers between own accounts: correct ones, wrong amount, wrong account, old date, repeated ID, edited,
from each app (JazzCash, Easypaisa, SadaPay, NayaPay, bank apps). Save screenshots in `fixtures/real/` (git-ignored). Compare what the reader read
against each picture. Target (to be measured, not promised): amount and transaction ID correct on at least 95% of the right screenshots, and
anything unsure must come out as "could not read", never a wrong value. Tune the label sets in `app/parsers/extract.py`.
Record the results table in `docs/TEST-PLAN.md`.

### Step E. Server (owner or Shariq)
1. Choose a small Linux server (VPS). Not chosen, not priced. PaddleOCR on CPU needs a few GB of memory: measure it. A plain server we control only.
2. A subdomain that points to it (for HTTPS through Caddy; the certificate is from Let's Encrypt and carries no payment data).
3. On the server: `git clone`, `cd services/screenshot-reader`, copy `.env.example` to `.env` and fill it in (service-role key typed on the server only),
   then `docker compose up -d --build`, then `curl https://<name>/health` should answer `{"ok":true,"engine":"paddle"}`.
4. In the Supabase SQL editor of the project (DEV first) store the two Vault entries:
   `select vault.create_secret('https://<name>/check', 'reader_url');` and `select vault.create_secret('<same READER_WEBHOOK_SECRET>', 'reader_secret');`
5. Send a small test payment from the worker app: the badge should appear in the portal within about a minute.
6. Kill the service and send another payment: it must stay in the manual queue as "Not checked yet"; after restart the retry cron picks it up.

### Step F. Docs still not updated
`docs/HANDOVER.md` section 0, `docs/WORKER-APP.md`, `docs/ARCHITECTURE.md`, `docs/ENVIRONMENTS.md`, `docs/SECURITY.md` (screenshots hold payment details).
Optional: one sentence in the worker app `apps/worker/src/i18n/en.ts` (`dues.formHint`) saying the screenshot is read automatically by DHA's own system (owner decides).

### Later ideas (not started)
- Compare payments against DHA's own bank/JazzCash/Easypaisa statement export ("money seen in account"). Stronger than reading a picture, needs no OCR,
  but needs those accounts to allow an export. Open question for the owner.
- Make the support email a staff-editable setting (migration 0081 + Admin Settings field + worker app reads it).
- A refund or reversal of a confirmed dues payment is not built (today an overpayment becomes credit).

----------------------------------------------------------------------------------------------------
## 7. HONEST LIMITS TO KEEP SAYING

- "Screenshot matches" only means the picture looks right and agrees with what was typed. An edited screenshot can still pass, and it does not prove the
  money arrived. The admin keeps the final decision; for large amounts look at the real account.
- Urdu text reads worse than English; amounts and IDs are Latin digits, which helps.
- Each payment app can change its layout and break its labels. The safe fallback is "Could not read" and a person checks.
- PaddleOCR accuracy on Pakistani payment-app screenshots is UNKNOWN until Step D.

----------------------------------------------------------------------------------------------------
## 8. HOW TO RUN THINGS (Windows, Git Bash or PowerShell, repo root `C:\Users\Abdullah Ali\dha-works`)

- Database tests (hosted TEST project, no Docker): `node scripts/test-db-hosted.cjs` (add `--push` to copy new migrations first,
  `--reset --no-tests` to wipe and re-migrate, `--only <name>` for one file).
- Admin: `npm run admin:typecheck`, `npm run admin:lint`, `npm run admin:test`, `npm run admin:build`.
- Worker: `npm run worker:typecheck`, `npm run worker:lint`, `npm run worker:test`.
- Reader: see Step C; tests with `.venv\Scripts\python -m pytest -q` inside `services/screenshot-reader`.
- Read-only question to DEV (DEV is the linked project): write SQL into a file and run `supabase db query --linked -f file.sql`.
  Only the LAST statement in a file returns rows. Wrap a read in `begin read only; ... rollback;` to be safe.
  To see what a worker sees: `select set_config('request.jwt.claims','{"sub":"<worker id>","role":"authenticated"}',true); set local role authenticated; select public.my_dues(50);` inside a read-only transaction.
- After a migration is applied to DEV, regenerate types: `supabase gen types typescript --linked > packages/supabase/database.types.ts`
  (without `--schema`, to keep `graphql_public`), then `npm run types:sync` for the standalone portal copy.
- `supabase db push` to DEV: only when the owner asks in that task.

----------------------------------------------------------------------------------------------------
## 9. GOTCHAS

- In this shell, bash heredocs or one-liners that contain apostrophes fail to parse. Write text to a file with the editor tool, then use it.
- Python is not usable in Git Bash by default: use `py` or a venv path. PowerShell `>` corrupts binary output.
- A Supabase API call refuses `UPDATE`/`DELETE` without a `WHERE` (safeupdate). pgTAP does not catch this.
- The portal has two copies (monorepo and standalone). A portal change goes into both; the standalone `main` deploys on Vercel, so use a branch and a PR there.
- Two Claude sessions have worked on this repo: run `git pull` and read `git log` on `dev` before editing; take the next migration number from the latest file on `dev`.
- The Expo dev server for the worker app: do not restart it without being asked. For the phone use the EAS dev build.
- Windows line-ending warnings from git (LF to CRLF) are harmless.

----------------------------------------------------------------------------------------------------
## 10. PROMPT TO PASTE INTO OPENCODE (or any AI tool)

> Read docs/HANDOFF-SCREENSHOT-CHECK.md and CLAUDE.md in this repository first. Then continue the dues screenshot check.
> Hard rules: no third-party service of any kind (no Claude, Google or hosted OCR; images must never leave our own system); an open-source
> library running on our own server is allowed (Shariq confirmed). No Docker on this PC. Work on branch dev only. Ask me before any
> `supabase db push`, deploy or merge. Never print or commit secrets.
> Step C is already done (PaddleOCR works on fake screenshots; see the README in services/screenshot-reader). Next task: Step D. Put the real
> screenshots I give you in services/screenshot-reader/fixtures/real (git-ignored), write the answer .json for each, run tools/try_ocr.py on them,
> and tune app/parsers/extract.py until amount and transaction ID are right (anything unsure must come out as unknown, never a guess). Add tests.
> Show me the accuracy table before you commit.

----------------------------------------------------------------------------------------------------
## 11. STATUS AT THE END OF 26 NOV 2026 (newest; where this differs from the text above, this wins)

- **Decision:** Shariq: reader OFF, DHA approves dues by hand. The QR and "Verify payment" flow is the P2M integration, later, after DHA is onboarded. Nothing to deploy for the reader now.
- **Steps A to E above are ON HOLD.** Do not merge portal PR #1, set the Vault entries, build a server or write a local runner unless the owner says so.
- **Step C is DONE** (PaddleOCR runs; fake screenshots read 100 percent, about 5 s each). Reader tests are 53, not 47. Pinned: paddlepaddle 3.3.1, paddleocr 3.7.0, numpy 2.3.5; small PP-OCRv6 models, 1200 px, oneDNN off, reads take turns (a lock), downloads refuse files over 5 MB while streaming.
- **A real test happened:** on 25 Nov someone inserted a Rs 50 JazzCash test payment on DEV directly (no `dues_payment_submitted` audit row) and ran the full reader chain once with the service key on this PC; it was flagged correctly (`amount_more_than_owed`, `txn_mismatch`, because the worker owed Rs 0). That payment is still pending in the queue.
- **DEV data now:** the test worker has 5 dues, Rs 260 in total, all paid. The Rs 250 payment of 22 Nov was voided on 25 Nov (owner's OK). To test paying, a new job must be completed (the 20 percent fee, minimum Rs 50, is on).
- **Also done 25 and 26 Nov (not OCR):** worker crest without the green square, Email Support and Back to Home on the Suspended screen, admin "Last payment / Latest screenshot sent" line (monorepo dev; standalone PR #2 not merged). Kilo Code's glass tab bar was reverted at the owner's request (patch kept outside the repository).
- **Everything checked on 26 Nov:** see docs/TEST-PLAN.md "Added 26 Nov". All green.
- **The 27 Nov demo is not DHA Works** (owner): do not prepare a DHA Works demo.
- **Waiting on the owner:** Shariq's first priority; decisions on portal PRs #1 and #2; later, 30 to 50 real screenshots and a server only if the reader is switched on.
- **Other tools:** Kilo Code and opencode also change this repository. Always `git status` and `git diff` first; their scratch scripts are in `C:\Users\Abdullah Ali\kilo-scratch\`.

- **Later on 26 Nov (not OCR, same session):** worker menus and Help, Job reminders kept on Profile, the white-spot fix, the payment detail screen with migration 0081 (on DEV and TEST), the customer app PR #21, and an emulator build of it. The reader is still OFF and nothing about it changed. See docs/HANDOVER.md "Later on 26 Nov" and CLAUDE.md.

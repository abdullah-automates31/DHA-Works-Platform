# DHA screenshot reader

DHA's own service (no third party) that reads the payment screenshot a worker attaches in **My Dues**, on our own server. It only
**reads**: it hands fixed fields (app, amount, transaction ID, date, receiver, status) to the database, and the database function
`dues_check_apply` (migration 0080) applies the rules and stores a badge for staff. Staff still confirm or reject every payment by hand.

> Status (25 Nov 2026): **nothing is deployed**, but the real OCR engine (PaddleOCR 3.7.0 on paddlepaddle 3.3.1, CPU) HAS been run on a Windows PC
> against FAKE screenshots: 5 made-up screens in dark mode, blurred and heavily compressed too, 100 of 100 checked fields read correctly, about
> 5 s per picture with the small PP-OCRv6 models at 1200 px. This only proves the engine and the plumbing work. Accuracy on REAL screenshots from
> the real apps is still unknown and is measured only by the sample-screenshot run below. The Docker image has not been built yet.
> Facts found on the way: oneDNN must stay OFF on Windows (Paddle 3.x crashes with it); the "medium" models take about 30 s a picture and read
> the same text as the "small" ones (switch with `READER_OCR_SIZE=medium`); dates and times were once read as account numbers (fixed, tested).

```
worker sends payment  ->  trigger on dues_payments  ->  net.http_post  ->  POST /check {payment_id}   (this service, x-reader-secret)
                                                                              |  202 at once, then in the background:
                                                                              |  dues_check_context -> download from private bucket dues-proof
                                                                              |  SHA-256 -> shrink -> OCR (PaddleOCR) -> rows -> parsers
                                                                              v
                                              dues_check_apply(payment, fields, sha, engine)  ->  rules  ->  badge in the admin portal
```

If this service is down, slow or wrong, nothing breaks: the payment stays in the normal manual queue ("Not checked yet") and a cron job
(`dw-dues-check-retry`, every 5 minutes, for an hour) asks again.

## Layout
- `app/main.py` the API (`POST /check`, `GET /health`); `app/pipeline.py` image to fields; `app/supabase_io.py` the three Supabase calls
- `app/engines/` the reader interface (`base.py`), PaddleOCR (`paddle.py`), a stub (`stub.py`). Swap the engine here without touching anything else.
- `app/parsers/` `common.py` (amount, date, ID, masked account, status) and `extract.py` (labels per app: **starter sets, tune on real screenshots**)
- `tests/` pytest on text rows, fake pictures and a fake Supabase: no OCR engine needed
- `fixtures/synthetic/` generated mock-ups only. **Real screenshots never go in git** (the repository is public and they show names and account numbers): keep them in `fixtures/real/`, which is git-ignored.

## Run the tests (any computer, no OCR needed)
```
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m pytest -q
```

## Try the real OCR engine on this PC (no Docker; the engine is installed only in the git-ignored `.venv`)
```
.venv\Scripts\python -m pip install -r requirements-engine.txt      # about 1 GB; models (about 100 MB) download on the first run into ~/.paddlex
.venv\Scripts\python tools\make_fake_screens.py                      # makes 5 FAKE screens + the answers in fixtures\synthetic
.venv\Scripts\python tools\try_ocr.py [folder] [--rows]              # reads each picture, compares with its .json, prints ok / FAIL
```
Put real screenshots (and a `.json` with the right answers next to each) in `fixtures\real\` (git-ignored) and run `tools\try_ocr.py fixtures\real`.
Or run `tools\step_d_accuracy_test.py`: it reads each real screenshot, asks you to type the true values from the receipt, and writes
`accuracy_report.csv` and `accuracy_summary.txt` (both git-ignored; they hold what was read from real screenshots).
The pictures stay on this computer. Only the model files are downloaded, once.

## Put it on a server (the owner or Shariq does this; Docker is used on the server only, never on the developer PC)
1. A small Linux server (to be chosen; PaddleOCR on CPU needs a few GB of memory, **measure it**) and a name that points at it (a subdomain).
2. `git clone` the repository, `cd services/screenshot-reader`, copy `.env.example` to `.env`, fill it in (the service-role key is typed on the server only).
3. `docker compose up -d --build`, then `curl https://<your name>/health` should answer `{"ok":true,"engine":"paddle"}`.
4. In each Supabase project (DEV first) store where the database should call, in Vault (SQL editor):
   ```sql
   select vault.create_secret('https://<your name>/check', 'reader_url');
   select vault.create_secret('<the same READER_WEBHOOK_SECRET>', 'reader_secret');
   ```
   Without these two the trigger does nothing and the manual queue works as before.
5. Send a small test payment from the worker app and watch the badge appear in the portal.

## Accuracy gate (before it is trusted)
The owner makes 30 to 50 small transfers between own accounts: right ones, wrong amount, wrong account, old date, repeated ID, edited, from each app
(JazzCash, Easypaisa, SadaPay, NayaPay, bank apps). For each, compare what the service read with the picture. The target (to be measured, not promised):
amount and transaction ID correct on at least 95% of the right screenshots, and anything unsure must come out as "could not read", never a wrong value.
Tune `app/parsers/extract.py` (labels per app) until it holds, and record the table in `docs/TEST-PLAN.md`.

## Limits to remember
- A matching badge means the picture looks right and agrees with what was typed. An edited screenshot can still pass, and it does not prove the money arrived.
- Urdu text reads worse than English; amounts and IDs are Latin digits, which helps.
- Each app's layout can change and break its labels: the fallback is "could not read", and a person checks it.

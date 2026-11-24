# DHA screenshot reader

DHA's own service (no third party) that reads the payment screenshot a worker attaches in **My Dues**, on our own server. It only
**reads**: it hands fixed fields (app, amount, transaction ID, date, receiver, status) to the database, and the database function
`dues_check_apply` (migration 0080) applies the rules and stores a badge for staff. Staff still confirm or reject every payment by hand.

> Status (24 Nov 2026): the code and its tests are written; **nothing is deployed and the real OCR engine has never been run**. The
> parsers are checked on made-up rows of text. Real accuracy is measured only by the sample-screenshot run below.

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

# send-push (FCM push dispatcher)

Status: **deployed on DEV** (7 Nov 2026). Replaces the earlier Expo dispatcher (in git history before this
change): both apps register raw FCM tokens, so one sender serves the customer app (Kotlin Multiplatform, separate
repo) and the worker app (Expo, `expo-notifications` `getDevicePushTokenAsync`). Decisions: `docs/DECISIONS.md`
(7 Nov, push notifications).

## How it is called

```
RPC → insert public.notifications rows
  → AFTER INSERT statement trigger notifications_push (migration 20261107100229)
     → private.post_push(ids): pg_net POST {"ids": [...]} with header x-push-secret
        → send-push
pg_cron dw-push-retry (every 10 min): rows still unclaimed 2 to 60 minutes after creation are posted again.
```

- The secret lives only in Vault (`push_webhook_secret`, next to `push_function_url`). The function checks the
  header through `public.push_webhook_secret_matches` (service role only, migration 20261107100423).
  `verify_jwt = false` in `config.toml` because the caller is the database, not a user.
- Without the Vault entries `post_push` does nothing, and it never raises: a push problem cannot undo a job action.

## What it does

1. Claims the rows (`push_sent_at = now() where push_sent_at is null`), so a row is pushed at most once even when
   the trigger and the retry overlap.
2. Reads the recipients (role, account status), the jobs (title, accepted worker), the quotes (worker, total) and
   the recipients' tokens. If any read fails, the claim is released and the retry tries again.
3. Writes the text from `templates.ts` by type and recipient role. Customers see the worker's name and the quote
   amount; workers see the job title only. Resident name, phone, plot and address are never read.
4. Sends each message through FCM HTTP v1 (`fcm.ts`, service account OAuth). Data: `type`, `job_id`,
   `notification_id`; Android channel `job_updates`.
5. Deletes tokens FCM reports as dead (`UNREGISTERED`, invalid, `SENDER_ID_MISMATCH`). Expo-format tokens are
   skipped, never deleted. Suspended accounts get no push. If every send for a row failed transiently (429/5xx),
   the claim is released for the retry.

Logs and responses hold counts only: no tokens, user ids, names or text.

## Secrets

- Edge Function secret `FIREBASE_SERVICE_ACCOUNT`: the Firebase service account JSON key (Firebase → Project
  settings → Service accounts). Never committed.
- Vault: `push_function_url`, `push_webhook_secret` (create per project with `vault.create_secret`).
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase.

## Database privileges

`service_role` gets exactly the columns used: 0014 (notifications push columns, `push_sent_at` update,
`device_tokens` read/delete, `profiles.id/account_status`) plus 20261107103106 (`profiles.role/full_name`,
`jobs.id/title/accepted_worker_id`, `quotes.id/worker_id/total`). Pinned by
`supabase/tests/service_role_grants.test.sql`.

## Tests

- `deno test` here: the push wording (`templates_test.ts`).
- pgTAP: `notifications_privacy.test.sql` (tokens, `unregister_device_token`, the secret check is not callable by
  app users) and `service_role_grants.test.sql`.
- Not automated: a real push to a phone (needs a development build of an app and the Firebase key).

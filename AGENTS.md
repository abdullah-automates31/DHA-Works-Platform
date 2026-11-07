# AGENTS.md

DHA Works is a home-services marketplace for DHA Karachi. Backend first: Supabase/Postgres (RLS + RPCs). Two apps exist: `apps/worker` (Expo SDK 58; screens W01-W08 and W10-W18) and `apps/admin` (Next.js 16; screens A01-A15). There is no customer app; do not scaffold it without approval. UI reference: `C:\Users\Abdullah Ali\DHA-Works-UI\` (`SPEC.md` + screenshots; ignore `.dc.html`).

`docs/` is the source of truth. Read `docs/HANDOVER.md`, `docs/WORKER-APP.md` and `docs/ADMIN-PORTAL.md` first; `docs/DECISIONS.md` wins conflicts and `docs/DB-API-DESIGN.md` is the DB/API spec. README and HANDOVER status sections are partly stale: `supabase migration list --linked` and actual test output win.

## State and layout

- Minimal npm workspace at the root (`npm install`); npm only, no pnpm/Turborepo/CI. `apps/worker`, `apps/admin`, `packages/supabase`. `packages/shared` and `ui-native` are planned, not created.
- `packages/supabase/database.types.ts` is generated (`supabase gen types typescript --local`/`--linked`); regenerate after schema changes, never hand-edit.
- 40 migrations in `supabase/migrations` (timestamp names `2026...`, numbered 0001-0017 and 0020-0042); all applied locally and on linked DEV (`xiozwoocisesgmegewww`). 0018/0019 are unapplied proposals in `supabase/proposals/`; do not move them.
- `supabase/dev/` is LOCAL-ONLY, except `hosted_dev_fake_open_jobs.sql` (DEV dashboard SQL Editor only; adds `[FAKE]` jobs, never users/auth). Never run the other seed/approve scripts on a hosted project. There is no `seed.sql`; pgTAP expects an empty database.
- Edge Functions: `send-push` (FCM push for both apps, deployed on DEV 7 Nov; see its README) is called by the database (notifications insert trigger + 10-minute retry cron, migration 20261107100229) and gated by `x-push-secret` checked against Vault, with `verify_jwt = false` on purpose, so do not "harden" it. `admin-2fa` is deployed on DEV with `verify_jwt = true`; it sends via Brevo (`ADMIN_MAIL_API_KEY`, `ADMIN_MAIL_FROM`; the key is a v3 API key, not SMTP). Local `ADMIN_MAIL_MODE=dev-log` prints the code and is refused for hosted addresses.
- Realtime is published only for `public.notifications` (0020). Worker screens refresh on a notification (`apps/worker/src/features/live/useLiveRefresh.ts`); do not publish job tables.
- Local stack: project id `dha-works`; API 55321, DB 55322, Studio 55323, Mailpit 55324.

## Commands (Windows + Docker Desktop)

```powershell
npm run db:local -- start | stop | status
npm run db:local -- db reset          # applies all migrations
npm run db:local -- test db           # 31 pgTAP files, 1228 assertions
npm run db:local -- test db supabase/tests/claim_job.test.sql   # one file
npm run db:local -- db lint --local
npm run safety:supabase               # config guard
npm run safety:test                   # 31 tests
npm run safety:prod-ready             # 4 blockers; ADMIN_2FA_EMAIL etc.
```

- Use `npm run db:local --` for local Supabase commands. It copies `supabase/` to git-ignored `.supabase-local/` and adds the five static test OTPs; plain `supabase start` has no test OTPs. The wrapper blocks `--linked`, `--project-ref`, `--db-url`, `--workdir`; use the plain CLI for hosted read-only checks.
- Worker (`apps/worker`): `npm run worker:typecheck`, `worker:lint`, `worker:test` (225 node:test tests); bundle check `npx expo export --platform ios` (or android) from `apps/worker`.
- Admin (`apps/admin`): `npm run admin:typecheck`, `admin:lint`, `admin:test` (53), `admin:build`.
- Functions: in `send-push`, `deno test` (4), `deno lint` and `deno fmt --check`; in `admin-2fa`, `deno test` (15) and `deno lint`.
- Single app test: `node --test apps/worker/src/features/quote/rules.test.ts` (same pattern for admin).
- `.sh` scripts need Git Bash: `& "C:\Program Files\Git\bin\bash.exe" <script>`. Concurrency: `supabase/tests/concurrency/{accept,claim,register}_race.sh` against local only, then `db reset`. Proposal tests: `supabase/proposals/run_proposal_test.sh`.
- Worker local run: `apps/worker/.env` (gitignored) points at the PC's LAN IP and local anon key; the user runs `npx expo start --lan` in their own PowerShell and tests in Expo Go on iPhone (Android untested on device). Local test numbers use fixed OTPs and send nothing.
- Admin local run: start the stack, seed with `supabase/dev/seed_local_admin.sql` and `seed_local_operations.sql` (plus `confirm_cash_as_resident.sql` where needed), serve `admin-2fa` with `ADMIN_MAIL_MODE=dev-log`, set `apps/admin/.env.local`, then `npm run admin` (localhost:3000). Details in `docs/ADMIN-PORTAL.md`.
- Hosted: the linked project is DEV. Run `db push` only when the user explicitly asks in the current task, after checking branch `dev`, ref `xiozwoocisesgmegewww`, and that `db push --dry-run` lists only expected migrations. Never push `main`; no production project exists. Never deploy functions or set secrets unless asked.
- Hosted config only via `npm run supabase:config-push -- <dev|production>` (check-only without `--run`; CLI 2.109.1 pinned). Never run raw `supabase config push`. On DEV, auth providers and rate limits are managed in the Dashboard, not by config push (the shared config has Twilio off).
- Tooling: use the Write tool for scratch files; PowerShell quoting and heredocs are fragile here.

## Hard rules

- Business rules live in the database: state-machine RPCs, RLS, server-computed quote totals. Apps call RPCs; never reimplement transitions or totals client-side.
- Schema changes are new files only; never edit an applied migration or hand-edit a local/hosted DB. Apply locally with `db reset`; push to DEV only as above.
- Claim-and-lock is current (0031): a worker accepts with a price via `accept_job`, which quotes, schedules, locks the job and sets the cash amount in one transaction; a second worker is refused. `replace_worker` reopens the job and excludes the old worker (no re-quote; revisions are MVP 2). The old `express_interest`/`submit_quote`/`accept_quote` RPCs remain only for the future customer app; the competition model is superseded.
- Cash entries are write-once; a mismatch still closes `cash_collected` with `matched=false`; a rating below 3 files a `poor_work` report. A material bill is required at `complete_job` when the accepted quote has materials > 0; a filed bill cannot be deleted by the worker. The customer controls the schedule; rejected/cancelled jobs are hidden from workers. Worker-only cash is pending Shariq.
- Privacy: before acceptance never expose resident name, phone, plot or address (not in notifications). Push text: workers see the job title only; customers also see the worker's name and the quote amount (Shariq, 7 Nov). Wording is in `supabase/functions/send-push/templates.ts`. Helpline/FAQ stay hidden until `app_settings.helpline_enabled`. Do not put real CNIC/resident data anywhere until a backup/restore is tested (free tier has no PITR).
- Worker auth: phone + WhatsApp OTP; email login removed (`profiles.email` stays nullable). `auth.users.phone` has no `+` (`92300...`), `profiles.phone` keeps `+92...`. The sign-in phone is locked (0034); there is no Change number feature. Fixed test OTPs live only in generated `.supabase-local/`, never `supabase/config.toml` or a hosted project. Production WhatsApp is not configured.
- Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `FIREBASE_SERVICE_ACCOUNT` (Edge Function secret), the Vault entry `push_webhook_secret`, `ADMIN_MAIL_API_KEY`, `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN` are server-only; only `.env.example` is committed.
- Grants: least privilege. Since 0015 new tables/views get no app-role privileges by default; each migration grants exactly what is needed, never TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. `service_role` bypasses RLS; 0014 column grants are pinned by `service_role_grants.test.sql`. Never give app roles `device_tokens` or write access to `notifications`.
- The 0010 read views are security-definer and filter on `auth.uid()`; the Supabase advisor warning is expected.
- Admin portal: never use the service-role key. Every signed-in portal screen/server action goes through `requireAdmin()`; `src/proxy.ts` only refreshes cookies and redirects. `is_admin()` also requires a session verified by `admin-2fa` (12h). Admin accounts are invited by a verified admin; the first admin is seeded by SQL. New admin DB functions need `is_admin()`, an audit row, explicit grants and pgTAP for password-only admin/resident/worker/anon. The emailed code is the interim second factor; TOTP needs a paid plan and is a `safety:prod-ready` blocker. Read `apps/admin/AGENTS.md` before Next.js work: this Next 16 differs from training data (docs in `node_modules/next/dist/docs/`; `next dev` re-adds that file, keep it).
- App conventions: all worker text is in `apps/worker/src/i18n/en.ts`; no `select('*')`; paged lists, short-lived signed URLs and stable image sources; guards live in `apps/worker/src/lib/{queryRules,textRules}.test.ts` and admin rule tests.
- Out of scope: W09 direct requests and distance/Nearest; the customer app needs explicit approval. For unclear requirements, build the clear part and add to `docs/OPEN-QUESTIONS.md`; do not invent product behavior.

## Never touch

- Relay project (`crhqgcphpivsjoqzgfzd`; local project id `Relay`), an old product: stop it with `supabase stop --project-id Relay`, never modify it.
- Abandoned `dha-suite` (`qfxpluotmrxmxqseelnh`). The Supabase MCP connector is logged into the old account (sees Relay); use the Supabase CLI for this project.
- `main` must not be pushed to; work on `dev`.

## Workflow

- No CI and no repo-wide test/lint script. Run the checks for what you touched; after migration changes run `test db`, after throwaway scripts run `db reset`.
- Enable the pre-push hook once per clone: `git config core.hooksPath .githooks`. It checks the Supabase config in pushed commits and blocks `main`.
- Ask before committing or pushing. End commit messages with the `Co-Authored-By` line for the model doing the work.

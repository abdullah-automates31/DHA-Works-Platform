// Runs the pgTAP database tests on the hosted TEST project (no Docker): scripts/test-db-hosted.cjs [--reset] [--push] [--only name] [--list] [--no-tests]
// The test project is a separate, free Supabase project with fake data only. It is linked in its own folder
// (TESTDB_DIR, default C:/Users/Abdullah Ali/dha-works-testdb) so this repo's own link (hosted DEV) is never touched.
//   --reset  wipe the test project (drops the app schemas, deletes the fake users, removes the storage buckets, clears the
//            migration list) and re-apply every migration. Drills leave fake data behind and the database tests expect empty
//            tables. `supabase db reset --linked` is NOT used: it fails half way on a hosted project.
//   --push   copy supabase/migrations into the test folder and `supabase db push` them to the test project first
//   --only X run only test files whose name contains X
//   --no-tests  stop after --reset/--push (leaves a clean, fully migrated project)
// Each test file is sent as one SQL request (they are transactions that never commit: the connection ends without a
// commit, so nothing is kept). The hosted pgTAP keeps only a failure count, so a failing file is run a second time with
// every assertion rewritten to store its result line, and the failing lines are printed.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DEV_REF = 'xiozwoocisesgmegewww';
const ABANDONED_REF = 'qfxpluotmrxmxqseelnh';
const DIR = process.env.TESTDB_DIR || 'C:/Users/Abdullah Ali/dha-works-testdb';
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const refOf = (dir) => { try { return fs.readFileSync(path.join(dir, 'supabase', '.temp', 'project-ref'), 'utf8').trim(); } catch { return ''; } };
const testRef = refOf(DIR);
const repoRef = refOf(REPO);
if (!testRef) throw new Error(`refusing: ${DIR} is not linked to a project (run: supabase link --project-ref <test ref> there)`);
if (testRef === DEV_REF || testRef === ABANDONED_REF || testRef === repoRef) throw new Error(`refusing: ${DIR} is linked to ${testRef}, which is not a separate test project`);

const cli = (cliArgs, opts = {}) => execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['supabase', ...cliArgs], { cwd: DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', timeout: 280000, ...opts });

function query(sql) {
  const file = path.join(os.tmpdir(), `dha-hosted-test-${process.pid}.sql`);
  fs.writeFileSync(file, sql);
  let out = '';
  // A network hiccup between this computer and Supabase is retried (up to 4 tries); a real SQL error is not.
  for (let attempt = 1; attempt <= 4; attempt++) {
    try { out = cli(['db', 'query', '--linked', '-f', file]); } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
    if (!/TransportError|Transport error|ECONNRESET|ETIMEDOUT|fetch failed/i.test(out)) break;
  }
  fs.rmSync(file, { force: true });
  const i = out.indexOf('{');
  if (i < 0) throw new Error('no JSON from the CLI: ' + out.slice(0, 300));
  let j; try { j = JSON.parse(out.slice(i, out.lastIndexOf('}') + 1)); } catch { throw new Error('unreadable CLI answer: ' + out.slice(0, 300)); }
  if (j._tag === 'Error' || j.error) throw new Error((j.error && j.error.message ? j.error.message : JSON.stringify(j)).replace(/\\n/g, '\n').slice(0, 600));
  return j.rows || [];
}

async function resetProject() {
  console.log('wiping the test project', testRef);
  query(`
    do $$ declare r record; begin
      for r in select policyname, tablename from pg_policies where schemaname = 'storage' loop execute format('drop policy %I on storage.%I', r.policyname, r.tablename); end loop;
    end $$;
    drop schema if exists atk cascade;
    drop schema if exists private cascade;
    drop schema if exists public cascade;
    create schema public;
    grant usage on schema public to postgres, anon, authenticated, service_role;
    grant all on schema public to postgres, service_role;
    -- the owner-only default grants of a fresh project's public schema (default_privileges.test.sql expects exactly this after the migrations)
    alter default privileges for role postgres in schema public grant all on tables to postgres;
    alter default privileges for role postgres in schema public grant all on functions to postgres;
    alter default privileges for role postgres in schema public grant all on sequences to postgres;
    delete from auth.users;
    drop extension if exists pg_cron cascade;
    drop extension if exists pg_net cascade;
    drop extension if exists pg_trgm cascade;
    delete from supabase_migrations.schema_migrations;
  `);
  // Direct deletes from the storage tables are blocked: remove the (empty) buckets through the Storage API.
  const keysOut = cli(['projects', 'api-keys', '--project-ref', testRef, '-o', 'json']);
  const keys = JSON.parse(keysOut.slice(keysOut.indexOf('[')));
  const svc = (keys.find((k) => k.name === 'service_role') || {}).api_key;
  if (!svc) throw new Error('could not read the test project service key');
  for (const id of ['identity', 'job-media', 'worker-media', 'report-media']) {
    const r = await fetch(`https://${testRef}.supabase.co/storage/v1/bucket/${id}`, { method: 'DELETE', headers: { apikey: svc, authorization: `Bearer ${svc}` } });
    if (!r.ok && r.status !== 404) console.log(`bucket ${id}: ${r.status} ${(await r.text()).slice(0, 120)}`);
  }
}

function pushMigrations() {
  const dest = path.join(DIR, 'supabase', 'migrations');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO, 'supabase', 'migrations'))) fs.copyFileSync(path.join(REPO, 'supabase', 'migrations', f), path.join(dest, f));
  console.log('pushing migrations to the test project', testRef);
  cli(['db', 'push', '--linked']);
}

const ASSERT = /^select\s+(is|isnt|ok|throws_ok|lives_ok|results_eq|results_ne|is_empty|isa_ok|matches|doesnt_match|like|unlike|has_\w+|hasnt_\w+|cmp_ok|bag_eq|set_eq|function_returns|col_\w+|policies_are|is_\w+|performs_\w+|pass|fail)\s*\(/i;
const SUMMARY = '\nselect num_failed() as failed;\n';
const LEADING_COMMENTS = /^\s*(--[^\n]*\n\s*)*/;

/** The file without its closing finish() and rollback, so a summary can be read in the same session. */
const body = (text) => text.replace(/\r\n/g, '\n').replace(/select \* from finish\(\);\s*rollback;\s*$/i, '');

/** Splits a test file into statements (a statement ends at a line ending with ';' outside a $$ block). */
function statements(text) {
  const out = [];
  let cur = [];
  let inDollar = false;
  for (const line of body(text).split('\n')) {
    cur.push(line);
    if ((line.match(/\$\$/g) || []).length % 2 === 1) inDollar = !inDollar;
    if (!inDollar && line.trimEnd().endsWith(';')) { out.push(cur.join('\n')); cur = []; }
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

/**
 * The hosted pgTAP keeps only a failure count, so to name the failing checks every assertion statement is rewritten to
 * store its result lines in a temporary table, and the lines that start with "not ok" are read back.
 */
function diagnose(text) {
  // `select a(), b() from x;` becomes `insert into tap_out select to_json(q)::text from (select a(), b() from x) q;`
  const rewritten = statements(text).map((st) => {
    const bare = st.replace(LEADING_COMMENTS, '');
    if (!ASSERT.test(bare)) return st;
    return `insert into pg_temp.tap_out select to_json(q)::text from (${bare.trim().replace(/;\s*$/, '')}) q;`;
  });
  const first = rewritten.findIndex((st) => /^begin\s*;/i.test(st.replace(LEADING_COMMENTS, '').trim()));
  // granted to everyone: some tests switch to a lower-privileged role part way through
  rewritten.splice(first + 1, 0, 'create temp table tap_out (line text);\ngrant all on pg_temp.tap_out to public;');
  const rows = query(rewritten.join('\n') + "\nselect line from pg_temp.tap_out where line like '%not ok%' order by 1;\n");
  return rows.map((r) => String(r.line).replace(/\s+/g, ' ').slice(0, 240)).slice(0, 8);
}

(async () => {
  if (args.includes('--reset')) { await resetProject(); pushMigrations(); }
  else if (args.includes('--push')) pushMigrations();
  query('create extension if not exists pgtap with schema extensions;');

  const dir = path.join(REPO, 'supabase', 'tests');
  let files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.sql')).sort();
  if (only) files = files.filter((f) => f.includes(only));
  if (args.includes('--list')) { console.log(files.join('\n')); process.exit(0); }
  if (args.includes('--no-tests')) { console.log('project ready (no tests run)'); process.exit(0); }

  let bad = 0;
  console.log(`test project ${testRef}: ${files.length} file(s)`);
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const t0 = Date.now();
    try {
      const rows = query(body(text) + SUMMARY);
      const failed = Number(rows[0].failed);
      if (failed === 0) console.log(`ok     ${f}  (${Math.round((Date.now() - t0) / 1000)}s)`);
      else {
        bad++;
        let why;
        try { why = diagnose(text).join('\n         '); } catch (e) { why = '(could not read the failing checks: ' + String(e.message).slice(0, 160) + ')'; }
        console.log(`FAILED ${f}  ${failed} failed:\n         ${why}`);
      }
    } catch (e) {
      bad++;
      console.log(`ERROR  ${f}  ${String(e.message).split('\n').slice(0, 4).join(' | ').slice(0, 400)}`);
    }
  }
  console.log(bad === 0 ? `\nall ${files.length} files passed` : `\n${bad} of ${files.length} file(s) did not pass`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e.message || e); process.exit(2); });

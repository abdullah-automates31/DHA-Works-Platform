// Runs the pgTAP database tests on the hosted TEST project (no Docker): scripts/test-db-hosted.cjs [--push] [--only name] [--list]
// The test project is a separate, free Supabase project with fake data only. It is linked in its own folder
// (TESTDB_DIR, default C:\Users\Abdullah Ali\dha-works-testdb) so this repo's own link (hosted DEV) is never touched.
//   --push   copy supabase/migrations into the test folder and `supabase db push` them to the test project first
//   --only X run only test files whose name contains X
// Each test file is sent as one SQL request (they are transactions that never commit: the connection ends without a
// commit, so nothing is kept). The hosted pgTAP keeps only a failure count, so a failing file is narrowed down by
// cutting it after each assertion line (a bisection) and showing the first assertion where the count rises.
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DEV_REF = 'xiozwoocisesgmegewww';
const ABANDONED_REF = 'qfxpluotmrxmxqseelnh';
const DIR = process.env.TESTDB_DIR || 'C:\\Users\\Abdullah Ali\\dha-works-testdb';
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

if (args.includes('--push')) {
  const dest = path.join(DIR, 'supabase', 'migrations');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO, 'supabase', 'migrations'))) fs.copyFileSync(path.join(REPO, 'supabase', 'migrations', f), path.join(dest, f));
  console.log('pushing migrations to the test project', testRef);
  cli(['db', 'push', '--linked']);
}
query('create extension if not exists pgtap with schema extensions;');

const ASSERT = /^select\s+(is|isnt|ok|throws_ok|lives_ok|results_eq|results_ne|is_empty|isa_ok|matches|doesnt_match|like|unlike|has_\w+|hasnt_\w+|cmp_ok|bag_eq|set_eq|function_returns|col_\w+|policies_are|is_\w+|performs_\w+|pass|fail)\s*\(/i;
const SUMMARY = '\nselect num_failed() as failed, (select count(*) from __tcache__) as cache_rows;\n';

/** The file without its closing finish() and rollback, so a summary can be read in the same session. */
const body = (text) => text.replace(/\r\n/g, '\n').replace(/select \* from finish\(\);\s*rollback;\s*$/i, '');

function assertionLines(lines) {
  const out = [];
  let inDollar = false;
  lines.forEach((line, idx) => {
    if (!inDollar && ASSERT.test(line.trim()) && line.trimEnd().endsWith(';')) out.push(idx);
    const n = (line.match(/\$\$/g) || []).length;
    if (n % 2 === 1) inDollar = !inDollar;
  });
  return out;
}

const failedAfter = (lines, upto) => Number(query(lines.slice(0, upto + 1).join('\n') + SUMMARY)[0].failed);

function firstFailure(text) {
  const lines = body(text).split('\n');
  const cands = assertionLines(lines);
  let lo = 0, hi = cands.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (failedAfter(lines, cands[mid]) > 0) { found = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return found < 0 ? '(the failure is after the last single-line assertion, or the plan is wrong)' : `line ${cands[found] + 1}: ${lines[cands[found]].trim().slice(0, 220)}`;
}

const dir = path.join(REPO, 'supabase', 'tests');
let files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.sql')).sort();
if (only) files = files.filter((f) => f.includes(only));
if (args.includes('--list')) { console.log(files.join('\n')); process.exit(0); }

let bad = 0;
console.log(`test project ${testRef}: ${files.length} file(s)`);
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const t0 = Date.now();
  try {
    const rows = query(body(text) + SUMMARY);
    const failed = Number(rows[0].failed);
    if (failed === 0) console.log(`ok     ${f}  (${Math.round((Date.now() - t0) / 1000)}s)`);
    else { bad++; console.log(`FAILED ${f}  ${failed} failed; first: ${firstFailure(text)}`); }
  } catch (e) {
    bad++;
    console.log(`ERROR  ${f}  ${String(e.message).split('\n').slice(0, 4).join(' | ').slice(0, 400)}`);
  }
}
console.log(bad === 0 ? `\nall ${files.length} files passed` : `\n${bad} of ${files.length} file(s) did not pass`);
process.exit(bad ? 1 : 0);

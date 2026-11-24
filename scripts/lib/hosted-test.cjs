// Shared by the attack drills when they run with --hosted: the address and keys of the separate hosted TEST project, and
// SQL access through the Supabase CLI (no Docker). The test project holds fake data only and is linked in its own folder
// (TESTDB_DIR, default C:/Users/Abdullah Ali/dha-works-testdb), never in this repo, so DEV is never touched. Keys are read
// in memory with `supabase projects api-keys` and are never printed.
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEV_REF = 'xiozwoocisesgmegewww';
const ABANDONED_REF = 'qfxpluotmrxmxqseelnh';

function refOf(dir) {
  try { return fs.readFileSync(path.join(dir, 'supabase', '.temp', 'project-ref'), 'utf8').trim(); } catch { return ''; }
}

function hostedContext() {
  const dir = process.env.TESTDB_DIR || 'C:/Users/Abdullah Ali/dha-works-testdb';
  const ref = refOf(dir);
  const repoRef = refOf(path.resolve(__dirname, '..', '..'));
  if (!ref) throw new Error(`refusing: ${dir} is not linked to a project`);
  if (ref === DEV_REF || ref === ABANDONED_REF || ref === repoRef) throw new Error(`refusing: ${dir} is linked to ${ref}, which is not a separate test project`);

  const keysOut = execSync(`npx supabase projects api-keys --project-ref ${ref} -o json`, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const keys = JSON.parse(keysOut.slice(keysOut.indexOf('[')));
  const keyOf = (name) => { const k = keys.find((x) => x.name === name); return k && (k.api_key || k.key); };
  const anon = keyOf('anon');
  const service = keyOf('service_role');
  if (!anon || !service) throw new Error('could not read the test project keys');

  /** Runs SQL on the test project; returns the rows of the LAST statement. Network hiccups are retried. */
  function rows(q) {
    const file = path.join(os.tmpdir(), `dha-hosted-${process.pid}-${Math.random().toString(36).slice(2)}.sql`);
    fs.writeFileSync(file, q);
    let out = '';
    for (let attempt = 1; attempt <= 4; attempt++) {
      try { out = execSync(`npx supabase db query --linked --output-format json -f "${file}"`, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
      if (!/TransportError|Transport error|ECONNRESET|ETIMEDOUT|fetch failed/i.test(out)) break;
    }
    fs.rmSync(file, { force: true });
const i = out.indexOf('{');
const j2 = out.indexOf('[');
const start = (i >= 0 && (j2 < 0 || i < j2)) ? i : j2;
if (start < 0) throw new Error('no JSON from the CLI: ' + out.slice(0, 300));
let j = JSON.parse(out.slice(start, out.lastIndexOf(start === i ? '}' : ']') + 1));
if (Array.isArray(j)) j = { rows: j };
if (j.error) throw new Error(String(j.error.message || j.error).slice(0, 300));
return j.rows || [];
  }
  /** The first value of the first row as text ('' when there is none): the same shape psql -tA gave. */
  function scalar(q) {
    const r = rows(q);
    if (!r.length) return '';
    const v = Object.values(r[0])[0];
    if (typeof v === 'boolean') return v ? 't' : 'f'; // psql prints booleans as t / f and the drills compare against that
    return v === null || v === undefined ? '' : String(v);
  }
  return { ref, url: `https://${ref}.supabase.co`, anon, service, rows, scalar };
}

module.exports = { hostedContext };

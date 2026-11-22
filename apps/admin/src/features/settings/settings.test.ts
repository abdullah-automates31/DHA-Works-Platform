import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAudit, parseRules, parseStaffActivity, parseSystemStatus, type Rule } from './parse.ts';
import { actionLabel, changeText, checkRules, formatBytes, matchSections, parseSection, rulesDirty, SECTION_KEYS } from './rules.ts';

const ID = '00000000-0000-4000-8000-0000000000a1';
const rule = (over: Partial<Rule> & Pick<Rule, 'key'>): Rule => ({ label: over.key, value: 10, def: 10, min: 1, max: 100, integer: true, changedAt: null, changedBy: null, ...over });

const JOBS: Rule[] = [
  rule({ key: 'job_expiry_hours', label: 'Open jobs expire after (hours)', value: 24, def: 24, min: 6, max: 168 }),
  rule({ key: 'job_expiry_reminder_hours', label: 'Reminder after (hours)', value: 20, def: 20, min: 1, max: 167 }),
];
const WORKERS: Rule[] = [
  rule({ key: 'top_rated_min_jobs', label: 'Completed jobs', value: 10, def: 10, min: 1, max: 500 }),
  rule({ key: 'top_rated_min_rating', label: 'Average rating', value: 4.5, def: 4.5, min: 1, max: 5, integer: false }),
];

test('rules: the saved values pass, and nothing is dirty until a box changes', () => {
  const saved = { job_expiry_hours: '24', job_expiry_reminder_hours: '20' };
  assert.equal(checkRules('jobs', JOBS, saved), null);
  assert.equal(rulesDirty(JOBS, saved), false);
  assert.equal(rulesDirty(JOBS, { ...saved, job_expiry_hours: '48' }), true);
  assert.equal(rulesDirty(JOBS, { ...saved, job_expiry_hours: '24.0' }), false, '24.0 is the same number');
  assert.equal(rulesDirty(JOBS, { ...saved, job_expiry_hours: '' }), true, 'an emptied box counts as a change so it is never lost silently');
});

test('rules: every kind of wrong value is described in plain words', () => {
  const ok = { job_expiry_hours: '24', job_expiry_reminder_hours: '20' };
  assert.match(checkRules('jobs', JOBS, { ...ok, job_expiry_hours: '' })!, /enter a number/);
  assert.match(checkRules('jobs', JOBS, { ...ok, job_expiry_hours: 'abc' })!, /enter a number/);
  assert.match(checkRules('jobs', JOBS, { ...ok, job_expiry_hours: '-5' })!, /enter a number/);
  assert.match(checkRules('jobs', JOBS, { ...ok, job_expiry_hours: '5' })!, /between 6 and 168/);
  assert.match(checkRules('jobs', JOBS, { ...ok, job_expiry_hours: '169' })!, /between 6 and 168/);
  assert.match(checkRules('jobs', JOBS, { ...ok, job_expiry_hours: '24.5' })!, /whole number/);
  assert.equal(checkRules('jobs', JOBS, { ...ok, job_expiry_hours: '6', job_expiry_reminder_hours: '5' }), null);
});

test('rules: the reminder must come before the job expires (the same rule as the database)', () => {
  assert.equal(checkRules('jobs', JOBS, { job_expiry_hours: '24', job_expiry_reminder_hours: '24' }), 'The reminder must come before the job expires.');
  assert.equal(checkRules('jobs', JOBS, { job_expiry_hours: '24', job_expiry_reminder_hours: '30' }), 'The reminder must come before the job expires.');
  assert.equal(checkRules('jobs', JOBS, { job_expiry_hours: '24', job_expiry_reminder_hours: '23' }), null);
  // the worker rules have no such pair
  assert.equal(checkRules('workers', WORKERS, { top_rated_min_jobs: '10', top_rated_min_rating: '4.5' }), null);
});

test('rules: the rating takes one decimal at most and stays between 1 and 5', () => {
  assert.equal(checkRules('workers', WORKERS, { top_rated_min_jobs: '10', top_rated_min_rating: '4.6' }), null);
  assert.equal(checkRules('workers', WORKERS, { top_rated_min_jobs: '10', top_rated_min_rating: '5' }), null);
  assert.match(checkRules('workers', WORKERS, { top_rated_min_jobs: '10', top_rated_min_rating: '4.55' })!, /one decimal/);
  assert.match(checkRules('workers', WORKERS, { top_rated_min_jobs: '10', top_rated_min_rating: '5.1' })!, /between 1 and 5/);
  assert.match(checkRules('workers', WORKERS, { top_rated_min_jobs: '0', top_rated_min_rating: '4.5' })!, /between 1 and 500/);
});

test('parse: rules arrive with defaults, limits and who changed them; garbage becomes null', () => {
  const r = parseRules({
    jobs: [{ key: 'job_expiry_hours', label: 'Open jobs expire after (hours)', value: 24, default: 24, min: 6, max: 168, integer: true, changed_at: null, changed_by: null }],
    workers: [{ key: 'top_rated_min_rating', label: 'Rating', value: '4.50', default: 4.5, min: 1, max: 5, integer: false, changed_at: '2026-11-19T10:00:00Z', changed_by: 'Staff A' }],
  });
  assert.equal(r?.jobs[0]?.value, 24);
  assert.equal(r?.workers[0]?.value, 4.5, 'a numeric string is read as a number');
  assert.equal(r?.workers[0]?.changedBy, 'Staff A');
  assert.equal(r?.workers[0]?.integer, false);
  for (const bad of [null, undefined, 'x', 5, [], {}, { jobs: [{ key: 'a' }], workers: 'no' }]) assert.equal(parseRules(bad), null);
});

test('parse: staff activity is keyed by admin and ignores odd ids', () => {
  const a = parseStaffActivity([{ id: ID, last_sign_in_at: '2026-11-19T09:00:00Z', active_sessions: 2, last_active_at: '2026-11-19T10:00:00Z', last_ip: '203.0.113.7' }, { id: 'nope', active_sessions: 9 }, null, 'x']);
  assert.deepEqual(Object.keys(a), [ID]);
  assert.equal(a[ID]?.activeSessions, 2);
  assert.equal(a[ID]?.lastIp, '203.0.113.7');
  assert.deepEqual(parseStaffActivity('x'), {});
});

test('parse: the audit list keeps good rows, drops bad ones and never crashes', () => {
  const a = parseAudit({
    total: 3,
    rows: [
      { id: 7, at: '2026-11-19T10:00:00Z', actor_id: ID, actor: 'Staff A', action: 'rules_saved', table: 'app_settings', record: 'jobs', old: { job_expiry_hours: 24 }, new: { job_expiry_hours: 48 }, reason: null },
      { id: 6, at: 'not a date', action: 'x' },
      { id: 5, at: '2026-11-18T10:00:00Z', action: '' },
      { id: 4, at: '2026-11-18T09:00:00Z', actor_id: null, actor: null, action: 'system_thing', old: 'bad', new: [1] },
    ],
    actions: ['rules_saved', 5, 'system_thing'],
    admins: [{ id: ID, name: 'Staff A' }, { id: 'bad', name: 'x' }],
  });
  assert.equal(a.total, 3);
  assert.equal(a.rows.length, 2);
  assert.equal(a.rows[0]?.new?.job_expiry_hours, 48);
  assert.equal(a.rows[1]?.old, null, 'a value that is not an object is dropped');
  assert.deepEqual(a.actions, ['rules_saved', 'system_thing']);
  assert.equal(a.admins.length, 1);
  assert.deepEqual(parseAudit(null), { total: 0, rows: [], actions: [], admins: [] });
});

test('parse: system status, with the scheduler unreadable or readable', () => {
  const ok = parseSystemStatus({
    database_bytes: 12_000_000, storage: [{ bucket: 'identity', objects: 3, bytes: 2048 }, { objects: 1 }],
    push: { waiting_24h: 2, last_sent_at: '2026-11-19T09:00:00Z' }, active_admins: 2,
    cron: [{ name: 'dw-job-reminders', last_run_at: '2026-11-19T09:55:00Z', status: 'succeeded' }, { status: 'x' }],
  });
  assert.equal(ok?.databaseBytes, 12_000_000);
  assert.equal(ok?.storage.length, 1);
  assert.equal(ok?.push.waiting24h, 2);
  assert.equal(ok?.cron?.length, 1);
  assert.equal(parseSystemStatus({ cron: null })?.cron, null, 'null means the scheduler could not be read');
  assert.equal(parseSystemStatus(null), null);
  assert.equal(parseSystemStatus([]), null);
});

test('sections: every key opens, an unknown one falls back to Service categories', () => {
  assert.equal(SECTION_KEYS.length, 11);
  for (const k of SECTION_KEYS) assert.equal(parseSection(k), k);
  for (const bad of [undefined, null, '', 'nope', ['jobs'], 5]) assert.equal(parseSection(bad), 'categories');
});

test('search: finds sections by what is in them, needs every word, and is not case sensitive', () => {
  assert.deepEqual([...matchSections('expiry')], ['jobs']);
  assert.deepEqual([...matchSections('TOP RATED')], ['workers']);
  assert.ok(matchSections('sessions').has('admins'));
  assert.ok(matchSections('sessions').has('danger'));
  assert.ok(matchSections('backup').has('system'));
  assert.ok(matchSections('turnstile').has('security'));
  assert.equal(matchSections('zzzz').size, 0);
  assert.equal(matchSections('expiry zzzz').size, 0, 'every word has to match');
});

test('audit wording: known actions get plain names, unknown ones are made readable, changes show old and new', () => {
  assert.equal(actionLabel('rules_saved'), 'Rules saved');
  assert.equal(actionLabel('some_new_action'), 'Some new action');
  assert.equal(actionLabel(''), 'Unknown');
  assert.equal(changeText({ action: 'rules_saved', old: { job_expiry_hours: 24 }, new: { job_expiry_hours: 48 }, reason: null }), 'job expiry hours: 24 to 48');
  assert.equal(changeText({ action: 'rules_saved', old: null, new: { max_job_photos: 8 }, reason: null }), 'max job photos: - to 8');
  assert.equal(changeText({ action: 'admins_signed_out', old: null, new: { sessions_ended: 1 }, reason: null }), '1 session ended');
  assert.equal(changeText({ action: 'admins_signed_out', old: null, new: { sessions_ended: 3 }, reason: null }), '3 sessions ended');
  assert.equal(changeText({ action: 'staff_removed', old: { account_status: 'active' }, new: { account_status: 'suspended' }, reason: 'left the team' }), 'left the team');
  assert.equal(changeText({ action: 'user_viewed', old: null, new: null, reason: null }), '');
});

test('sizes read in plain units', () => {
  assert.equal(formatBytes(0), '0 MB');
  assert.equal(formatBytes(-5), '0 MB');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(12 * 1024 * 1024), '12 MB');
  assert.equal(formatBytes(1.5 * 1024 * 1024 * 1024), '1.5 GB');
});

test("the dues section: found by its words and its rules are checked like the others", () => {
  assert.ok(matchSections("jazzcash").has("dues"));
  assert.ok(matchSections("commission").has("dues"));
  assert.equal(parseSection("dues"), "dues");
  const rules = [
    { key: "dha_fee_percent", label: "DHA fee", value: 20, def: 20, min: 0, max: 60, integer: false, changedAt: null, changedBy: null },
    { key: "dues_due_days", label: "Days to pay", value: 5, def: 5, min: 1, max: 30, integer: true, changedAt: null, changedBy: null },
  ];
  assert.equal(checkRules("dues", rules, { dha_fee_percent: "12.5", dues_due_days: "7" }), null);
  assert.match(checkRules("dues", rules, { dha_fee_percent: "61", dues_due_days: "7" }) ?? "", /between 0 and 60/);
  assert.match(checkRules("dues", rules, { dha_fee_percent: "12.55", dues_due_days: "7" }) ?? "", /one decimal/);
  assert.match(checkRules("dues", rules, { dha_fee_percent: "20", dues_due_days: "0" }) ?? "", /between 1 and 30/);
});

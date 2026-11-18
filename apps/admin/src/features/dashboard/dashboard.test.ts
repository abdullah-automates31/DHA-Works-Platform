import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDashboard } from './parse.ts';
import { activityHref, agoText, attentionHref, barPercent, dateLine, maxStage, oldestText, parseRange, rangeTitle, STAGE_ROWS, stageHref } from './rules.ts';

const ID = '00000000-0000-4000-8000-0000000000b1';
const now = new Date('2026-11-07T12:00:00Z');
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

test('a full reply is parsed', () => {
  const d = parseDashboard({
    workers_pending: { count: 2, oldest_since: ago(1200) },
    residents_pending: { count: 1, oldest_since: ago(540) },
    reports_open: { count: 4, unsafe: 1 },
    jobs_today: { count: 23, in_progress: 4 },
    stages: { open: 5, scheduled: 6, in_progress: 4, completed: 2, cash_collected: 3, disputed: 1 },
    attention: [
      { id: ID, kind: 'unsafe', title: 'RP-0001 · unsafe', detail: 'DW-1 · Leak · Phase 6', since: ago(12) },
      { id: ID, kind: 'worker', title: 'Ali is waiting for review', detail: 'Worker application', since: ago(1200) },
    ],
  });
  assert.equal(d.workers.count, 2);
  assert.equal(d.reports.unsafe, 1);
  assert.equal(d.jobsToday.inProgress, 4);
  assert.equal(d.stages.cash_collected, 3);
  assert.equal(d.attention.length, 2);
});

test('garbage becomes zeros and an empty list, never an error', () => {
  for (const bad of [null, undefined, 'x', 5, [], { stages: 'no', attention: 'no' }, { workers_pending: { count: -3 }, reports_open: { count: 'many' } }]) {
    const d = parseDashboard(bad);
    assert.equal(d.workers.count, 0);
    assert.equal(d.reports.count, 0);
    assert.deepEqual(d.attention, []);
    assert.equal(d.stages.open, 0);
  }
});

test('attention items with a wrong kind, a missing field or a bad date are dropped, and the list is capped at 15', () => {
  const good = { id: ID, kind: 'stuck', title: 't', detail: 'd', since: ago(5) };
  const d = parseDashboard({
    attention: [
      { ...good, kind: 'hack' }, { ...good, id: '' }, { ...good, title: null }, { ...good, since: 'not a date' }, null, 'x',
      ...Array.from({ length: 20 }, () => good),
    ],
    attention_total: 20,
  });
  assert.equal(d.attention.length, 15);
  assert.equal(d.attentionTotal, 20);
  assert.equal(d.attention[0]?.priority, 'normal', 'an older reply without a priority gets the old order');
});

test('bars: relative to the biggest stage, a small count still shows, zero shows nothing', () => {
  assert.equal(barPercent(8, 8), 100);
  assert.equal(barPercent(4, 8), 50);
  assert.equal(barPercent(1, 100), 4);
  assert.equal(barPercent(0, 8), 0);
  assert.equal(barPercent(5, 0), 0);
  assert.equal(barPercent(500, 8), 100);
  assert.equal(maxStage({ open: 5, scheduled: 6, in_progress: 4, completed: 2, cash_collected: 3, disputed: 1, cancelled: 0, expired: 9 }), 9);
  assert.equal(maxStage({ open: 0, scheduled: 0, in_progress: 0, completed: 0, cash_collected: 0, disputed: 0, cancelled: 0, expired: 0 }), 0);
});

test('items open the right screen and an odd id never builds a link into an application', () => {
  const base = { title: 't', detail: '', since: ago(1) };
  assert.equal(attentionHref({ ...base, id: ID, kind: 'worker' }), `/workers/${ID}`);
  assert.equal(attentionHref({ ...base, id: ID, kind: 'resident' }), `/residents/${ID}`);
  assert.equal(attentionHref({ ...base, id: '../../x', kind: 'worker' }), '/jobs');
  assert.equal(attentionHref({ ...base, id: ID, kind: 'unsafe' }), `/reports/${ID}`);
  assert.equal(attentionHref({ ...base, id: ID, kind: 'report' }), `/reports/${ID}`);
  assert.equal(attentionHref({ ...base, id: '../x', kind: 'report' }), '/reports');
  assert.equal(attentionHref({ ...base, id: ID, kind: 'cancellation' }), '/jobs/cancellations');
  assert.equal(attentionHref({ ...base, id: ID, kind: 'stuck' }), `/jobs/${ID}`);
  assert.equal(attentionHref({ ...base, id: '../x', kind: 'stuck' }), '/jobs');
});

test('time wording', () => {
  assert.equal(agoText(ago(0), now), 'just now');
  assert.equal(agoText(ago(12), now), '12 min ago');
  assert.equal(agoText(ago(180), now), '3 h ago');
  assert.equal(agoText(ago(60 * 72), now), '3 d ago');
  assert.equal(agoText(null, now), '-');
  assert.equal(agoText(ago(-30), now), 'just now');
  assert.equal(oldestText(0, ago(100), now), null);
  assert.equal(oldestText(2, null, now), null);
  assert.equal(oldestText(2, ago(30), now), 'Oldest waiting under 1 h');
  assert.equal(oldestText(2, ago(1200), now), 'Oldest waiting 20 h');
  assert.equal(oldestText(2, ago(60 * 72), now), 'Oldest waiting 3 d');
});

test('the date line is in Karachi time, even just before midnight UTC', () => {
  assert.equal(dateLine(new Date('2026-10-24T10:00:00Z')), 'Saturday, 24 October');
  assert.equal(dateLine(new Date('2026-10-24T20:30:00Z')), 'Sunday, 25 October'); // already the next day in Karachi (UTC+5)
});

test('the 0063 fields: period, high-priority reports, new stages, attention details, activity', () => {
  const d = parseDashboard({
    reports_open: { count: 4, unsafe: 1, high: 2 },
    stages: { open: 1, scheduled: 0, in_progress: 0, completed: 0, cash_collected: 0, disputed: 0, cancelled: 3, expired: 4 },
    period: { jobs_posted: 7, jobs_completed: 2, workers_registered: 1, residents_registered: 5, reports_filed: 3, reports_resolved: 1 },
    attention: [{ id: ID, kind: 'suspended_active', title: 'Ali is suspended but still has DW-1', detail: 'Leak', since: ago(60), ref: 'DW-1', person: 'Ali · for Sara', status: 'Scheduled', priority: 'high' }],
    attention_total: 1,
    activity: [
      { kind: 'job', link: 'job', link_id: ID, text: 'Job posted', ref: 'DW-1 · Leak', at: ago(3) },
      { kind: 'hack', link: 'job', link_id: ID, text: 'x', ref: '', at: ago(3) },
      { kind: 'job', link: 'elsewhere', link_id: ID, text: 'x', ref: '', at: ago(3) },
      { kind: 'job', link: 'job', link_id: ID, text: 'x', ref: '', at: 'yesterday' },
      { kind: 'account', link: 'user', link_id: ID, text: 'Worker suspended', at: ago(9) },
    ],
  });
  assert.equal(d.reports.high, 2);
  assert.equal(d.stages.cancelled, 3);
  assert.equal(d.stages.expired, 4);
  assert.deepEqual(d.period, { jobsPosted: 7, jobsCompleted: 2, workersRegistered: 1, residentsRegistered: 5, reportsFiled: 3, reportsResolved: 1 });
  assert.equal(d.attention[0]?.kind, 'suspended_active');
  assert.equal(d.attention[0]?.priority, 'high');
  assert.equal(d.attention[0]?.ref, 'DW-1');
  assert.equal(d.activity.length, 2, 'unknown kinds, unknown links and bad dates are dropped');
  assert.equal(d.activity[1]?.ref, '', 'a missing reference becomes empty');
});

test('the activity list is capped at 20 and a missing total never shows fewer than listed', () => {
  const a = { kind: 'job', link: 'job', link_id: ID, text: 't', ref: 'r', at: ago(1) };
  const d = parseDashboard({ activity: Array.from({ length: 30 }, () => a), attention: [{ id: ID, kind: 'stuck', title: 't', since: ago(1) }] });
  assert.equal(d.activity.length, 20);
  assert.equal(d.attentionTotal, 1);
});

test('stages: eight rows, and each opens a Jobs list with the same jobs', () => {
  assert.deepEqual(STAGE_ROWS.map((r) => r.key), ['open', 'scheduled', 'in_progress', 'completed', 'cash_collected', 'disputed', 'cancelled', 'expired']);
  assert.equal(stageHref('open'), '/jobs?stage=open');
  assert.equal(stageHref('scheduled'), '/jobs?stage=scheduled');
  assert.equal(stageHref('cash_collected'), '/jobs?stage=cash_collected');
  assert.equal(stageHref('in_progress'), '/jobs?status=in_progress');
  assert.equal(stageHref('expired'), '/jobs?status=expired');
});

test('the period: only four values, anything else is today', () => {
  assert.equal(parseRange('7d'), '7d');
  assert.equal(parseRange('90d'), '90d');
  assert.equal(parseRange('1y'), 'today');
  assert.equal(parseRange(undefined), 'today');
  assert.equal(parseRange(['7d']), 'today');
  assert.equal(rangeTitle('30d'), 'in the last 30 days');
});

test('activity items open the right screen and an odd id never builds a link', () => {
  assert.equal(activityHref({ link: 'worker', linkId: ID }), `/workers/${ID}`);
  assert.equal(activityHref({ link: 'resident', linkId: ID }), `/residents/${ID}`);
  assert.equal(activityHref({ link: 'job', linkId: ID }), `/jobs/${ID}`);
  assert.equal(activityHref({ link: 'report', linkId: ID }), `/reports/${ID}`);
  assert.equal(activityHref({ link: 'user', linkId: ID }), `/users/${ID}`);
  assert.equal(activityHref({ link: 'job', linkId: '../../x' }), '/dashboard');
  assert.equal(attentionHref({ id: ID, kind: 'suspended_active' }), `/jobs/${ID}`);
});

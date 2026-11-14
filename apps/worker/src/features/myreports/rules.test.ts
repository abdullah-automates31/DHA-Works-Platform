import assert from 'node:assert/strict';
import { test } from 'node:test';

import { datesLine, dateText, describeReport, kindLabel, parseMyReports, stepOf } from './rules.ts';

const now = new Date(2026, 10, 14, 15, 0);
const at = (day: number, hour = 10) => new Date(2026, 10, day, hour, 0).toISOString();
const row = (patch: Record<string, unknown> = {}) => ({
  id: 'r1',
  code: 'RP-0412',
  kind: 'rude_damage',
  status: 'submitted',
  outcome: null,
  job_title: 'Tap job',
  job_code: 'J-1001',
  details: 'Customer was rude',
  created_at: at(13),
  updated_at: at(13),
  resolved_at: null,
  ...patch,
});

test('the answer of my_reports is read into plain reports, newest first as sent', () => {
  const page = parseMyReports({ total: 2, rows: [row({ id: 'a', status: 'under_review', updated_at: at(14, 9) }), row({ id: 'b', status: 'resolved', outcome: 'action_taken', resolved_at: at(14, 12) })] });
  assert.ok(page);
  assert.equal(page.total, 2);
  assert.deepEqual(page.reports.map((r) => [r.id, r.status, r.outcome]), [['a', 'under_review', null], ['b', 'resolved', 'action_taken']]);
  assert.equal(page.reports[0]?.jobTitle, 'Tap job');
  assert.equal(page.reports[0]?.details, 'Customer was rude');
});

test('a row that does not look right is skipped and a broken answer is refused', () => {
  const page = parseMyReports({ total: 3, rows: [row({ status: 'banana' }), row({ id: '' }), null, 'x', row({ id: 'ok' })] });
  assert.deepEqual(page?.reports.map((r) => r.id), ['ok']);
  for (const bad of [null, undefined, 'x', 5, [], {}, { rows: 'no' }]) assert.equal(parseMyReports(bad), null);
});

test('only a resolved report has an outcome, and an unknown outcome reads as "no action"', () => {
  assert.equal(parseMyReports({ rows: [row({ status: 'submitted', outcome: 'action_taken' })] })?.reports[0]?.outcome, null);
  assert.equal(parseMyReports({ rows: [row({ status: 'resolved', outcome: 'whatever' })] })?.reports[0]?.outcome, 'no_action');
});

test('a total that is missing falls back to the rows read', () => {
  assert.equal(parseMyReports({ rows: [row()] })?.total, 1);
});

test('the three steps', () => {
  assert.deepEqual([stepOf('submitted'), stepOf('under_review'), stepOf('resolved')], [1, 2, 3]);
});

test('each status says in plain words where the report is, and no outcome says more than "action taken"', () => {
  assert.deepEqual(describeReport({ status: 'submitted', outcome: null }), { label: 'Submitted', hint: 'DHA has your report and will look at it.', tone: 'wait' });
  assert.deepEqual(describeReport({ status: 'under_review', outcome: null }), { label: 'Under review', hint: 'DHA staff are reviewing your report now.', tone: 'inProgress' });
  assert.deepEqual(describeReport({ status: 'resolved', outcome: 'action_taken' }), { label: 'Action taken', hint: 'DHA reviewed your report and took action.', tone: 'done' });
  assert.deepEqual(describeReport({ status: 'resolved', outcome: 'no_action' }), { label: 'Closed', hint: 'DHA reviewed your report. No action was needed.', tone: 'done' });
  const all = JSON.stringify(['submitted', 'under_review', 'resolved'].map((status) => describeReport({ status: status as 'resolved', outcome: 'action_taken' }))).toLowerCase();
  for (const word of ['suspend', 'warning', 'banned']) assert.equal(all.includes(word), false, word);
});

test('report kinds have their names and an unknown kind reads as Other', () => {
  assert.equal(kindLabel('rude_damage'), 'Customer rude');
  assert.equal(kindLabel('unsafe'), 'I felt unsafe');
  assert.equal(kindLabel('cash_price'), 'Refused to pay');
  assert.equal(kindLabel('something_new'), 'Other');
});

test('dates read as "14 Nov 2026" and an invalid date reads as nothing', () => {
  assert.equal(dateText(at(14)), '14 Nov 2026');
  assert.equal(dateText(''), '');
  assert.equal(dateText(null), '');
  assert.equal(dateText('not a date'), '');
});

test('the dates line shows when it was sent and, once something changed, when', () => {
  assert.equal(datesLine({ createdAt: at(13), updatedAt: at(13), resolvedAt: null, status: 'submitted' }, now), 'Sent 13 Nov 2026');
  assert.equal(datesLine({ createdAt: at(13), updatedAt: at(14, 13), resolvedAt: null, status: 'under_review' }, now), 'Sent 13 Nov 2026 · Updated 2 hrs ago');
  assert.equal(datesLine({ createdAt: at(13), updatedAt: at(14, 14), resolvedAt: at(14, 14), status: 'resolved' }, now), 'Sent 13 Nov 2026 · Resolved 1 hr ago');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { BUSY_CHIPS, BUSY_ETA_MAX, BUSY_ETA_MIN, BUSY_ETA_QUICK, busyEtaLabel, chipLabel, clockLabel, finishTimeLabel, minutesUntilVisit, needsBusyEstimate, parseBusyMinutes, visitStartMs } from './busy.ts';
import { buildSubmitArgs } from './rules.ts';

test('the quick choices are inside what the database accepts', () => {
  for (const m of BUSY_ETA_QUICK) assert.ok(m >= BUSY_ETA_MIN && m <= BUSY_ETA_MAX, String(m));
});

test('the typed number must be a whole number of minutes in range', () => {
  assert.equal(parseBusyMinutes('20'), 20);
  assert.equal(parseBusyMinutes(' 15 '), 15);
  assert.equal(parseBusyMinutes('5'), 5);
  assert.equal(parseBusyMinutes('4320'), 4320);
  assert.equal(parseBusyMinutes('4'), null);
  assert.equal(parseBusyMinutes('4321'), null);
  assert.equal(parseBusyMinutes(''), null);
  assert.equal(parseBusyMinutes('abc'), null);
  assert.equal(parseBusyMinutes('1.5'), null);
  assert.equal(parseBusyMinutes('-20'), null);
  assert.equal(parseBusyMinutes('20 min'), null);
  assert.equal(parseBusyMinutes('123456'), null);
});

test('labels read as minutes, hours or days', () => {
  assert.equal(busyEtaLabel(15), '15 minutes');
  assert.equal(busyEtaLabel(1), '1 minute');
  assert.equal(busyEtaLabel(60), '1 hour');
  assert.equal(busyEtaLabel(90), '1 hour 30 minutes');
  assert.equal(busyEtaLabel(180), '3 hours');
  assert.equal(busyEtaLabel(1440), '1 day');
  assert.equal(busyEtaLabel(2880), '2 days');
});


test('current job time screen: chips, labels and the finish time', () => {
  assert.deepEqual([...BUSY_CHIPS], [30, 60, 90, 120, 180, 240]);
  assert.deepEqual(BUSY_CHIPS.map(chipLabel), ['30 min', '1 hour', '1.5 hours', '2 hours', '3 hours', '4 hours']);
  const eleven = new Date(2026, 10, 20, 11, 10);
  assert.equal(finishTimeLabel(60, eleven), '12:10 PM');
  assert.equal(finishTimeLabel(30, new Date(2026, 10, 20, 23, 50)), '12:20 AM');
  assert.equal(finishTimeLabel(5, new Date(2026, 10, 20, 0, 0)), '12:05 AM');
});

test('a busy worker sends the minutes with the quote; a free worker sends nothing extra', () => {
  const input = { labour: '1500', withMaterials: false, items: [] };
  assert.equal(buildSubmitArgs('j', input, 60).p_busy_eta_minutes, 60);
  assert.ok(!('p_busy_eta_minutes' in buildSubmitArgs('j', input)));
  assert.ok(!('p_busy_eta_minutes' in buildSubmitArgs('j', input, null)));
});


test('the visit start is read in Karachi time (UTC+5)', () => {
  assert.equal(visitStartMs({ date: '2026-11-21', from: '15:00:00' }), Date.UTC(2026, 10, 21, 10, 0));
  assert.equal(visitStartMs({ date: '2026-11-21', from: null }), Date.UTC(2026, 10, 21, 3, 0)); // missing start counts as 08:00
  assert.equal(visitStartMs({ date: null, from: '10:00:00' }), null);
  assert.equal(visitStartMs({ date: 'soon', from: '10:00:00' }), null);
});

test('the question is needed only when the visit is within 6 hours', () => {
  const now = new Date(Date.UTC(2026, 10, 20, 9, 0)); // 14:00 in Karachi
  const at = (hhmm: string, date = '2026-11-20') => ({ date, from: `${hhmm}:00` });
  assert.equal(needsBusyEstimate(at('16:00'), now), true); // in 2 hours
  assert.equal(needsBusyEstimate(at('20:00'), now), true); // in exactly 6 hours
  assert.equal(needsBusyEstimate(at('20:01'), now), false); // just beyond
  assert.equal(needsBusyEstimate(at('15:00', '2026-11-21'), now), false); // tomorrow
  assert.equal(needsBusyEstimate(at('13:00'), now), false); // already past
  assert.equal(needsBusyEstimate({ date: null, from: null }, now), false);
  assert.equal(needsBusyEstimate(at('22:00'), now, 12), true); // a staff-changed window is respected when given
});

test('"free by the visit" is the minutes to the visit, inside 5 minutes to 3 days', () => {
  const now = new Date(Date.UTC(2026, 10, 20, 9, 0));
  assert.equal(minutesUntilVisit({ date: '2026-11-20', from: '16:00:00' }, now), 120);
  assert.equal(minutesUntilVisit({ date: '2026-11-20', from: '14:02:00' }, now), 5); // too close: raised to the minimum
  assert.equal(minutesUntilVisit({ date: '2026-12-31', from: '16:00:00' }, now), 4320); // far: capped
  assert.equal(minutesUntilVisit({ date: null, from: null }, now), null);
});

test('clock label for "Started 10:40 AM"', () => {
  assert.equal(clockLabel(new Date(2026, 10, 20, 10, 40).toISOString()), '10:40 AM');
  assert.equal(clockLabel(new Date(2026, 10, 20, 0, 5).toISOString()), '12:05 AM');
  assert.equal(clockLabel(null), '');
  assert.equal(clockLabel('nope'), '');
});

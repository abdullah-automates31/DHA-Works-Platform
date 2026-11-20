import assert from 'node:assert/strict';
import test from 'node:test';

import { BUSY_CHIPS, BUSY_ETA_MAX, BUSY_ETA_MIN, BUSY_ETA_QUICK, busyEtaLabel, chipLabel, finishTimeLabel, parseBusyMinutes } from './busy.ts';
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

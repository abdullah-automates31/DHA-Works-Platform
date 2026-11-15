import assert from 'node:assert/strict';
import test from 'node:test';

import { BUSY_ETA_MAX, BUSY_ETA_MIN, BUSY_ETA_QUICK, busyEtaLabel, parseBusyMinutes } from './busy.ts';

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

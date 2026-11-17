import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clockLabel, visitText } from './visit.ts';

// Monday 9 Nov 2026, 10:10 local time.
const now = new Date(2026, 10, 9, 10, 10);

test('clock labels', () => {
  assert.equal(clockLabel('09:00'), '9 AM');
  assert.equal(clockLabel('13:30'), '1:30 PM');
  assert.equal(clockLabel('00:00'), '12 AM');
  assert.equal(clockLabel('12:00'), '12 PM');
  assert.equal(clockLabel('garbage'), '');
});

test('a stored visit reads "Tomorrow, 10 AM": one time, no range', () => {
  assert.equal(visitText(new Date(2026, 10, 10, 10, 0).toISOString(), null, now), 'Tomorrow, 10 AM');
  assert.equal(visitText(new Date(2026, 10, 9, 16, 30).toISOString(), null, now), 'Today, 4:30 PM');
  assert.equal(visitText(null, null, now), '');
  assert.equal(visitText('garbage', null, now), '');
});

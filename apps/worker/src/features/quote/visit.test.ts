import assert from 'node:assert/strict';
import { test } from 'node:test';

import { choiceFromRange, clockLabel, dayOptions, defaultVisit, fromSlots, isoDay, toSlots, visitArgs, visitError, visitText } from './visit.ts';

// Monday 9 Nov 2026, 10:10 local time.
const now = new Date(2026, 10, 9, 10, 10);
const none = { date: null, from: null, to: null };

test('seven days to pick from, starting today', () => {
  const days = dayOptions(now);
  assert.equal(days.length, 7);
  assert.deepEqual(days.slice(0, 2).map((d) => d.label), ['Today', 'Tomorrow']);
  assert.equal(days[0]?.value, '2026-11-09');
  assert.equal(days[2]?.label, 'Wed 11 Nov');
});

test('today only offers start times at least 30 minutes ahead; other days the whole day', () => {
  assert.equal(fromSlots('2026-11-09', now)[0], '11:00');
  assert.equal(fromSlots('2026-11-10', now)[0], '07:00');
  assert.equal(fromSlots('2026-11-10', now).at(-1), '21:30');
  assert.deepEqual(fromSlots('2026-11-09', new Date(2026, 10, 9, 21, 45)), []);
});

test('end times come after the start, up to 22:00 and 12 hours', () => {
  assert.deepEqual(toSlots('20:30'), ['21:00', '21:30', '22:00']);
  assert.equal(toSlots('07:00').at(-1), '19:00');
});

test('the form starts at the customer\'s own window when it is still ahead', () => {
  assert.deepEqual(defaultVisit({ date: '2026-11-12', from: '16:00:00', to: '18:00:00' }, now), { day: '2026-11-12', from: '16:00', to: '18:00' });
  // Odd minutes snap up to the next half hour.
  assert.deepEqual(defaultVisit({ date: '2026-11-12', from: '16:10:00', to: '17:50:00' }, now), { day: '2026-11-12', from: '16:30', to: '18:00' });
});

test('an ASAP job (or a past preference) starts at the next free half hour today, two hours long', () => {
  assert.deepEqual(defaultVisit(none, now), { day: '2026-11-09', from: '11:00', to: '13:00' });
  assert.deepEqual(defaultVisit({ date: '2026-11-01', from: '09:00', to: '11:00' }, now), { day: '2026-11-09', from: '11:00', to: '13:00' });
  // Late at night there is nothing left today: tomorrow morning.
  assert.deepEqual(defaultVisit(none, new Date(2026, 10, 9, 21, 45)), { day: '2026-11-10', from: '09:00', to: '11:00' });
});

test('the window must be ahead, in order and at most 12 hours (as the database checks)', () => {
  assert.equal(visitError({ day: '2026-11-09', from: '10:00', to: '12:00' }, now), 'past');
  assert.equal(visitError({ day: '2026-11-10', from: '12:00', to: '11:00' }, now), 'order');
  assert.equal(visitError({ day: '2026-11-10', from: '07:00', to: '19:30' }, now), 'long');
  assert.equal(visitError({ day: '2026-11-10', from: '10:00', to: '12:00' }, now), null);
});

test('the window is sent as exact timestamps and reads back the same', () => {
  const args = visitArgs({ day: '2026-11-10', from: '10:00', to: '12:30' });
  assert.equal(new Date(args.p_visit_start).getTime(), new Date(2026, 10, 10, 10, 0).getTime());
  assert.deepEqual(choiceFromRange(args.p_visit_start, args.p_visit_end), { day: '2026-11-10', from: '10:00', to: '12:30' });
  assert.equal(choiceFromRange(null, null), null);
  assert.equal(isoDay(now), '2026-11-09');
});

test('a stored window reads "Tomorrow, 10 AM to 12:30 PM"', () => {
  const args = visitArgs({ day: '2026-11-10', from: '10:00', to: '12:30' });
  assert.equal(visitText(args.p_visit_start, args.p_visit_end, now), 'Tomorrow, 10 AM to 12:30 PM');
  assert.equal(visitText(null, null, now), '');
});

test('chips read like a clock', () => {
  assert.deepEqual(['07:00', '12:00', '13:30', '00:30'].map(clockLabel), ['7 AM', '12 PM', '1:30 PM', '12:30 AM']);
});

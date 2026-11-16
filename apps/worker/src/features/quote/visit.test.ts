import assert from 'node:assert/strict';
import { test } from 'node:test';

import { choiceFromRange, clockLabel, dayOptions, defaultVisit, isoDay, timeSlots, visitArgs, visitError, visitText } from './visit.ts';

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

test('today only offers times at least 30 minutes ahead; other days the whole day', () => {
  assert.equal(timeSlots('2026-11-09', now)[0], '11:00');
  assert.equal(timeSlots('2026-11-10', now)[0], '07:00');
  assert.equal(timeSlots('2026-11-10', now).at(-1), '21:00');
  assert.deepEqual(timeSlots('2026-11-09', new Date(2026, 10, 9, 21, 45)), []);
});

test('chip labels', () => {
  assert.equal(clockLabel('09:00'), '9 AM');
  assert.equal(clockLabel('13:30'), '1:30 PM');
  assert.equal(clockLabel('00:00'), '12 AM');
  assert.equal(clockLabel('12:00'), '12 PM');
});

test('the form starts at the customer\'s own day and start time when it is still ahead', () => {
  assert.deepEqual(defaultVisit({ date: '2026-11-12', from: '16:00:00', to: '18:00:00' }, now), { day: '2026-11-12', time: '16:00' });
  // Odd minutes snap up to the next half hour; a customer window's end is ignored.
  assert.deepEqual(defaultVisit({ date: '2026-11-12', from: '16:10:00', to: '17:50:00' }, now), { day: '2026-11-12', time: '16:30' });
});

test('an ASAP job (or a past preference) starts at the next free half hour today', () => {
  assert.deepEqual(defaultVisit(none, now), { day: '2026-11-09', time: '11:00' });
  assert.deepEqual(defaultVisit({ date: '2026-11-01', from: '09:00', to: '11:00' }, now), { day: '2026-11-09', time: '11:00' });
  // Late at night there is nothing left today: tomorrow morning.
  assert.deepEqual(defaultVisit(none, new Date(2026, 10, 9, 21, 45)), { day: '2026-11-10', time: '09:00' });
});

test('the time must be ahead (as the database checks); a malformed day or time is refused too', () => {
  assert.equal(visitError({ day: '2026-11-09', time: '10:00' }, now), 'past');
  assert.equal(visitError({ day: '2026-11-09', time: '10:10' }, now), 'past');
  assert.equal(visitError({ day: '2026-11-08', time: '18:00' }, now), 'past');
  assert.equal(visitError({ day: '2026-11-10', time: '10:00' }, now), null);
  assert.equal(visitError({ day: 'not-a-day', time: '10:00' }, now), 'past');
  assert.equal(visitError({ day: '2026-11-10', time: 'soon' }, now), 'past');
});

test('the visit is sent as exact timestamps, the stored end is one hour later, and it reads back the same', () => {
  const args = visitArgs({ day: '2026-11-10', time: '10:00' });
  assert.equal(new Date(args.p_visit_start).getTime(), new Date(2026, 10, 10, 10, 0).getTime());
  assert.equal(new Date(args.p_visit_end).getTime() - new Date(args.p_visit_start).getTime(), 60 * 60_000);
  assert.deepEqual(choiceFromRange(args.p_visit_start, args.p_visit_end), { day: '2026-11-10', time: '10:00' });
  assert.equal(choiceFromRange(null, null), null);
  assert.equal(choiceFromRange('garbage'), null);
  assert.equal(isoDay(now), '2026-11-09');
});

test('a stored visit reads "Tomorrow, 10 AM": one time, no range', () => {
  const args = visitArgs({ day: '2026-11-10', time: '10:00' });
  assert.equal(visitText(args.p_visit_start, args.p_visit_end, now), 'Tomorrow, 10 AM');
  assert.equal(visitText(visitArgs({ day: '2026-11-09', time: '16:30' }).p_visit_start, null, now), 'Today, 4:30 PM');
  assert.equal(visitText(null, null, now), '');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activityMissing, idleExpired, idleLimitMs, IDLE_LIMIT_MS, parseActive, shouldTouch, staleActive, touchIntervalMs } from './idle.ts';

const NOW = 1_800_000_000_000;
const THIRTY = 30 * 60_000;

test('with a 30-minute limit (tests only), idle for more is expired, idle for less is not', () => {
  assert.equal(idleExpired(NOW - 31 * 60_000, NOW, THIRTY), true);
  assert.equal(idleExpired(NOW - 29 * 60_000, NOW, THIRTY), false);
  assert.equal(idleExpired(NOW - THIRTY, NOW, THIRTY), false);
});

test('by default nobody is ever idle (sessions do not expire)', () => {
  assert.equal(idleExpired(NOW - 365 * 24 * 3_600_000, NOW), false);
  assert.equal(Number.isFinite(idleLimitMs(undefined)), false);
});

test('no recorded activity yet is not idle (the first request sets it)', () => {
  assert.equal(idleExpired(null, NOW), false);
  assert.equal(idleExpired(Number.NaN, NOW), false);
});

test('idle logout is off unless a test sets a limit of 5 seconds or more', () => {
  assert.equal(idleLimitMs(undefined), IDLE_LIMIT_MS);
  assert.equal(idleLimitMs('60'), 60_000);
  assert.equal(idleLimitMs('999999'), 999_999_000);
  assert.equal(idleLimitMs('abc'), IDLE_LIMIT_MS);
  assert.equal(idleLimitMs('1'), IDLE_LIMIT_MS);
});

test('the cookie value is a plain millisecond timestamp or nothing', () => {
  assert.equal(parseActive('1800000000000'), 1_800_000_000_000);
  for (const bad of [undefined, '', 'x', '12', '1e12', '-1800000000000', '1800000000000.5']) assert.equal(parseActive(bad), null);
});

test('a short test limit refreshes the cookie more often, the real limit once a minute', () => {
  assert.equal(touchIntervalMs(IDLE_LIMIT_MS), 60_000);
  assert.equal(touchIntervalMs(20_000), 6_666);
  assert.equal(shouldTouch(NOW - 7_000, NOW, touchIntervalMs(20_000)), true);
});

test('the cookie is rewritten at most once a minute', () => {
  assert.equal(shouldTouch(null, NOW), true);
  assert.equal(shouldTouch(NOW - 30_000, NOW), false);
  assert.equal(shouldTouch(NOW - 61_000, NOW), true);
});

test('a leftover activity time is cleared when nobody is signed in (so the next sign-in is not signed straight out)', () => {
  assert.equal(staleActive(false, NOW - 5 * 60 * 60 * 1000), true);
  assert.equal(staleActive(false, null), false);
  assert.equal(staleActive(true, NOW - 5 * 60 * 60 * 1000), false);
  assert.equal(staleActive(true, null), false);
});

test('a signed-in session without an activity cookie must end; a signed-out visitor is not affected', () => {
  assert.equal(activityMissing(true, null), true);
  assert.equal(activityMissing(true, Number.NaN), true);
  assert.equal(activityMissing(true, NOW), false);
  assert.equal(activityMissing(false, null), false);
});

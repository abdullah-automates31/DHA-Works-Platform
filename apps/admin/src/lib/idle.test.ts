import assert from 'node:assert/strict';
import { test } from 'node:test';
import { idleExpired, idleLimitMs, IDLE_LIMIT_MS, parseActive, shouldTouch, touchIntervalMs } from './idle.ts';

const NOW = 1_800_000_000_000;

test('a person idle for more than 30 minutes is expired, one idle for less is not', () => {
  assert.equal(idleExpired(NOW - 31 * 60_000, NOW), true);
  assert.equal(idleExpired(NOW - 29 * 60_000, NOW), false);
  assert.equal(idleExpired(NOW - IDLE_LIMIT_MS, NOW), false);
});

test('no recorded activity yet is not idle (the first request sets it)', () => {
  assert.equal(idleExpired(null, NOW), false);
  assert.equal(idleExpired(Number.NaN, NOW), false);
});

test('the test limit can be shorter but never longer than 30 minutes', () => {
  assert.equal(idleLimitMs(undefined), IDLE_LIMIT_MS);
  assert.equal(idleLimitMs('60'), 60_000);
  assert.equal(idleLimitMs('999999'), IDLE_LIMIT_MS);
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

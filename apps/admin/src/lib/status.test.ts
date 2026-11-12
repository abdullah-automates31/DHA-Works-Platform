import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStatus, statusFailure } from './status.ts';

test('only the two known statuses are trusted', () => {
  assert.equal(parseStatus('verified'), 'verified');
  assert.equal(parseStatus('needs_code'), 'needs_code');
  assert.equal(parseStatus('admin'), 'not_admin');
  assert.equal(parseStatus(null), 'not_admin');
});

test('a failed status check is not the same as "not an admin"', () => {
  assert.equal(statusFailure(null), null);
  assert.equal(statusFailure(undefined), null);
  assert.equal(statusFailure({ code: 'PGRST301' }), 'signin'); // JWT expired or rejected
  assert.equal(statusFailure({ code: '42501' }), 'signin'); // permission denied
  assert.equal(statusFailure({ code: '28000' }), 'signin'); // not signed in
  assert.equal(statusFailure({ code: '57014' }), 'unavailable'); // timeout
  assert.equal(statusFailure({ code: '' }), 'unavailable'); // network failure, no code
  assert.equal(statusFailure({}), 'unavailable');
});

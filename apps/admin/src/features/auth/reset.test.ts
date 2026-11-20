import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkResetPassword, confirmOutcome, requestOutcome } from './reset.ts';

test('request: only a plain "sent" from the function counts as sent', () => {
  assert.deepEqual(requestOutcome('sent', 200), { ok: true });
  for (const [status, http] of [['sent', 500], ['sent', 502], [undefined, 200], ['hacked', 200], [null, 200], ['', 200], [5, 200]] as const) {
    const r = requestOutcome(status, http);
    assert.equal(r.ok, false, `${String(status)} ${http}`);
  }
});

test('request: each answer has its own plain message', () => {
  const msg = (s: unknown, h = 200) => {
    const r = requestOutcome(s, h);
    return r.ok ? 'OK' : r.error;
  };
  assert.match(msg('not_admin'), /not registered as an admin/);
  assert.match(msg('wait'), /Wait a minute/);
  assert.match(msg('limit'), /Try again later/);
  assert.match(msg(undefined, 403), /security check/);
  assert.match(msg(undefined, 400), /valid email/);
  assert.match(msg('mail_failed', 502), /could not be sent/);
  assert.match(msg(undefined, 500), /could not be sent/);
});

test('confirm: only "ok" with HTTP 200 finishes the reset', () => {
  assert.deepEqual(confirmOutcome('ok', 200), { done: true });
  for (const [s, h] of [['ok', 500], ['ok', 400], [undefined, 200], ['OK', 200], [true, 200], ['', 200]] as const) {
    assert.equal(confirmOutcome(s, h).done, false, `${String(s)} ${h}`);
  }
});

test('confirm: locked, expired and none send the person back to ask for a new code; wrong and weak do not', () => {
  for (const s of ['locked', 'expired', 'none']) {
    const r = confirmOutcome(s, 200);
    assert.ok(!r.done && r.restart === true, s);
  }
  for (const s of ['wrong', 'weak']) {
    const r = confirmOutcome(s, 200);
    assert.ok(!r.done && !r.restart, s);
  }
  const weak = confirmOutcome('weak', 200);
  assert.ok(!weak.done && /12 to 72/.test(weak.error));
});

test('new password: 12 to 72 bytes and the same twice', () => {
  assert.equal(checkResetPassword('a long enough password', 'a long enough password'), null);
  assert.match(String(checkResetPassword('short', 'short')), /at least 12/);
  assert.match(String(checkResetPassword('a long enough password', 'a long enough passwor')), /not the same/);
  assert.match(String(checkResetPassword('x'.repeat(73), 'x'.repeat(73))), /72 characters at most/);
  assert.match(String(checkResetPassword('é'.repeat(37), 'é'.repeat(37))), /72 characters at most/); // 74 bytes
  assert.match(String(checkResetPassword(undefined, undefined)), /twice/);
  assert.match(String(checkResetPassword('a long enough password', 5)), /twice/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { confirmPhoneChange, requestPhoneChange, type PhoneClient } from './phone.ts';

function client(update: unknown = { error: null }, verify: unknown = { error: null }) {
  const calls: string[] = [];
  const c: PhoneClient = {
    updatePhone: (p) => {
      calls.push(`update:${p}`);
      if (update === 'throw') return Promise.reject(new TypeError('Network request failed'));
      return Promise.resolve(update as { error: null });
    },
    verifyChange: (p, t) => {
      calls.push(`verify:${p}:${t}`);
      return Promise.resolve(verify as { error: null });
    },
  };
  return { c, calls };
}

test('a good new number starts the change with the number in international form', async () => {
  const { c, calls } = client();
  assert.deepEqual(await requestPhoneChange(c, '0300 1234567'.replace('0300', '0321'), '+923001111111'), { ok: true, phone: '+923211234567' });
  assert.deepEqual(calls, ['update:+923211234567']);
});

test('a bad number or the number already on the account never reaches the server', async () => {
  const a = client();
  assert.deepEqual(await requestPhoneChange(a.c, '12345', '+923001111111'), { ok: false, key: 'settings.errors.phoneInvalid' });
  assert.deepEqual(await requestPhoneChange(a.c, '03001111111', '+923001111111'), { ok: false, key: 'settings.errors.phoneSame' });
  assert.deepEqual(a.calls, []);
});

test('a number that belongs to another account is told apart from other failures', async () => {
  const taken = client({ error: { code: 'phone_exists', status: 422, message: 'Phone number already registered' } });
  assert.deepEqual(await requestPhoneChange(taken.c, '03211234567', '+923001111111'), { ok: false, key: 'settings.errors.phoneTaken' });
  const limited = client({ error: { code: 'over_sms_send_rate_limit', status: 429 } });
  assert.deepEqual(await requestPhoneChange(limited.c, '03211234567', null), { ok: false, key: 'auth.errors.tooManyRequests' });
});

test('a network failure is reported, not thrown', async () => {
  assert.deepEqual(await requestPhoneChange(client('throw').c, '03211234567', null), { ok: false, key: 'auth.errors.network' });
});

test('the code step: a malformed code is refused locally, a wrong code by the server, a right code succeeds', async () => {
  const a = client();
  assert.deepEqual(await confirmPhoneChange(a.c, '+923211234567', '12'), { ok: false, key: 'auth.errors.wrongOrExpiredCode' });
  assert.deepEqual(a.calls, []);
  const wrong = client(undefined, { error: { code: 'otp_expired', status: 403 } });
  assert.deepEqual(await confirmPhoneChange(wrong.c, '+923211234567', '123456'), { ok: false, key: 'auth.errors.wrongOrExpiredCode' });
  const ok = client();
  assert.deepEqual(await confirmPhoneChange(ok.c, '+923211234567', '123456'), { ok: true, phone: '+923211234567' });
  assert.deepEqual(ok.calls, ['verify:+923211234567:123456']);
});

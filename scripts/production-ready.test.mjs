import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkProductionReady } from './lib/production-ready.mjs';

const GOOD = `[auth.rate_limit]
sign_in_sign_ups = 10
token_verifications = 10
[auth.captcha]
enabled = true
[auth.sms]
max_frequency = "60s"
[auth.sms.twilio_verify]
enabled = true
account_sid = "env(A)"
message_service_sid = "env(B)"
auth_token = "env(C)"
[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true
[auth.sessions]
inactivity_timeout = "8h"
`;
const codes = (t) => checkProductionReady(t).map((i) => i.code);

test('a fully hardened config has no blockers', () => assert.deepEqual(codes(GOOD), []));
test('default rate limits block production', () => {
  assert.deepEqual(codes(GOOD.replace('sign_in_sign_ups = 10', 'sign_in_sign_ups = 30').replace('token_verifications = 10', 'token_verifications = 30')), ['RATE_SIGN_IN', 'RATE_VERIFY']);
});
test('a fast resend, no captcha, no Twilio Verify and no session limit each block', () => {
  const bad = GOOD.replace('"60s"', '"5s"').replace('[auth.captcha]\nenabled = true', '').replace('[auth.sms.twilio_verify]\nenabled = true', '[auth.sms.twilio_verify]\nenabled = false').replace('inactivity_timeout = "8h"', '');
  assert.deepEqual(codes(bad), ['SMS_FREQUENCY', 'NO_CAPTCHA', 'NO_TWILIO_VERIFY', 'NO_SESSION_LIMIT']);
});
test('the admin portal signs in with an authenticator app, so production needs [auth.mfa.totp] on', () => {
  assert.deepEqual(codes(GOOD.replace('enroll_enabled = true', 'enroll_enabled = false')), ['ADMIN_2FA_TOTP']);
  assert.deepEqual(codes(GOOD.replace('verify_enabled = true', 'verify_enabled = false')), ['ADMIN_2FA_TOTP']);
  assert.deepEqual(codes(GOOD.replace('[auth.mfa.totp]\nenroll_enabled = true\nverify_enabled = true\n', '')), ['ADMIN_2FA_TOTP']);
});
test('static test OTPs block production too', () => assert.ok(codes(`${GOOD}\n[auth.sms.test_otp]\n923001234567 = "123456"\n`).includes('TEST_OTP')));
test('a missing rate limit is a blocker, not a pass', () => assert.ok(codes('[auth]\n').includes('RATE_VERIFY')));

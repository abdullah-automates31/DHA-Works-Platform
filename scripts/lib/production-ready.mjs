// What must be true of the shared Supabase config before a production project is created (docs/SECURITY.md section 15).
// Pure function, unit tested. It reads only the tracked config; the hosted dashboard values (rate limits, SMS expiry,
// test OTP numbers) must be checked by hand or with scripts/challenge-guess-hosted.mjs.
import { checkSharedConfig, parseTables } from './config-guard.mjs';

const seconds = (v) => {
  const m = String(v ?? '').match(/^(\d+)\s*(s|m|h)?$/);
  return m ? Number(m[1]) * ({ s: 1, m: 60, h: 3600 }[m[2] ?? 's']) : NaN;
};

export function checkProductionReady(text) {
  const issues = [...checkSharedConfig(text)];
  const t = parseTables(text);
  const rl = t['auth.rate_limit'] ?? {};
  if (!(Number(rl.sign_in_sign_ups) <= 10)) issues.push({ code: 'RATE_SIGN_IN', message: 'auth.rate_limit.sign_in_sign_ups must be 10 or less' });
  if (!(Number(rl.token_verifications) <= 10)) issues.push({ code: 'RATE_VERIFY', message: 'auth.rate_limit.token_verifications must be 10 or less' });
  if (!(seconds(t['auth.sms']?.max_frequency) >= 60)) issues.push({ code: 'SMS_FREQUENCY', message: 'auth.sms.max_frequency must be 60s or more' });
  if (t['auth.captcha']?.enabled !== 'true') issues.push({ code: 'NO_CAPTCHA', message: 'auth.captcha is not enabled (hCaptcha or Turnstile)' });
  if (t['auth.sms.twilio_verify']?.enabled !== 'true') issues.push({ code: 'NO_TWILIO_VERIFY', message: 'auth.sms.twilio_verify is not enabled (limits wrong guesses to 5 per code)' });
  // The admin portal's second step is an emailed code (migration 0037) as the interim second factor (authenticator-app MFA is free on every Supabase plan, so moving to it is a product decision).
  // That is acceptable for DEV; production should move to TOTP, which is what these two switches turn on.
  if (t['auth.mfa.totp']?.enroll_enabled !== 'true' || t['auth.mfa.totp']?.verify_enabled !== 'true') {
    issues.push({ code: 'ADMIN_2FA_EMAIL', message: 'admin second factor is the interim emailed code; enable [auth.mfa.totp] (authenticator app) before production' });
  }
  if (t['auth.sessions']?.inactivity_timeout === undefined && t['auth.sessions']?.timebox === undefined) {
    issues.push({ code: 'NO_SESSION_LIMIT', message: 'auth.sessions has no timebox or inactivity_timeout (needs a plan that supports it)' });
  }
  return issues;
}

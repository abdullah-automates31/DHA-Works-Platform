import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base32Decode, totp } from './totp.mjs';

// RFC 6238 appendix B, SHA-1, secret "12345678901234567890" (base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ); the RFC lists 8 digits, we use the last 6.
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
test('RFC 6238 test vectors (last six digits)', () => {
  assert.equal(totp(SECRET, 59_000), '287082');
  assert.equal(totp(SECRET, 1_111_111_109_000), '081804');
  assert.equal(totp(SECRET, 1_111_111_111_000), '050471');
  assert.equal(totp(SECRET, 1_234_567_890_000), '005924');
  assert.equal(totp(SECRET, 2_000_000_000_000), '279037');
});
test('base32 decoding ignores case, spaces and padding', () => {
  assert.equal(base32Decode('mzxw6===').toString(), 'foo');
  assert.equal(base32Decode('MZXW 6YTB').toString(), 'fooba');
  assert.throws(() => base32Decode('1!'));
});
test('a step offset moves one window', () => {
  assert.notEqual(totp(SECRET, 59_000), totp(SECRET, 59_000, 1));
  assert.equal(totp(SECRET, 59_000, 1), totp(SECRET, 89_000));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanCode, cleanEmail, codeMessage, factorName, markMessage, registerMessage, sendMessage, totpVerifyMessage, validPassword } from './messages.ts';

test('emails are trimmed and lower-cased; junk and oversize values are refused', () => {
  assert.equal(cleanEmail('  Staff@DHA-Works.Example '), 'staff@dha-works.example');
  for (const bad of ['', 'a', 'a@b', 'a b@c.de', '@x.com', 'a@@b.com', null, undefined, 5, {}, 'x'.repeat(250) + '@a.bc']) {
    assert.equal(cleanEmail(bad), null, String(bad));
  }
});

test('passwords are only length-checked, never altered', () => {
  assert.equal(validPassword(' spaced pass '), true);
  for (const bad of ['', null, undefined, 1, 'x'.repeat(201)]) assert.equal(validPassword(bad), false);
});

test('a code is exactly six digits, spaces ignored', () => {
  assert.equal(cleanCode('482 913'), '482913');
  for (const bad of ['12345', '1234567', 'abcdef', '12345a', '', null, 123456, '١٢٣٤٥٦']) assert.equal(cleanCode(bad), null, String(bad));
});

test('every code status has a message and unknown ones are treated as wrong', () => {
  assert.match(codeMessage('locked'), /Too many/);
  assert.match(codeMessage('expired'), /expired/);
  assert.match(codeMessage('none'), /no open code/);
  assert.match(codeMessage('wrong'), /not right/);
  assert.match(codeMessage('ok'), /not right/); // 'ok' never reaches here; if it did it must not read as success
  assert.match(codeMessage(undefined), /not right/);
});

test('send errors never reveal whether an account exists', () => {
  assert.match(sendMessage(429), /Wait a minute/);
  assert.match(sendMessage(403), /Sign in again/);
  assert.match(sendMessage(502), /could not be sent/);
  assert.doesNotMatch(sendMessage(403) + sendMessage(502), /admin account|not an admin/i);
});

test('authenticator messages: each answer has a plain sentence and unknown ones read as "try again"', () => {
  assert.match(markMessage('locked'), /15 minutes/);
  assert.match(markMessage('not_ready'), /could not be used/);
  assert.match(markMessage(undefined), /Try again/);
  assert.match(totpVerifyMessage({ status: 429 }), /Too many tries/);
  assert.match(totpVerifyMessage({ code: 'mfa_verification_failed', status: 422 }), /not right/);
  assert.match(totpVerifyMessage(null), /not right/);
  assert.match(registerMessage('proof'), /emailed code/);
  assert.match(registerMessage('invalid'), /Start the setup again/);
});

test('factor names are different every time', () => {
  assert.notEqual(factorName(1_000_000), factorName(1_000_001));
  assert.match(factorName(), /^DHA Works [0-9a-z]+$/);
});

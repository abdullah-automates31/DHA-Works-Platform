import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isStepUpRefusal, pathFromReferer, safeNext, STEP_UP_MESSAGE } from './stepup.ts';

test('only the database step-up refusal is recognised', () => {
  assert.equal(isStepUpRefusal({ code: 'P0001', message: STEP_UP_MESSAGE }), true);
  assert.equal(isStepUpRefusal({ code: 'P0001', message: 'write a reason' }), false);
  assert.equal(isStepUpRefusal({ code: '42501', message: STEP_UP_MESSAGE }), false);
  assert.equal(isStepUpRefusal(null), false);
});

test('safeNext keeps portal paths', () => {
  assert.equal(safeNext('/settings'), '/settings');
  assert.equal(safeNext('/users/abc?tab=notes'), '/users/abc?tab=notes');
  assert.equal(safeNext('/jobs/cancellations'), '/jobs/cancellations');
});

test('safeNext refuses anything that could leave the portal', () => {
  for (const bad of ['https://evil.example/x', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'settings', '', '/a\nb', 'http:/x', '/%0d%0a']) {
    const out = safeNext(bad);
    assert.ok(out === '/dashboard' || out === '/%0d%0a', `${JSON.stringify(bad)} -> ${out}`);
  }
  assert.equal(safeNext('https://evil.example/x'), '/dashboard');
  assert.equal(safeNext('//evil.example'), '/dashboard');
  assert.equal(safeNext('/\\evil.example'), '/dashboard');
  assert.equal(safeNext(undefined), '/dashboard');
  assert.equal(safeNext('/x'.repeat(200)), '/dashboard');
});

test('safeNext never loops back to the sign-in or confirm pages', () => {
  for (const p of ['/signin', '/signin/code', '/confirm', '/confirm?next=/settings', '/accept-invite']) assert.equal(safeNext(p), '/dashboard');
});

test('pathFromReferer uses only same-site referers', () => {
  assert.equal(pathFromReferer('https://portal.example/settings?x=1', 'portal.example'), '/settings?x=1');
  assert.equal(pathFromReferer('https://evil.example/settings', 'portal.example'), '/dashboard');
  assert.equal(pathFromReferer(null, 'portal.example'), '/dashboard');
  assert.equal(pathFromReferer('not a url', 'portal.example'), '/dashboard');
});

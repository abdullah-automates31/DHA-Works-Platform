import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentSecurityPolicy, makeNonce, securityHeaders } from './security-headers.ts';

const get = (h: { key: string; value: string }[], k: string) => h.find((x) => x.key === k)?.value ?? '';

test('production policy forbids framing, plugins, inline scripts and foreign origins', () => {
  const csp = contentSecurityPolicy('https://abc.supabase.co/', false, 'N0nce');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /connect-src 'self' https:\/\/abc\.supabase\.co/);
  assert.match(csp, /script-src 'self' 'nonce-N0nce' 'strict-dynamic'/);
  assert.match(csp, /upgrade-insecure-requests/);
  const script = csp.split('; ').find((d) => d.startsWith('script-src')) ?? '';
  assert.doesNotMatch(script, /unsafe-inline/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.doesNotMatch(csp, /ws:/);
});

test('the other headers are set and the CSP is not duplicated here', () => {
  const h = securityHeaders();
  assert.equal(get(h, 'Content-Security-Policy'), '');
  assert.equal(get(h, 'X-Frame-Options'), 'DENY');
  assert.equal(get(h, 'X-Content-Type-Options'), 'nosniff');
  assert.equal(get(h, 'Referrer-Policy'), 'no-referrer');
  assert.equal(get(h, 'Cross-Origin-Resource-Policy'), 'same-origin');
  assert.match(get(h, 'Strict-Transport-Security'), /max-age=\d{8,}/);
  assert.equal(get(h, 'Cache-Control'), 'no-store');
});

test('development additionally allows eval and websockets for hot reload only', () => {
  const csp = contentSecurityPolicy('http://127.0.0.1:55321', true, 'x');
  assert.match(csp, /unsafe-eval/);
  assert.match(csp, /ws:/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/);
});

test('a missing or broken Supabase URL never widens the policy', () => {
  for (const bad of ['', 'not a url', '*']) {
    const csp = contentSecurityPolicy(bad, false, 'x');
    assert.doesNotMatch(csp, /\*/);
    assert.match(csp, /img-src 'self' data: blob:;/);
  }
});

test('every nonce is new and long enough to be unguessable', () => {
  const a = makeNonce();
  const b = makeNonce();
  assert.notEqual(a, b);
  assert.ok(a.length >= 22);
});

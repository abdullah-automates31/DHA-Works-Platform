import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSiteverify, turnstileMode, verifyTurnstile } from './turnstile.ts';

const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test('a configured secret always requires the check; no secret is open only outside production', () => {
  assert.equal(turnstileMode('s3cret', 'production'), 'required');
  assert.equal(turnstileMode('s3cret', 'development'), 'required');
  assert.equal(turnstileMode(undefined, 'development'), 'off');
  assert.equal(turnstileMode('', 'test'), 'off');
  assert.equal(turnstileMode(undefined, 'production'), 'required');
});

test('only an explicit success counts', () => {
  assert.deepEqual(parseSiteverify({ success: true }), { ok: true });
  for (const bad of [{ success: false }, { success: 'true' }, {}, null, 'ok', 1, []]) assert.deepEqual(parseSiteverify(bad), { ok: false });
});

test('with no secret outside production the check is skipped', async () => {
  assert.equal(await verifyTurnstile({ fetch: ok({}), secret: undefined, nodeEnv: 'development' }, undefined, null), true);
});

test('production without a secret refuses everyone', async () => {
  assert.equal(await verifyTurnstile({ fetch: ok({ success: true }), secret: undefined, nodeEnv: 'production' }, 'tok', null), false);
});

test('a good token passes, a bad or missing token fails', async () => {
  assert.equal(await verifyTurnstile({ fetch: ok({ success: true }), secret: 's', nodeEnv: 'production' }, 'tok', '1.2.3.4'), true);
  assert.equal(await verifyTurnstile({ fetch: ok({ success: false }), secret: 's', nodeEnv: 'production' }, 'tok', null), false);
  assert.equal(await verifyTurnstile({ fetch: ok({ success: true }), secret: 's', nodeEnv: 'production' }, undefined, null), false);
  assert.equal(await verifyTurnstile({ fetch: ok({ success: true }), secret: 's', nodeEnv: 'production' }, '', null), false);
  assert.equal(await verifyTurnstile({ fetch: ok({ success: true }), secret: 's', nodeEnv: 'production' }, 'x'.repeat(3000), null), false);
});

test('a server error or an unreachable Cloudflare fails closed', async () => {
  assert.equal(await verifyTurnstile({ fetch: ok({ success: true }, 500), secret: 's', nodeEnv: 'production' }, 'tok', null), false);
  const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  assert.equal(await verifyTurnstile({ fetch: down, secret: 's', nodeEnv: 'production' }, 'tok', null), false);
});

test('the request carries the secret, the token and the address', async () => {
  let seen: URLSearchParams | null = null;
  const spy = (async (_u: unknown, init: RequestInit) => {
    seen = init.body as URLSearchParams;
    return new Response(JSON.stringify({ success: true }));
  }) as unknown as typeof fetch;
  await verifyTurnstile({ fetch: spy, secret: 'sec', nodeEnv: 'production' }, 'tok', '9.9.9.9');
  assert.equal((seen as unknown as URLSearchParams).get('secret'), 'sec');
  assert.equal((seen as unknown as URLSearchParams).get('response'), 'tok');
  assert.equal((seen as unknown as URLSearchParams).get('remoteip'), '9.9.9.9');
});

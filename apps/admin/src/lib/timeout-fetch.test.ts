import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timeoutFetch } from './timeout-fetch.ts';

// A fake network call that only ends when it is cancelled.
const hang = ((_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
  })) as typeof fetch;

// AbortSignal.timeout does not keep Node alive by itself (a real network call does), so the tests hold a timer.
const keepAlive = () => {
  const t = setInterval(() => {}, 20);
  return () => clearInterval(t);
};

test('a call that never answers is cancelled after the limit', async () => {
  const stop = keepAlive();
  const started = Date.now();
  try {
    await assert.rejects(timeoutFetch(50, hang)('https://example.test/x'));
  } finally {
    stop();
  }
  assert.ok(Date.now() - started < 1000, 'gave up quickly');
});

test('a call that answers in time is untouched', async () => {
  const ok = (async () => new Response('fine', { status: 200 })) as unknown as typeof fetch;
  const res = await timeoutFetch(1000, ok)('https://example.test/x');
  assert.equal(await res.text(), 'fine');
});

test('a signal passed by the caller still cancels the call', async () => {
  const controller = new AbortController();
  const stop = keepAlive();
  const pending = timeoutFetch(10_000, hang)('https://example.test/x', { signal: controller.signal });
  controller.abort();
  try {
    await assert.rejects(pending);
  } finally {
    stop();
  }
});

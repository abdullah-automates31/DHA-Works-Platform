import assert from 'node:assert/strict';
import { test } from 'node:test';

import { saveProfilePhoto, type PhotoClient } from './photo.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const bytes = new ArrayBuffer(2000);

function client(over: Partial<{ upload: unknown; setAvatar: unknown }> = {}) {
  const calls: string[] = [];
  const c: PhotoClient = {
    upload: (path) => {
      calls.push(`upload:${path}`);
      return Promise.resolve((over.upload as { error: null }) ?? { error: null });
    },
    setAvatar: (path) => {
      calls.push(`avatar:${path}`);
      return Promise.resolve((over.setAvatar as { error: null }) ?? { error: null });
    },
  };
  return { c, calls };
}

test('uploads into the worker own folder first, then points the profile at it', async () => {
  const { c, calls } = client();
  const result = await saveProfilePhoto(c, { userId: USER, mime: 'image/jpeg', bytes, now: 5, random: 'ab' });
  assert.deepEqual(result, { ok: true, path: `${USER}/profile_photo-5-ab.jpg` });
  assert.deepEqual(calls, [`upload:${USER}/profile_photo-5-ab.jpg`, `avatar:${USER}/profile_photo-5-ab.jpg`]);
});

test('a wrong type or an empty or huge file never reaches the server', async () => {
  for (const [mime, size, key] of [
    ['application/pdf', 100, 'settings.errors.photoType'],
    ['image/jpeg', 0, 'settings.errors.photoType'],
    ['image/jpeg', 6 * 1024 * 1024, 'settings.errors.photoSize'],
  ] as const) {
    const { c, calls } = client();
    const result = await saveProfilePhoto(c, { userId: USER, mime, bytes: new ArrayBuffer(size) });
    assert.deepEqual(result, { ok: false, key });
    assert.deepEqual(calls, []);
  }
});

test('if the upload fails the profile is not changed', async () => {
  const { c, calls } = client({ upload: { error: { message: 'boom' } } });
  const result = await saveProfilePhoto(c, { userId: USER, mime: 'image/jpeg', bytes, now: 1, random: 'x' });
  assert.deepEqual(result, { ok: false, key: 'settings.errors.generic' });
  assert.equal(calls.some((x) => x.startsWith('avatar:')), false);
});

test('a server size refusal and a network failure get their own messages', async () => {
  const big = await saveProfilePhoto(client({ upload: { error: { message: 'The object exceeded the maximum allowed size', statusCode: 413 } } }).c, { userId: USER, mime: 'image/jpeg', bytes });
  assert.deepEqual(big, { ok: false, key: 'settings.errors.photoSize' });
  const net: PhotoClient = { upload: () => Promise.reject(new TypeError('Network request failed')), setAvatar: () => Promise.resolve({ error: null }) };
  assert.deepEqual(await saveProfilePhoto(net, { userId: USER, mime: 'image/jpeg', bytes }), { ok: false, key: 'settings.errors.network' });
});

test('a refused profile update is reported', async () => {
  const { c } = client({ setAvatar: { error: { message: 'invalid file path' } } });
  assert.deepEqual(await saveProfilePhoto(c, { userId: USER, mime: 'image/png', bytes }), { ok: false, key: 'settings.errors.generic' });
});

test('a picture in memory becomes a data link for the preview', async () => {
  const { toDataUri } = await import('./photo.ts');
  assert.equal(toDataUri(new Uint8Array([104, 105]).buffer), 'data:image/jpeg;base64,aGk=');
  assert.equal(toDataUri(new ArrayBuffer(70000)).startsWith('data:image/jpeg;base64,'), true);
});

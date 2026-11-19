import assert from 'node:assert/strict';
import { test } from 'node:test';
import { avatarSrc } from './avatars.ts';

const ID = '11111111-1111-4111-8111-111111111111';

test('a normal picture path becomes a same-origin address, encoded', () => {
  assert.equal(avatarSrc(`${ID}/profile_photo-1-ab.jpg`), `/avatar?p=${encodeURIComponent(`${ID}/profile_photo-1-ab.jpg`)}`);
});

test('missing, odd or dangerous paths give no address (the initials stay)', () => {
  for (const bad of [null, undefined, '', 'x', `${ID}/../other/a.jpg`, `../${ID}/a.jpg`, `${ID}/a/b.jpg`, 'https://evil.example/a.jpg', `${ID}/a b.jpg`]) {
    assert.equal(avatarSrc(bad as string | null | undefined), null, String(bad));
  }
});

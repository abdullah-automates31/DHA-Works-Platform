import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Guards the Android release settings of docs/SECURITY.md section 18: a future edit of app.base.json must not quietly
// switch a protection off. The merged manifest was also checked by hand with `expo prebuild` (11 Nov 2026).
type Plugin = string | [string, Record<string, unknown>];
const base = JSON.parse(readFileSync(new URL('../../app.base.json', import.meta.url), 'utf8')) as {
  expo: { android: { allowBackup?: boolean; blockedPermissions?: string[] }; plugins: Plugin[] };
};

function buildProperties(): Record<string, unknown> {
  const entry = base.expo.plugins.find((p): p is [string, Record<string, unknown>] => Array.isArray(p) && p[0] === 'expo-build-properties');
  assert.ok(entry, 'expo-build-properties is configured');
  return (entry[1].android ?? {}) as Record<string, unknown>;
}

test('Android backup is off, so the session and cached photos never leave the phone through a backup', () => {
  assert.equal(base.expo.android.allowBackup, false);
});

test('plain-http traffic is switched off in the build', () => {
  assert.equal(buildProperties().usesCleartextTraffic, false);
});

test('release builds shrink and obfuscate code and resources', () => {
  assert.equal(buildProperties().enableProguardInReleaseBuilds, true);
  assert.equal(buildProperties().enableShrinkResourcesInReleaseBuilds, true);
});

test('permissions the app never needs are blocked', () => {
  const blocked = base.expo.android.blockedPermissions ?? [];
  assert.ok(blocked.includes('android.permission.SYSTEM_ALERT_WINDOW'), 'no drawing over other apps');
  assert.ok(blocked.includes('android.permission.WRITE_EXTERNAL_STORAGE'), 'no shared-storage writes');
});

test('the session is kept in the secure store plugin, not plain storage', () => {
  assert.ok(base.expo.plugins.includes('expo-secure-store'));
});

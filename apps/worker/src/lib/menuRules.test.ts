import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// Shariq, 26 Nov: no item may sit in two places. Profile is "me and my work today"; Settings is the one home of account, help and
// signing out; Help and support is the one home of getting help. These read the source so the duplicates cannot creep back.

const SRC = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');
const PROFILE = read('app/(app)/(tabs)/profile.tsx');
const SETTINGS = read('app/(app)/settings.tsx');
const HELP = read('app/(app)/help.tsx');
const HOME = read('app/(app)/(tabs)/home.tsx');

test('signing out lives in Settings only', () => {
  assert.ok(/signOut\(\)/.test(SETTINGS), 'Settings can sign out');
  assert.ok(!/signOut/.test(PROFILE), 'the Profile menu has no Sign out');
  assert.ok(!/signOut/.test(HELP), 'Help has no Sign out');
});

test('the Profile menu does not repeat what Settings already has', () => {
  for (const repeated of ["'/help'", "'/areas'", 'setReminders', 'saveTrades', "'profile.help'", "'profile.signOut'", "'profile.category'", "'profile.areas'"]) {
    assert.ok(!PROFILE.includes(repeated), `Profile must not contain ${repeated}: it lives in Settings`);
  }
  assert.ok(PROFILE.includes("router.push('/settings')"), 'Profile links to Settings');
});

test('Settings has one Help and support row, not several overlapping ones', () => {
  assert.ok(SETTINGS.includes("router.push('/help')"), 'one row opens Help and support');
  assert.ok(!SETTINGS.includes("router.push('/settings/support')"), 'messaging DHA is reached from Help and support');
  assert.ok(!SETTINGS.includes("router.push('/report')"), 'Report a problem is reached from Help and support');
  assert.ok(!SETTINGS.includes('verificationHelp'), 'a second Verification help row is gone');
});

test('Help and support uses the same building blocks as Settings (no separate old look)', () => {
  assert.ok(HELP.includes('SettingsTop') && HELP.includes('NavRow') && HELP.includes('Card'), 'shared Settings parts');
  assert.ok(HELP.includes("'/settings/support'") && HELP.includes("'/report'") && HELP.includes("'/my-reports'"), 'it is the one place to contact DHA and report');
});

test('the Home photo opens the Profile tab', () => {
  assert.ok(/onPress=\{\(\) => router\.navigate\('\/profile'\)\}[^>]*>\s*<ProfilePhoto/.test(HOME), 'the photo is wrapped in a button that opens /profile');
});

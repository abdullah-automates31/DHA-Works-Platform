import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
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

test('the Profile menu does not repeat what Settings already has (the Job reminders switch stays on Profile by choice of the owner)', () => {
  for (const repeated of ["'/help'", "'/areas'", 'saveTrades', "'profile.help'", "'profile.signOut'", "'profile.category'", "'profile.areas'"]) {
    assert.ok(!PROFILE.includes(repeated), `Profile must not contain ${repeated}: it lives in Settings`);
  }
  assert.ok(PROFILE.includes("router.push('/settings')"), 'Profile links to Settings');
  assert.ok(PROFILE.includes('onToggleReminders') && PROFILE.includes("'profile.reminders'"), 'the Job reminders switch is on Profile');
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

test('no screen draws an empty white circle in its header (Shariq, 26 Nov: a white spot top right on Introduction)', () => {
  // The back button is a white 44 px circle. A header balances it with an INVISIBLE spacer; a View that reuses the button's style
  // without a button inside shows as a stray white circle.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx$/.test(name) && /<View style=\{styles\.back\} \/>/.test(readFileSync(path, 'utf8'))) offenders.push(path.slice(SRC.length + 1));
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, [], 'use <View style={{ width: 44, height: 44 }} /> for the empty side of a header');
});

test('a payment card in My Dues opens the payment details (owner, 26 Nov)', () => {
  const dues = read('app/(app)/dues.tsx');
  assert.ok(/function PaymentCard[\s\S]*router\.push\(\{ pathname: '\/dues\/payment\/\[id\]'/.test(dues), 'the card is a button that opens /dues/payment/<id>');
  assert.ok(read('app/(app)/dues/payment/[id].tsx').includes("'/dues/[id]'"), 'each due it paid opens the due screen');
});

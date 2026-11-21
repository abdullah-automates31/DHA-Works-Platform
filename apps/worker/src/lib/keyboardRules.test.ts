import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// Guard for the on-screen keyboard. The app draws edge to edge (edgeToEdgeEnabled in android/gradle.properties), and on
// current Android versions that makes "adjustResize" in the manifest stop moving the screen, so the keyboard covered the
// Submit button. Every KeyboardAvoidingView therefore has to lift the screen on Android too, not only on iOS.

const SRC = join(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx$/.test(name)) out.push(path);
  }
  return out;
}

const FILES = sourceFiles(SRC).map((path) => ({ path: path.slice(SRC.length + 1), text: readFileSync(path, 'utf8') }));

test('no KeyboardAvoidingView lifts the screen on iOS only', () => {
  const offenders = FILES.filter(({ text }) => /behavior=\{\s*Platform\.OS\s*===\s*['"]ios['"]\s*\?\s*['"]padding['"]\s*:\s*undefined\s*\}/.test(text)).map((f) => f.path);
  assert.deepEqual(offenders, [], 'use behavior="padding" so the Submit button stays above the keyboard on Android too');
});

test('every KeyboardAvoidingView sets a behavior', () => {
  const offenders: string[] = [];
  for (const { path, text } of FILES) {
    for (const tag of text.match(/<KeyboardAvoidingView\b[^>]*>/g) ?? []) {
      if (!/behavior=/.test(tag)) offenders.push(path);
    }
  }
  assert.deepEqual(offenders, [], 'a KeyboardAvoidingView without a behavior does nothing on Android');
});

test('every screen with a text field is wrapped so the keyboard lifts it', () => {
  // Screens draw their fields through the shared field components or a TextInput; the file must hold the wrapper
  // itself, or use a layout that does (AuthScreen).
  const FIELDS = /<(TextInput|LabeledInput|PhoneField|NumberField|AuthPhoneField|AboutBox|Field)\b/;
  const WRAPPED = /KeyboardAvoidingView|<AuthScreen\b/;
  const SHARED = new Set(['components/onboarding.tsx', 'components/AuthForm.tsx', 'components/AboutBox.tsx']); // draw the fields; their screens wrap them
  const offenders = FILES.filter(({ path, text }) => path.replaceAll('\\', '/').startsWith('app/') || path.replaceAll('\\', '/').startsWith('components/'))
    .filter(({ path }) => !SHARED.has(path.replaceAll('\\', '/')))
    .filter(({ text }) => FIELDS.test(text) && !WRAPPED.test(text))
    .map((f) => f.path);
  assert.deepEqual(offenders, [], 'wrap the screen in a KeyboardAvoidingView');
});

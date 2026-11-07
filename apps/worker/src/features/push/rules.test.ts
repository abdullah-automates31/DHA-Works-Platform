import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pushDataOf, pushHref } from './rules.ts';

const job = '0b9d3c2e-1f4a-4c5b-9d6e-7f8a9b0c1d2e';

test('a new job opens the Open jobs tab', () => {
  assert.equal(pushHref({ type: 'new_job', job_id: job }), '/open-jobs');
});

test('a push about the worker’s own job opens its status screen', () => {
  assert.equal(pushHref({ type: 'quote_accepted', job_id: job }), `/job/${job}/status`);
  assert.equal(pushHref({ type: 'cash_collected', job_id: job }), `/job/${job}/status`);
});

test('a job the worker can no longer see opens the notification list, like W15', () => {
  assert.equal(pushHref({ type: 'job_cancelled', job_id: job }), '/notifications');
  assert.equal(pushHref({ type: 'quote_rejected', job_id: job }), '/notifications');
  assert.equal(pushHref({ type: 'quote_not_selected', job_id: job }), '/notifications');
});

test('missing or odd data never opens a job', () => {
  assert.equal(pushHref(null), '/notifications');
  assert.equal(pushHref({ type: 'quote_accepted' }), '/notifications');
  assert.equal(pushHref({ type: 'quote_accepted', job_id: '../../etc' }), '/open-jobs');
});

test('push data is read from the content first, then from the Firebase message', () => {
  const drawnBySystem = { notification: { request: { content: { data: { type: 'new_job' } }, trigger: null } } };
  assert.deepEqual(pushDataOf(drawnBySystem), { type: 'new_job' });
  const shownByApp = { notification: { request: { content: { data: {} }, trigger: { remoteMessage: { data: { type: 'job_stuck' } } } } } };
  assert.deepEqual(pushDataOf(shownByApp), { type: 'job_stuck' });
  assert.equal(pushDataOf({ notification: { request: { content: {}, trigger: null } } }), null);
});

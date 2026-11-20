import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MIN_QUERY, moreText, queryFrom, searchState, seeAllHref } from './rules.ts';

test('the query is trimmed, squeezed, capped at 80 and stripped of control characters', () => {
  assert.equal(queryFrom('  Ali   Khan '), 'Ali Khan');
  assert.equal(queryFrom('a\u0000b\nc'), 'a b c');
  assert.equal(queryFrom('x'.repeat(200)).length, 80);
  assert.equal(queryFrom(undefined), '');
  assert.equal(queryFrom(['a']), '');
  assert.equal(queryFrom(42), '');
});

test('one letter does not search; two do', () => {
  assert.equal(MIN_QUERY, 2);
  assert.equal(searchState(''), 'empty');
  assert.equal(searchState('a'), 'short');
  assert.equal(searchState('ab'), 'ready');
});

test('see-all links keep the search and open the right list', () => {
  assert.equal(seeAllHref.workers('Ali'), '/users?q=Ali');
  assert.equal(seeAllHref.residents('Ali'), '/users?role=resident&q=Ali');
  assert.equal(seeAllHref.jobs('DW-20'), '/jobs?q=DW-20');
  assert.equal(seeAllHref.reports('RP-04'), '/reports?tab=all&q=RP-04');
  assert.ok(seeAllHref.workers('a&b=c').includes('a%26b%3Dc'), 'the search cannot add parameters');
});

test('"See all N" only when there is more than is shown', () => {
  assert.equal(moreText(12, 5), 'See all 12');
  assert.equal(moreText(5, 5), null);
  assert.equal(moreText(0, 0), null);
});

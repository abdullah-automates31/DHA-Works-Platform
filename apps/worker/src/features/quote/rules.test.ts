import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  amountDigits,
  buildReviseArgs,
  buildSubmitArgs,
  inputFromQuote,
  computeTotal,
  isQuoteValid,
  materialsTotal,
  parseAmount,
  validateQuote,
  type QuoteInput,
} from './rules.ts';

const empty: QuoteInput = { labour: '', withMaterials: false, items: [] };
const design: QuoteInput = {
  labour: '1500',
  withMaterials: true,
  items: [
    { name: 'Trap pipe', price: '900' },
    { name: 'Flexible hose', price: '550' },
  ],
};

test('amounts keep digits only, at most seven', () => {
  assert.equal(amountDigits('Rs 1,500'), '1500');
  assert.equal(amountDigits('123456789'), '1234567');
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('  '), 0);
  assert.equal(parseAmount('1,450'), 1450);
});

test('the materials cost is the sum of the item prices, and only counts with materials on', () => {
  assert.equal(materialsTotal(design), 1450);
  assert.equal(materialsTotal({ ...design, withMaterials: false }), 0);
  assert.equal(materialsTotal({ ...design, items: [...design.items, { name: '', price: '' }] }), 1450); // blank rows are ignored
  assert.equal(computeTotal(design), 2950);
  assert.equal(computeTotal(empty), 0);
  assert.equal(computeTotal({ labour: '800', withMaterials: false, items: [{ name: 'x', price: '99' }] }), 800);
});

test('validation: total above zero, and a complete item list when materials are on', () => {
  assert.deepEqual(validateQuote(empty), { total: true });
  assert.deepEqual(validateQuote(design), {});
  assert.deepEqual(validateQuote({ ...design, withMaterials: false }), {}); // items are ignored when off
  assert.deepEqual(validateQuote({ labour: '500', withMaterials: true, items: [] }), { items: true });
  assert.deepEqual(validateQuote({ ...design, withMaterials: false }), {}); // without materials nothing about materials is checked
  assert.deepEqual(validateQuote({ ...design, items: [...design.items, { name: 'Tape', price: '' }] }), { items: true });
  assert.deepEqual(validateQuote({ ...design, items: [...design.items, { name: '', price: '40' }] }), { items: true });
  assert.equal(isQuoteValid({ labour: '', withMaterials: true, items: [{ name: 'Pipe', price: '500' }] }), true); // labour 0 is fine while the total is above zero
  assert.equal(isQuoteValid(empty), false);
});

const VISIT = { p_visit_start: '2026-11-10T05:00:00.000Z', p_visit_end: '2026-11-10T07:00:00.000Z' };

test('the request carries amounts, the item list and the worker\'s visit window, never a total', () => {
  const args = buildSubmitArgs('job-1', design, VISIT);
  assert.equal(args.p_job_id, 'job-1');
  assert.equal(args.p_labour, 1500);
  assert.equal(args.p_materials, 1450);
  assert.equal(args.p_materials_note, 'Trap pipe Rs 900; Flexible hose Rs 550');
  assert.ok(!('p_other_amount' in args)); // accept_job has no "Other" charge
  assert.equal(args.p_note, undefined);
  assert.ok(!('p_total' in args));
  // 0044: the worker proposes the visit window with the price.
  assert.equal(args.p_visit_start, VISIT.p_visit_start);
  assert.equal(args.p_visit_end, VISIT.p_visit_end);
});

test('without materials nothing about materials is sent; item names are tidied', () => {
  const off = buildSubmitArgs('j', { ...design, withMaterials: false }, VISIT);
  assert.equal(off.p_materials, 0);
  assert.equal(off.p_materials_note, undefined);
  assert.ok(!('p_material_bill_path' in buildSubmitArgs('j', design, VISIT))); // the bill is uploaded at completion, never with the quote
  const spaced = buildSubmitArgs('j', { labour: '0', withMaterials: true, items: [{ name: '  Trap   pipe ', price: '500' }] }, VISIT);
  assert.equal(spaced.p_materials_note, 'Trap pipe Rs 500');
});

test('a changed quote sends the quote id instead of the job id, with the same amounts and window', () => {
  const args = buildReviseArgs('q-1', design, VISIT);
  assert.equal(args.p_quote_id, 'q-1');
  assert.ok(!('p_job_id' in args));
  assert.equal(args.p_labour, 1500);
  assert.equal(args.p_materials_note, 'Trap pipe Rs 900; Flexible hose Rs 550');
  assert.equal(args.p_visit_end, VISIT.p_visit_end);
});

test('a sent quote fills the form again to change it', () => {
  assert.deepEqual(inputFromQuote({ labour: 1500, materials: 1450, materialsNote: 'Trap pipe Rs 900; Flexible hose Rs 550' }), {
    labour: '1500',
    withMaterials: true,
    items: [{ name: 'Trap pipe', price: '900' }, { name: 'Flexible hose', price: '550' }],
  });
  assert.deepEqual(inputFromQuote({ labour: 800, materials: 0, materialsNote: null }), { labour: '800', withMaterials: false, items: [{ name: '', price: '' }] });
  // A note that does not add up falls back to one item with the stored amount.
  assert.deepEqual(inputFromQuote({ labour: 0, materials: 300, materialsNote: 'odd text' }).items, [{ name: 'Materials', price: '300' }]);
});

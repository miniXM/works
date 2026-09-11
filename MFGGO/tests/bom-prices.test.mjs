import test from 'node:test';
import assert from 'node:assert/strict';
import { getBomPrices } from '../project-lists-ui.js';

const item = { id: 'line-1', name: 'Plate', material: 'Aluminum', partId: 'part-1', quantity: 3 };
const list = { id: 'list-1', sourceQuoteId: 'quote-1', projectId: 'project-1', items: [item] };
const quote = { id: 'quote-1', projectId: 'project-1', quoteNo: 'Q-001', currency: 'CNY', lines: [{ ...item, quantity: 2, unitPriceCents: 1250, subtotalCents: 2500 }] };

test('BOM prices use matching quotation units with current list quantities', () => {
  assert.deepEqual(getBomPrices(list, quote), { rows: [{ unitPriceCents: 1250, subtotalCents: 3750 }], totalCents: 3750, currency: 'CNY', quoteNo: 'Q-001' });
  const repriced = { ...quote, currency: 'USD', lines: [{ ...quote.lines[0], id: 'new-line', unitPriceCents: 2100 }] };
  assert.equal(getBomPrices(list, repriced).totalCents, 6300);
  assert.equal(getBomPrices(list, repriced).currency, 'USD');
  const noPartList = { ...list, items: [{ ...item, partId: null }] };
  const noPartQuote = { ...quote, lines: [{ ...quote.lines[0], id: 'regenerated-line', partId: null }] };
  assert.equal(getBomPrices(noPartList, noPartQuote).totalCents, 3750);
});

test('missing, cross-project and unrelated quote prices stay unknown instead of becoming zero', () => {
  for (const source of [null, { ...quote, id: 'other-quote' }, { ...quote, projectId: 'other-project' }]) {
    const result = getBomPrices(list, source);
    assert.deepEqual(result.rows, [null]);
    assert.equal(result.totalCents, null);
  }
  const partial = getBomPrices({ ...list, items: [item, { id: 'manual', name: 'Manual row', quantity: 1 }] }, quote);
  assert.equal(partial.rows[0].subtotalCents, 3750);
  assert.equal(partial.rows[1], null);
  assert.equal(partial.totalCents, null);
  const zero = getBomPrices(list, { ...quote, lines: [{ ...quote.lines[0], unitPriceCents: 0 }] });
  assert.equal(zero.totalCents, 0);
});

test('ambiguous rows and changed material do not borrow the wrong quote price', () => {
  const changedIds = { ...quote, lines: [{ ...quote.lines[0], id: 'new-line' }] };
  const duplicates = { ...list, items: [item, { ...item, id: 'new-item' }] };
  assert.deepEqual(getBomPrices(duplicates, changedIds).rows, [null, null]);
  const duplicateLines = { ...changedIds, lines: [...changedIds.lines, { ...changedIds.lines[0], id: 'newer-line', unitPriceCents: 5500 }] };
  assert.deepEqual(getBomPrices(list, duplicateLines).rows, [null]);
  assert.deepEqual(getBomPrices({ ...list, items: [{ ...item, material: 'Steel' }] }, quote).rows, [null]);
  const sameNameOtherPart = { ...changedIds, lines: [{ ...changedIds.lines[0], partId: 'other-part' }] };
  assert.deepEqual(getBomPrices(list, sameNameOtherPart).rows, [null]);
  assert.deepEqual(getBomPrices({ ...list, items: [item, { ...item, id: 'new-item' }] }, quote).rows, [{ unitPriceCents: 1250, subtotalCents: 3750 }, null]);
});

test('invalid or overflowing prices do not render misleading amounts', () => {
  for (const unitPriceCents of [null, -1, 12.5, Number.MAX_SAFE_INTEGER, NaN]) {
    assert.equal(getBomPrices(list, { ...quote, lines: [{ ...quote.lines[0], unitPriceCents }] }).totalCents, null);
  }
  assert.equal(getBomPrices({ ...list, items: [] }, quote).totalCents, null);
});

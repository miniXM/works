import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBomLayout, normalizeBomLayout, normalizeBomCustomValues, normalizeBomCellStyles, visibleBomColumns, bomHeaderTextColor } from '../bom-schema.js';

const withFields = () => {
  const layout = defaultBomLayout();
  layout.columns.push(
    { key: 'custom_tolerance', label: 'Tolerance', type: 'number', width: 100 },
    { key: 'custom_due', label: 'Due date', type: 'date', width: 140 },
    { key: 'custom_supplier', label: 'Supplier', type: 'select', width: 140, options: ['Internal', 'External'] },
    { key: 'custom_checked', label: 'Checked', type: 'checkbox', width: 80 },
    { key: 'custom_comment', label: 'Comment', type: 'text', width: 180 }
  );
  return normalizeBomLayout(layout);
};

test('BOM defaults are independent snapshots and core column types remain stable', () => {
  const first = defaultBomLayout();
  first.columns[0].label = 'Changed';
  first.style.headerColor = '#ffffff';
  assert.notEqual(defaultBomLayout().columns[0].label, first.columns[0].label);
  assert.notEqual(defaultBomLayout().style.headerColor, first.style.headerColor);
  const changedType = defaultBomLayout();
  changedType.columns.find(entry => entry.key === 'quantity').type = 'text';
  assert.throws(() => normalizeBomLayout(changedType));
  for (const key of ['name', 'quantity']) {
    const hidden = defaultBomLayout();
    hidden.columns.find(entry => entry.key === key).visible = false;
    assert.equal(normalizeBomLayout(hidden).columns.find(entry => entry.key === key).visible, false);
  }
});

test('BOM permits blank headers and removal of standard columns while retaining one visible column', () => {
  const layout = defaultBomLayout();
  layout.columns = [{ key: 'custom_free', label: '  ', type: 'text', width: 140, visible: true }];
  const normalized = normalizeBomLayout(layout);
  assert.equal(normalized.columns[0].label, '');
  assert.equal(normalized.columns.length, 1);
  assert.throws(() => normalizeBomLayout({ ...layout, columns: [] }));
  assert.throws(() => normalizeBomLayout({ ...layout, columns: [{ ...layout.columns[0], visible: false }] }));
  assert.throws(() => normalizeBomLayout({ ...layout, columns: [{ ...layout.columns[0], label: 'x'.repeat(61) }] }));
  for (const label of [null, 0, {}, undefined]) assert.throws(() => normalizeBomLayout({ ...layout, columns: [{ ...layout.columns[0], label }] }));
});

test('BOM layouts reject arbitrary styles, unsafe field keys, duplicates and invalid widths', () => {
  for (const style of [{ position: 'fixed' }, { constructor: 'unexpected' }, { toString: 'unexpected' }, { headerColor: 'url(javascript:alert(1))' }, { rowHeight: 161 }, { fontSize: 0 }, { stripe: 'false' }]) {
    assert.throws(() => normalizeBomLayout({ ...defaultBomLayout(), style }));
  }
  for (const key of ['custom_a.b', '__proto__', 'imageUrl', 'custom_', 'custom_<img>']) {
    const layout = defaultBomLayout();
    layout.columns.push({ key, label: 'Unsafe', type: 'text', width: 100 });
    assert.throws(() => normalizeBomLayout(layout));
  }
  const duplicate = defaultBomLayout();
  duplicate.columns.push({ ...duplicate.columns[0] });
  assert.throws(() => normalizeBomLayout(duplicate));
  for (const width of [59, 601, 100.5, '100']) {
    const layout = defaultBomLayout();
    layout.columns[0].width = width;
    assert.throws(() => normalizeBomLayout(layout));
  }
  const invalidAlign = defaultBomLayout();
  invalidAlign.columns[0].align = 'center;position:fixed';
  assert.throws(() => normalizeBomLayout(invalidAlign));
});

test('typed BOM values retain legitimate zero/false and reject nonexistent or malformed values', () => {
  const layout = withFields();
  const values = { custom_tolerance: 0, custom_due: '2028-02-29', custom_supplier: 'Internal', custom_checked: false, custom_comment: '<material>' };
  assert.deepEqual(normalizeBomCustomValues(values, layout), values);
  assert.deepEqual(normalizeBomCustomValues({ custom_due: '', custom_supplier: null }, layout), { custom_due: '', custom_supplier: '' });
  for (const input of [
    { custom_missing: 'value' }, { custom_tolerance: '1.5' }, { custom_tolerance: Infinity },
    { custom_checked: 'false' }, { custom_supplier: 'Unknown' }, { custom_comment: 42 },
    { custom_due: '2027-02-29' }, { custom_due: '2026-02-30' }, { custom_due: '09/07/2026' },
    { custom_due: '2026-09-07T00:00:00Z' }
  ]) assert.throws(() => normalizeBomCustomValues(input, layout));
});

test('select definitions reject duplicate trimmed options and version metadata is validated', () => {
  const layout = withFields();
  layout.columns.find(entry => entry.key === 'custom_supplier').options = ['Internal', ' Internal '];
  assert.throws(() => normalizeBomLayout(layout));
  for (const templateRevision of [0, -1, 1.5, '1']) assert.throws(() => normalizeBomLayout({ ...defaultBomLayout(), templateId: 'template-1', templateRevision }));
  const snapshot = normalizeBomLayout({ ...defaultBomLayout(), templateId: 'template-1', templateRevision: 2 });
  assert.equal(snapshot.templateRevision, 2);
});

test('price filtering follows column type after renaming and reordering while honoring hidden fields', () => {
  const layout = withFields();
  layout.columns.reverse();
  layout.columns.find(entry => entry.key === 'unitPrice').label = 'Customer rate';
  layout.columns.find(entry => entry.key === 'material').visible = false;
  const allowed = visibleBomColumns(layout, true);
  assert.ok(allowed.some(entry => entry.key === 'unitPrice'));
  const restricted = visibleBomColumns(layout, false);
  assert.ok(restricted.every(entry => entry.type !== 'price' && entry.key !== 'material'));
  assert.ok(restricted.some(entry => entry.key === 'custom_tolerance'));
  assert.equal(bomHeaderTextColor('#ffffff'), '#17212b');
  assert.equal(bomHeaderTextColor('#000000'), '#ffffff');
});

test('BOM cell styles support bounded format properties and reject style injection or unknown columns', () => {
  const layout = withFields();
  const styles = { name: { bold: true, italic: false, color: '#AaBbCc', background: '#123456', align: 'center' }, custom_comment: {} };
  const normalized = normalizeBomCellStyles(styles, layout);
  assert.deepEqual(normalized, styles);
  normalized.name.bold = false;
  assert.equal(styles.name.bold, true);
  assert.deepEqual(normalizeBomCellStyles(undefined, layout), {});
  for (const style of [null, [], { bold: 'true' }, { italic: 1 }, { color: '#fff' }, { color: 'red' }, { color: 'url(javascript:alert(1))' },
    { background: '#123456;' }, { align: 'justify' }, { align: 'left;position:fixed' }, { position: 'fixed' }, { constructor: 'bad' },
    { toString: 'bad' }, { fontSize: 200 }]) assert.throws(() => normalizeBomCellStyles({ name: style }, layout));
  for (const input of [null, [], 'bold', { missing: {} }, JSON.parse('{"__proto__":{"bold":true}}'),
    Object.fromEntries(Array.from({ length: 41 }, (_, index) => [`custom_${index}`, {}]))]) assert.throws(() => normalizeBomCellStyles(input, layout));
});

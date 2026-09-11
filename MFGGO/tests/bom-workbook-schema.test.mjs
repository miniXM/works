import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBomWorkbook, bomWorkbookTemplate, BOM_WORKBOOK_MAX_BYTES, BOM_WORKBOOK_LIMITS } from '../bom-workbook-schema.js';

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WQAAAABJRU5ErkJggg==';
const drawing = source => ({ name: 'SHEET_DRAWING_PLUGIN', data: JSON.stringify({ sheet1: { data: { image1: {
  unitId: 'book1', subUnitId: 'sheet1', drawingId: 'image1', drawingType: 0, imageSourceType: 'BASE64', source,
  transform: { left: 12, top: 30, width: 80, height: 60 }, sheetTransform: { from: { column: 0, row: 1 }, to: { column: 1, row: 3 } }
} }, order: ['image1'] } }) });
const workbook = () => ({ id: 'book1', name: 'Manufacturing', appVersion: '0.25.1', locale: 'zhCN', sheetOrder: ['sheet1', 'notes'],
  styles: { header: { bl: 1, bg: { rgb: '#eeeeee' }, bd: { b: { s: 1, cl: { rgb: '#123456' } } } } },
  sheets: {
    sheet1: { id: 'sheet1', name: 'BOM', rowCount: 200, columnCount: 60, cellData: {
      0: { 0: { v: 'Drawing and process', s: 'header' } },
      1: { 0: { v: 12.5 }, 1: { v: '任意填写，数量列也可以是文本' }, 2: { f: '=A2*2', v: 25, s: { n: { pattern: '0.00' } } } },
      4: { 50: { p: { id: 'rich', body: { dataStream: 'Rich text\r\n', textRuns: [{ st: 0, ed: 4, ts: { bl: 1 } }] } } } }
    }, mergeData: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 4 }], rowData: { 0: { h: 40 } }, columnData: { 1: { w: 240 } } },
    notes: { id: 'notes', name: 'Notes', rowCount: 100, columnCount: 26, cellData: { 0: { 0: { v: 'Project-only information' } } } }
  }, resources: [{ name: 'SHEET_AuthzIoMockService_PLUGIN', data: '{}' }, drawing(pixel)] });

test('native workbook preserves arbitrary cells, formulas, merged layout, rich text, multiple sheets and embedded images', () => {
  const input = workbook(), saved = normalizeBomWorkbook(input);
  assert.deepEqual(saved, input);
  saved.sheets.sheet1.cellData[1][0].v = 'No business type restrictions';
  assert.equal(input.sheets.sheet1.cellData[1][0].v, 12.5);
  assert.equal(normalizeBomWorkbook(saved).sheets.sheet1.cellData[1][0].v, 'No business type restrictions');
});

test('workbook structural bounds reject out-of-range data and complex or polluted JSON', () => {
  const changes = [
    value => { value.sheets.sheet1.rowCount = BOM_WORKBOOK_LIMITS.rows + 1; },
    value => { value.sheets.sheet1.columnCount = BOM_WORKBOOK_LIMITS.columns + 1; },
    value => { value.sheetOrder.push('sheet1'); },
    value => { value.sheets.sheet1.cellData[200] = { 0: { v: 'outside' } }; },
    value => { value.sheets.sheet1.cellData[1][60] = { v: 'outside' }; },
    value => { value.sheets.sheet1.mergeData[0].endColumn = 60; },
    value => { value.sheets.sheet1.columnData[-1] = { w: 100 }; },
    value => { value.sheets.sheet1.cellData[1][0].v = { unexpected: 'object' }; },
    value => { value.sheets.sheet1.cellData[1][0].f = 25; },
    value => { value.styles = JSON.parse('{"__proto__":{"polluted":true}}'); },
    value => { value.sheets.sheet1.cellData[4][50].p.body.customRanges = [{ properties: { url: 'javascript:alert(1)' } }]; },
    value => { value.custom = JSON.parse('{"constructor":{"prototype":{"polluted":true}}}'); },
    value => { let current = value; for (let i = 0; i < 65; i++) current = current.deep = {}; }
  ];
  for (const change of changes) {
    const input = workbook(); change(input);
    assert.throws(() => normalizeBomWorkbook(input));
  }
  assert.equal({}.polluted, undefined);
  const tooLarge = workbook(); tooLarge.sheets.sheet1.cellData[1][0].v = 'x'.repeat(BOM_WORKBOOK_MAX_BYTES);
  assert.throws(() => normalizeBomWorkbook(tooLarge), /16 MiB/);
});

test('drawing resources reject transient or external URLs, SVG, forged signatures and resource injections', () => {
  for (const source of ['https://example.test/private.png', 'blob:http://localhost/image', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,SGVsbG8=', pixel.replace('image/png', 'image/jpeg')]) {
    const input = workbook(); input.resources = [drawing(source)];
    assert.throws(() => normalizeBomWorkbook(input));
  }
  for (const resource of [
    { name: 'EXTERNAL_CONNECTION_PLUGIN', data: '{}' },
    { name: 'SHEET_DRAWING_PLUGIN', data: '{"__proto__":{"source":"https://example.test"}}' },
    { name: 'SHEET_DRAWING_PLUGIN', data: '{"sheet1":{"imageSourceType":"URL"}}' },
    { name: 'SHEET_DRAWING_PLUGIN', data: '{"sheet1":{"drawingType":8,"html":"<script>"}}' },
    { name: 'SHEET_RANGE_THEME_MODEL_PLUGIN', data: 'invalid JSON' }
  ]) {
    const input = workbook(); input.resources = [resource];
    assert.throws(() => normalizeBomWorkbook(input));
  }
});

test('templates default to styles and structure, with content and images only on explicit opt-in', () => {
  const source = workbook();
  const template = bomWorkbookTemplate(source, { name: 'Reusable format' });
  assert.equal(template.name, 'Reusable format');
  assert.deepEqual(template.sheets.sheet1.cellData, { 0: { 0: { s: 'header' } }, 1: { 2: { s: { n: { pattern: '0.00' } } } } });
  assert.deepEqual(template.sheets.notes.cellData, {});
  assert.deepEqual(template.sheets.sheet1.mergeData, source.sheets.sheet1.mergeData);
  assert.deepEqual(template.sheets.sheet1.columnData, source.sheets.sheet1.columnData);
  assert.deepEqual(template.resources, []);
  assert.deepEqual(bomWorkbookTemplate(source, { includeContent: true }), source);
  assert.notEqual(source.sheets.sheet1.cellData[1][0].v, undefined);
});

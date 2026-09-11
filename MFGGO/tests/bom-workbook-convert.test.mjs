import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankBomWorkbook, convertLegacyBomWorkbook, prepareBomWorkbook } from '../bom-workbook-convert.js';
import { defaultBomLayout } from '../bom-schema.js';

test('new BOM workbooks start empty without fixed headers or business columns', () => {
  const workbook = createBlankBomWorkbook();
  assert.deepEqual(workbook.sheets[workbook.sheetOrder[0]].cellData, {});
  assert.equal(workbook.sheets[workbook.sheetOrder[0]].columnCount, 26);
  assert.notEqual(createBlankBomWorkbook().id, workbook.id);
});

test('legacy conversion preserves literal values, hidden columns, styles and image anchors without quote prices', () => {
  const layout = defaultBomLayout();
  layout.columns.push({ key: 'custom_extra', label: '', type: 'text', width: 120, visible: false, align: 'left' });
  const list = { title: '旧清单', layout, sourceQuoteId: 'secret-quote', items: [{ id: 'row', name: '=SUM(A1)', quantity: 7, imageId: 'img-1', unitPrice: 91234, subtotal: 638638, customValues: { custom_extra: '隐藏内容' }, cellStyles: { name: { bold: true, italic: true, color: '#123456', background: '#abcdef', align: 'right' } } }] };
  const { snapshot, images } = convertLegacyBomWorkbook(list), sheet = snapshot.sheets[snapshot.sheetOrder[0]];
  const headers = Object.values(sheet.cellData[0]).map(cell => cell.v);
  assert.ok(!headers.includes('单价')); assert.ok(!headers.includes('金额'));
  assert.ok(!JSON.stringify(snapshot).includes('91234')); assert.ok(!JSON.stringify(snapshot).includes('secret-quote'));
  const nameColumn = headers.indexOf('名称'), name = sheet.cellData[1][nameColumn];
  assert.equal(name.v, '=SUM(A1)'); assert.equal(name.t, 1); assert.equal(name.f, undefined);
  assert.deepEqual({ bl: name.s.bl, it: name.s.it, cl: name.s.cl, bg: name.s.bg, ht: name.s.ht }, { bl: 1, it: 1, cl: { rgb: '#123456' }, bg: { rgb: '#abcdef' }, ht: 3 });
  const extraIndex = headers.length - 1;
  assert.equal(sheet.columnData[extraIndex].hd, 1); assert.equal(sheet.cellData[1][extraIndex].v, '隐藏内容');
  assert.equal(images[0].imageId, 'img-1'); assert.equal(images[0].row, 1); assert.equal(images[0].column, headers.indexOf('图片'));
});

test('native snapshots retain sheets, formulas, merged cells and resources without mutating input', () => {
  const workbook = createBlankBomWorkbook(), sheet = workbook.sheets[workbook.sheetOrder[0]];
  sheet.cellData = { 0: { 0: { f: '=1+2', v: 3 } } }; sheet.mergeData = [{ startRow: 1, endRow: 2, startColumn: 0, endColumn: 2 }];
  workbook.resources = [{ name: 'DRAWING_PLUGIN', data: '{"drawing":"embedded"}' }];
  const converted = convertLegacyBomWorkbook({ workbook });
  assert.deepEqual(converted.snapshot, workbook); assert.deepEqual(converted.images, []);
  converted.snapshot.sheets[workbook.sheetOrder[0]].cellData[0][0].f = '=4';
  assert.equal(sheet.cellData[0][0].f, '=1+2');
});

test('legacy image data is resolved once per image and failures block conversion', async () => {
  const list = { items: [{ name: 'A', imageId: 'same' }, { name: 'B', imageId: 'same' }] };
  let calls = 0;
  const result = await prepareBomWorkbook(list, { async load() { calls++; return 'data:image/png;base64,AA=='; } });
  assert.equal(calls, 1); assert.equal(result.images.length, 2);
  assert.ok(result.images.every(image => image.dataUrl === 'data:image/png;base64,AA==' && !Object.hasOwn(image, 'imageId')));
  await assert.rejects(prepareBomWorkbook(list, { async load() { return null; } }), /图片无法加载/);
});

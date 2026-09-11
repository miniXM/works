export const BOM_WORKBOOK_MAX_BYTES = 16 * 1024 * 1024;
export const BOM_WORKBOOK_LIMITS = Object.freeze({ sheets: 32, rows: 100_000, columns: 2_048, cells: 200_000, images: 100 });

const resourceNames = new Set([
  'SHEET_DRAWING_PLUGIN', 'SHEET_RANGE_THEME_MODEL_PLUGIN', 'SHEET_DEFINED_NAME_PLUGIN',
  'SHEET_WORKSHEET_PROTECTION_PLUGIN', 'SHEET_WORKSHEET_PROTECTION_POINT_PLUGIN',
  'SHEET_RANGE_PROTECTION_PLUGIN', 'SHEET_NUMFMT_PLUGIN', 'SHEET_AuthzIoMockService_PLUGIN'
]);
const structuralResourceNames = new Set(['SHEET_RANGE_THEME_MODEL_PLUGIN', 'SHEET_NUMFMT_PLUGIN']);
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const reject = message => { throw new Error(message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !forbiddenKeys.has(value);
const validIndex = (key, maximum) => /^(0|[1-9]\d*)$/.test(key) && Number(key) < maximum;
const safeLink = value => typeof value !== 'string' || !/^\s*(?:javascript|vbscript|data|file|blob):/i.test(value);
const dimension = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 16_384;

function inspectJson(value, depth = 0, budget = { nodes: 0 }) {
  if (depth > 64 || ++budget.nodes > 1_500_000) reject('工作簿结构过于复杂');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) reject('工作簿包含无效数值');
    return;
  }
  if (typeof value !== 'object' || !Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    reject('工作簿必须是有效 JSON 数据');
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) reject('工作簿包含不安全的字段');
    if (['url', 'href', 'hyperlink'].includes(key.toLowerCase()) && !safeLink(child)) reject('工作簿包含不安全的链接');
    inspectJson(child, depth + 1, budget);
  }
}

function validateImageSource(value) {
  const match = typeof value === 'string' && /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length > 6 * 1024 * 1024 || match[2].length % 4) reject('工作簿图片必须是内嵌 PNG、JPEG 或 WebP');
  let binary;
  try { binary = atob(match[2]); } catch { reject('工作簿图片编码不正确'); }
  if (!binary.length || btoa(binary) !== match[2]) reject('工作簿图片编码不正确');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const ascii = (start, end) => binary.slice(start, end);
  const uint32 = start => new DataView(bytes.buffer).getUint32(start);
  const png = bytes.length >= 45 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    && uint32(8) === 13 && ascii(12, 16) === 'IHDR' && uint32(16) > 0 && uint32(20) > 0 && ascii(bytes.length - 8, bytes.length - 4) === 'IEND';
  const jpeg = bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
  const webp = bytes.length >= 20 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
    && new DataView(bytes.buffer).getUint32(4, true) === bytes.length - 8 && ['VP8 ', 'VP8L', 'VP8X'].includes(ascii(12, 16));
  if (!(match[1] === 'image/png' && png || match[1] === 'image/jpeg' && jpeg || match[1] === 'image/webp' && webp)) {
    reject('工作簿图片内容与格式不匹配');
  }
}

function inspectDrawings(value, imageCount = { value: 0 }) {
  if (!value || typeof value !== 'object') return;
  if ('drawingType' in value && value.drawingType !== 0) reject('工作簿目前仅支持图片绘图');
  if ('imageSourceType' in value && value.imageSourceType !== 'BASE64') reject('工作簿图片必须内嵌保存');
  if ('source' in value) {
    if (++imageCount.value > BOM_WORKBOOK_LIMITS.images) reject('工作簿图片过多');
    validateImageSource(value.source);
  }
  for (const child of Object.values(value)) inspectDrawings(child, imageCount);
}

function validateResources(resources) {
  if (!Array.isArray(resources) || resources.length > 32) reject('工作簿资源格式不正确');
  const names = new Set();
  for (const resource of resources) {
    if (!record(resource) || !resourceNames.has(resource.name) || names.has(resource.name) || typeof resource.data !== 'string') {
      reject('工作簿包含不支持或重复的资源');
    }
    names.add(resource.name);
    if (!resource.data) continue;
    let data;
    try { data = JSON.parse(resource.data); } catch { reject('工作簿资源数据不正确'); }
    inspectJson(data);
    if (resource.name === 'SHEET_DRAWING_PLUGIN') inspectDrawings(data);
  }
}

export function normalizeBomWorkbook(input) {
  if (!record(input)) reject('缺少有效工作簿');
  inspectJson(input);
  const encoded = JSON.stringify(input);
  if (new TextEncoder().encode(encoded).length > BOM_WORKBOOK_MAX_BYTES) reject('工作簿超过 16 MiB，请减少图片或单元格内容');
  if (!id(input.id) || typeof input.name !== 'string' || input.name.length > 200 || !record(input.sheets)
    || !Array.isArray(input.sheetOrder) || !input.sheetOrder.length || input.sheetOrder.length > BOM_WORKBOOK_LIMITS.sheets
    || Object.keys(input.sheets).length !== input.sheetOrder.length || new Set(input.sheetOrder).size !== input.sheetOrder.length) {
    reject('工作簿或工作表信息不正确');
  }
  if (input.styles !== undefined && !record(input.styles)) reject('工作簿样式不正确');
  let cells = 0;
  for (const sheetId of input.sheetOrder) {
    const sheet = input.sheets[sheetId];
    if (!id(sheetId) || !record(sheet) || sheet.id !== sheetId || typeof sheet.name !== 'string' || sheet.name.length > 200
      || !integer(sheet.rowCount, 1, BOM_WORKBOOK_LIMITS.rows) || !integer(sheet.columnCount, 1, BOM_WORKBOOK_LIMITS.columns)) {
      reject('工作表名称或行列范围不正确');
    }
    for (const [field, limit] of [['rowData', sheet.rowCount], ['columnData', sheet.columnCount]]) {
      if (sheet[field] === undefined) continue;
      if (!record(sheet[field]) || Object.keys(sheet[field]).some(key => !validIndex(key, limit))) reject('工作表行列配置超出范围');
      for (const metadata of Object.values(sheet[field])) {
        if (metadata !== null && (!record(metadata) || ['h', 'w', 'ah'].some(key => metadata[key] != null && !dimension(metadata[key])))) {
          reject('工作表行高或列宽不正确');
        }
      }
    }
    if (['defaultRowHeight', 'defaultColumnWidth'].some(key => sheet[key] !== undefined && !dimension(sheet[key]))) reject('工作表默认行高或列宽不正确');
    if (sheet.freeze !== undefined && (!record(sheet.freeze) || !integer(sheet.freeze.xSplit, 0, sheet.columnCount)
      || !integer(sheet.freeze.ySplit, 0, sheet.rowCount) || !integer(sheet.freeze.startRow, -1, sheet.rowCount)
      || !integer(sheet.freeze.startColumn, -1, sheet.columnCount))) reject('工作表冻结范围不正确');
    if (sheet.cellData !== undefined) {
      if (!record(sheet.cellData)) reject('单元格数据不正确');
      for (const [rowIndex, row] of Object.entries(sheet.cellData)) {
        if (!validIndex(rowIndex, sheet.rowCount) || !record(row)) reject('单元格行位置不正确');
        for (const [columnIndex, cell] of Object.entries(row)) {
          if (!validIndex(columnIndex, sheet.columnCount) || cell !== null && !record(cell)) reject('单元格位置或内容不正确');
          if (++cells > BOM_WORKBOOK_LIMITS.cells) reject('工作簿有内容或样式的单元格超过 200000 个');
          if (!cell) continue;
          if (cell.v !== undefined && cell.v !== null && !['string', 'number', 'boolean'].includes(typeof cell.v)) reject('单元格值格式不正确');
          if (cell.f !== undefined && cell.f !== null && typeof cell.f !== 'string') reject('单元格公式格式不正确');
          if (cell.p !== undefined && cell.p !== null && !record(cell.p)) reject('单元格富文本格式不正确');
          if (cell.s !== undefined && cell.s !== null && typeof cell.s !== 'string' && !record(cell.s)) reject('单元格样式格式不正确');
          if (cell.p?.drawings) inspectDrawings(cell.p.drawings);
        }
      }
    }
    if (sheet.mergeData !== undefined) {
      if (!Array.isArray(sheet.mergeData) || sheet.mergeData.length > 10_000) reject('合并单元格配置过多或格式不正确');
      for (const merge of sheet.mergeData) {
        if (!record(merge) || !integer(merge.startRow, 0, sheet.rowCount - 1) || !integer(merge.endRow, merge.startRow, sheet.rowCount - 1)
          || !integer(merge.startColumn, 0, sheet.columnCount - 1) || !integer(merge.endColumn, merge.startColumn, sheet.columnCount - 1)) reject('合并单元格超出工作表范围');
      }
    }
  }
  if (input.resources !== undefined) validateResources(input.resources);
  return JSON.parse(encoded);
}

export function bomWorkbookTemplate(input, { includeContent = false, name } = {}) {
  const workbook = normalizeBomWorkbook(input);
  if (name !== undefined) workbook.name = name;
  if (includeContent) return workbook;
  // Templates are visible across projects, so the default contains layout only.
  for (const sheet of Object.values(workbook.sheets)) {
    const cells = {};
    for (const [rowIndex, row] of Object.entries(sheet.cellData || {})) {
      for (const [columnIndex, cell] of Object.entries(row)) {
        if (cell?.s !== undefined) (cells[rowIndex] ||= {})[columnIndex] = { s: cell.s };
      }
    }
    sheet.cellData = cells;
    delete sheet.custom;
  }
  delete workbook.custom;
  workbook.resources = (workbook.resources || []).filter(resource => structuralResourceNames.has(resource.name));
  return workbook;
}

import { normalizeBomLayout, bomHeaderTextColor } from './bom-schema.js';

const clone = value => JSON.parse(JSON.stringify(value));
const id = prefix => `${prefix}${Array.from(crypto.getRandomValues(new Uint8Array(12)), value => value.toString(16).padStart(2, '0')).join('')}`;
const alignment = { left: 1, center: 2, right: 3 };

export function createBlankBomWorkbook(name = 'BOM') {
  const sheetId = id('sheet_');
  return { id: id('bom_'), name, sheetOrder: [sheetId], sheets: { [sheetId]: {
    id: sheetId, name: 'BOM', rowCount: 200, columnCount: 26,
    defaultColumnWidth: 100, defaultRowHeight: 26, cellData: {},
  } } };
}

export function convertLegacyBomWorkbook(list) {
  if (list?.workbook) return { snapshot: clone(list.workbook), images: [] };
  const snapshot = createBlankBomWorkbook(list?.title || 'BOM');
  if (!list) return { snapshot, images: [] };
  const layout = normalizeBomLayout(list.layout);
  // Quote prices are independently authorized and must never become shared sheet cells.
  const columns = layout.columns.filter(column => column.type !== 'price');
  const sheetId = snapshot.sheetOrder[0], sheet = snapshot.sheets[sheetId];
  sheet.rowCount = Math.max(200, (list.items?.length || 0) + 30);
  sheet.columnCount = Math.max(26, columns.length + 5);
  sheet.columnData = {};
  sheet.rowData = { 0: { h: 34 } };
  const images = [], border = { s: 1, cl: { rgb: '#dfe5ea' } };
  const baseStyle = { fs: layout.style.fontSize, vt: 2, tb: 3, pd: { l: 5, r: 5, t: 2, b: 2 }, ...(layout.style.borders ? { bd: { t: border, r: border, b: border, l: border } } : {}) };
  sheet.cellData[0] = {};
  columns.forEach((column, index) => {
    sheet.columnData[index] = { w: column.width, hd: column.visible ? 0 : 1 };
    sheet.cellData[0][index] = { v: column.label, t: 1, s: { ...clone(baseStyle), bl: 1, bg: { rgb: layout.style.headerColor }, cl: { rgb: bomHeaderTextColor(layout.style.headerColor) }, ht: alignment[column.align] || 1 } };
  });
  for (const [rowIndex, item] of (list.items || []).entries()) {
    const targetRow = rowIndex + 1;
    sheet.rowData[targetRow] = { h: layout.style.rowHeight };
    sheet.cellData[targetRow] = {};
    columns.forEach((column, index) => {
      const sourceStyle = item.cellStyles?.[column.key] || {};
      const style = { ...clone(baseStyle), ht: alignment[sourceStyle.align || column.align] || 1 };
      if (layout.style.stripe && rowIndex % 2) style.bg = { rgb: '#f6f8f9' };
      if (sourceStyle.bold !== undefined) style.bl = sourceStyle.bold ? 1 : 0;
      if (sourceStyle.italic !== undefined) style.it = sourceStyle.italic ? 1 : 0;
      if (sourceStyle.color) style.cl = { rgb: sourceStyle.color };
      if (sourceStyle.background) style.bg = { rgb: sourceStyle.background };
      const cell = { s: style };
      const value = column.type === 'index' ? targetRow : column.key.startsWith('custom_') ? item.customValues?.[column.key] : item[column.key];
      if (column.type !== 'image' && value !== undefined && value !== null && value !== '') {
        cell.v = value;
        cell.t = typeof value === 'number' ? 2 : typeof value === 'boolean' ? 3 : 1;
      }
      sheet.cellData[targetRow][index] = cell;
      if (column.type === 'image' && item.imageId) images.push({ imageId: item.imageId, sheetId, row: targetRow, column: index, width: Math.max(24, column.width - 12), height: Math.max(24, layout.style.rowHeight - 10) });
    });
  }
  return { snapshot, images };
}

export async function prepareBomWorkbook(list, imageSession) {
  const result = convertLegacyBomWorkbook(list);
  const cache = new Map();
  const load = imageId => {
    if (!cache.has(imageId)) cache.set(imageId, (async () => {
      const url = await imageSession.load(imageId);
      if (!url) throw new Error('清单图片无法加载，请稍后重试');
      if (url.startsWith('data:')) return url;
      const response = await fetch(url);
      if (!response.ok) throw new Error('清单图片无法加载，请稍后重试');
      const blob = await response.blob();
      return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('清单图片读取失败')); reader.readAsDataURL(blob); });
    })());
    return cache.get(imageId);
  };
  result.images = await Promise.all(result.images.map(async ({ imageId, ...image }) => ({ ...image, dataUrl: await load(imageId) })));
  return result;
}

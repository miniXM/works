import { TabulatorFull as Tabulator } from 'tabulator-tables';
import { tsvParseRows, tsvFormatRows } from 'd3-dsv';
import 'tabulator-tables/dist/css/tabulator.min.css';

const clone = value => JSON.parse(JSON.stringify(value));
const custom = key => key.startsWith('custom_');
const writable = column => !['price', 'index', 'image'].includes(column.type);
export const gridColumns = layout => layout.columns.filter(column => column.visible && column.type !== 'price');
export const cellValue = (row, key) => custom(key) ? row.customValues[key] : key === 'image' ? row.imageId : row[key];
export function setCellValue(row, key, value) {
  if (custom(key)) row.customValues[key] = value;
  else if (key === 'image') row.imageId = value;
  else row[key] = value;
}
export function columnLetter(index) {
  let result = '';
  for (index++; index > 0; index = Math.floor((index - 1) / 26)) result = String.fromCharCode(65 + (index - 1) % 26) + result;
  return result;
}
export function parseCellValue(value, column) {
  if (value === '' || value == null) return column.key === 'quantity' ? null : '';
  if (column.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number) || Math.abs(number) > 1e12 || (column.key === 'quantity' && (!Number.isInteger(number) || number < 1 || number > 1e9))) throw new Error(`${column.label || '该列'}须为${column.key === 'quantity' ? '1 至 1000000000 的整数' : '有效数字'}`);
    return number;
  }
  if (column.type === 'checkbox') {
    if (typeof value === 'boolean') return value;
    const text = String(value).toLowerCase();
    if (['true', '1', '是', '√'].includes(text)) return true;
    if (['false', '0', '否'].includes(text)) return false;
    throw new Error(`${column.label || '该列'}须为 TRUE 或 FALSE`);
  }
  const text = String(value);
  const limit = column.key === 'notes' || custom(column.key) ? 2000 : ['material', 'revision'].includes(column.key) ? 80 : column.key === 'format' ? 40 : 160;
  if (text.length > limit) throw new Error(`${column.label || '该列'}内容最多 ${limit} 字`);
  if (column.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text)) throw new Error(`${column.label || '该列'}须为有效日期`);
  if (column.type === 'select' && !column.options.includes(text)) throw new Error(`${column.label || '该列'}不在选项中`);
  return text;
}

export function createBomGrid({ element, getState, isBusy, onChange, onSelection, onError, imageCell, onRendered, createRow, createColumn, onClearImage }) {
  let table, ready = false, rendering = false, destroyed = false, generation = 0, commitActive = null;
  let selected = { rowIds: [], keys: [], rowIndex: 0, columnIndex: 0 };
  const flatRows = () => {
    const { rows, layout } = getState();
    return rows.map((row, index) => Object.fromEntries([['id', row.id], ['_row', index + 1], ...gridColumns(layout).map(column => [column.key, column.key === 'item' ? index + 1 : cellValue(row, column.key)])]));
  };
  const changeSelection = range => {
    if (rendering || !ready || !range) return;
    const { rows, layout } = getState(), columns = gridColumns(layout);
    const rowIds = range.getRows().map(row => row.getData().id);
    const keys = range.getColumns().map(column => column.getField()).filter(key => columns.some(column => column.key === key));
    if (!rowIds.length || !keys.length) return;
    selected = { rowIds, keys, rowIndex: rows.findIndex(row => row.id === rowIds[0]), columnIndex: columns.findIndex(column => column.key === keys[0]) };
    onSelection(selection());
  };
  function selection() {
    const { rows, layout } = getState(), columns = gridColumns(layout);
    const rowIds = selected.rowIds.filter(id => rows.some(row => row.id === id));
    const keys = selected.keys.filter(key => columns.some(column => column.key === key));
    return { rowIds: rowIds.length ? rowIds : rows[0] ? [rows[0].id] : [], keys: keys.length ? keys : columns[0] ? [columns[0].key] : [], rowIndex: Math.max(0, rows.findIndex(row => row.id === rowIds[0])), columnIndex: Math.max(0, columns.findIndex(column => column.key === keys[0])) };
  }
  function select(rowIndex, columnIndex, endRow = rowIndex, endColumn = columnIndex, focus = false) {
    if (!ready || destroyed) return;
    const { rows, layout } = getState(), columns = gridColumns(layout);
    const row = rows[Math.max(0, Math.min(rows.length - 1, rowIndex))], column = columns[Math.max(0, Math.min(columns.length - 1, columnIndex))];
    if (!row || !column) return;
    const lastRow = rows[Math.max(0, Math.min(rows.length - 1, endRow))], lastColumn = columns[Math.max(0, Math.min(columns.length - 1, endColumn))];
    const firstCell = table.getRow(row.id)?.getCell(column.key), lastCell = table.getRow(lastRow.id)?.getCell(lastColumn.key);
    if (!firstCell || !lastCell) return;
    for (const range of table.getRanges()) range.remove();
    table.addRange(firstCell, lastCell);
    if (focus) firstCell.getElement().focus({ preventScroll: true });
  }
  function decorateHeaders() {
    const columns = gridColumns(getState().layout);
    for (const column of table.getColumns()) {
      const definition = columns.find(entry => entry.key === column.getField());
      if (!definition) continue;
      const input = column.getElement().querySelector('.tabulator-title-editor');
      if (input) {
        if (document.activeElement !== input) input.value = definition.label;
        input.maxLength = 60;
        input.dataset.bomHeader = definition.key;
        input.setAttribute('aria-label', `${columnLetter(columns.indexOf(definition))} 列表头`);
        input.disabled = isBusy();
        if (!input.dataset.bomHeaderReady) {
          input.dataset.bomHeaderReady = 'true';
          input.addEventListener('keydown', event => {
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); input.blur(); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); input.value = getState().layout.columns.find(entry => entry.key === column.getField())?.label || ''; input.blur(); }
          });
        }
      }
      column.getElement().dataset.bomColumn = definition.key;
      column.getElement().dataset.bomLetter = columnLetter(columns.indexOf(definition));
    }
    onRendered?.();
  }
  function formatter(cell) {
    const { rows, layout } = getState();
    const row = rows.find(entry => entry.id === cell.getRow().getData().id), column = layout.columns.find(entry => entry.key === cell.getField());
    if (!row || !column) return '';
    const element = cell.getElement(), style = row.cellStyles?.[column.key] || {};
    element.dataset.bomCell = column.key;
    element.dataset.rowId = row.id;
    element.style.fontWeight = style.bold ? '700' : '';
    element.style.fontStyle = style.italic ? 'italic' : '';
    element.style.color = style.color || '';
    element.style.backgroundColor = style.background || '';
    element.style.textAlign = style.align || column.align || 'left';
    if (column.type === 'image') return imageCell(row, rows.indexOf(row));
    const span = document.createElement('span');
    span.textContent = column.type === 'checkbox' ? cell.getValue() === true ? '☑' : cell.getValue() === false ? '☐' : '' : String(cell.getValue() ?? '');
    return span;
  }
  function editor(cell, onRendered, success, cancel) {
    const column = getState().layout.columns.find(entry => entry.key === cell.getField());
    const input = document.createElement(column.type === 'select' ? 'select' : column.type === 'text' ? 'textarea' : 'input');
    input.dataset.bomField = column.key;
    input.dataset.listItemField = column.key;
    input.dataset.rowId = cell.getRow().getData().id;
    input.setAttribute('aria-label', `${column.label || '单元格'}`);
    if (column.type === 'select') for (const value of ['', ...column.options]) { const option = document.createElement('option'); option.value = value; option.textContent = value; input.appendChild(option); }
    else if (input.tagName === 'INPUT') input.type = column.type === 'date' ? 'date' : column.type === 'number' ? 'number' : column.type === 'checkbox' ? 'checkbox' : 'text';
    if (input.type === 'checkbox') input.checked = cell.getValue() === true;
    else input.value = cell.getValue() ?? '';
    let done = false;
    const commit = () => {
      if (done) return true;
      try {
        const value = parseCellValue(input.type === 'checkbox' ? input.checked : input.value, column);
        done = true; commitActive = null; success(value); return true;
      } catch (error) { input.setAttribute('aria-invalid', 'true'); onError(error.message); return false; }
    };
    commitActive = () => { const valid = commit(); if (!valid) input.focus(); return valid; };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter' && !event.altKey && !event.shiftKey) { event.preventDefault(); commit(); }
      else if (event.key === 'Enter') {
        event.stopPropagation();
        if (event.altKey && input.tagName === 'TEXTAREA') { event.preventDefault(); input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end'); }
      }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); done = true; commitActive = null; cancel(); }
    });
    if (column.type === 'checkbox' || column.type === 'select') input.addEventListener('change', commit);
    onRendered(() => { input.focus(); if (['text', 'number', 'textarea'].includes(input.type)) input.select(); });
    return input;
  }
  const definitions = () => gridColumns(getState().layout).map(column => ({
    title: column.label, field: column.key, width: column.width, minWidth: 60, maxWidth: 600,
    editableTitle: true, headerSort: false, resizable: true, hozAlign: column.align || 'left',
    editor: writable(column) ? editor : false, editable: () => !isBusy(), formatter,
    clipboard: column.type !== 'image', accessorClipboard: value => value ?? '',
    headerContextMenu: [{ label: '选择整列', action: (_, component) => select(0, gridColumns(getState().layout).findIndex(entry => entry.key === component.getField()), getState().rows.length - 1) }],
  }));
  table = new Tabulator(element, {
    data: flatRows(), columns: definitions(), index: 'id', height: '100%', layout: 'fitData',
    renderVertical: 'virtual', rowHeight: getState().layout.style.rowHeight,
    rowHeader: { field: '_row', width: 46, frozen: true, headerSort: false, resizable: false, formatter: 'rownum', hozAlign: 'center', editor: false, clipboard: false },
    selectableRange: 1, selectableRangeColumns: true, selectableRangeRows: true, selectableRangeClearCells: false,
    editTriggerEvent: 'dblclick', movableColumns: true, clipboard: 'copy', clipboardCopyStyled: false,
    clipboardCopyConfig: { rowHeaders: false, columnHeaders: false }, clipboardCopyRowRange: 'range',
    placeholder: '暂无明细', columnDefaults: { headerSort: false, tooltip: false },
    rowFormatter(row) { row.getElement().dataset.projectListEditorRow = String(row.getPosition() - 1); row.getElement().dataset.rowId = row.getData().id; },
  });
  table.on('tableBuilt', () => { ready = true; decorateHeaders(); select(selected.rowIndex, selected.columnIndex); });
  table.on('renderComplete', () => { if (ready && !destroyed) decorateHeaders(); });
  table.on('rangeAdded', changeSelection); table.on('rangeChanged', changeSelection);
  table.on('cellEdited', cell => {
    if (rendering || isBusy()) return;
    const row = getState().rows.find(entry => entry.id === cell.getRow().getData().id);
    if (row) { setCellValue(row, cell.getField(), cell.getValue()); onChange(false); onSelection(selection()); }
  });
  table.on('columnTitleChanged', column => {
    if (rendering || isBusy()) return;
    const target = getState().layout.columns.find(entry => entry.key === column.getField());
    if (target) { target.label = column.getDefinition().title.slice(0, 60); onChange(false); }
  });
  table.on('columnResized', column => {
    if (rendering || isBusy()) return;
    const target = getState().layout.columns.find(entry => entry.key === column.getField());
    if (target) { target.width = Math.min(600, Math.max(60, Math.round(column.getWidth()))); onChange(false); }
  });
  table.on('columnMoved', (_, columns) => {
    if (rendering || isBusy()) return;
    const state = getState(), map = new Map(state.layout.columns.map(column => [column.key, column]));
    const ordered = columns.map(column => map.get(column.getField())).filter(Boolean);
    state.layout.columns = [...ordered, ...state.layout.columns.filter(column => !ordered.includes(column))];
    onChange(false); decorateHeaders();
  });
  async function replace() {
    if (!ready || destroyed) return;
    commitActive = null;
    const current = ++generation, before = selection();
    rendering = true;
    table.options.rowHeight = getState().layout.style.rowHeight;
    table.setColumns(definitions());
    await table.replaceData(flatRows());
    if (destroyed || generation !== current) return;
    rendering = false; decorateHeaders(); select(before.rowIndex, before.columnIndex, before.rowIndex + before.rowIds.length - 1, before.columnIndex + before.keys.length - 1);
  }
  function clear() {
    const area = selection(), { rows, layout } = getState();
    for (const row of rows.filter(row => area.rowIds.includes(row.id))) for (const column of layout.columns.filter(column => area.keys.includes(column.key))) {
      if (writable(column)) setCellValue(row, column.key, column.key === 'quantity' ? null : '');
      else if (column.type === 'image') { onClearImage?.(row.id); row.imageId = null; }
    }
    onChange(true);
  }
  function style(property, value) {
    const area = selection(), { rows } = getState();
    const targets = rows.filter(row => area.rowIds.includes(row.id));
    if (['bold', 'italic'].includes(property)) value = !targets.every(row => area.keys.every(key => row.cellStyles?.[key]?.[property] === true));
    for (const row of targets) for (const key of area.keys) {
      row.cellStyles ||= {};
      if (property === 'clear') delete row.cellStyles[key];
      else row.cellStyles[key] = { ...row.cellStyles[key], [property]: value };
    }
    onChange(true);
  }
  function paste(text) {
    if (isBusy() || !text) return;
    try {
      const matrix = tsvParseRows(text), state = getState(), area = selection();
      if (!matrix.length) return;
      const columns = gridColumns(state.layout), width = Math.max(...matrix.map(row => row.length));
      if (area.rowIndex + matrix.length > 500 || state.layout.columns.length + Math.max(0, area.columnIndex + width - columns.length) > 40) throw new Error('粘贴后不能超过 500 行、40 列');
      const nextRows = clone(state.rows), nextLayout = clone(state.layout), nextColumns = gridColumns(nextLayout);
      while (nextColumns.length < area.columnIndex + width) { const column = createColumn(''); nextLayout.columns.push(column); nextColumns.push(column); }
      while (nextRows.length < area.rowIndex + matrix.length) nextRows.push(createRow());
      for (let y = 0; y < matrix.length; y++) for (let x = 0; x < matrix[y].length; x++) {
        const column = nextColumns[area.columnIndex + x];
        if (writable(column)) setCellValue(nextRows[area.rowIndex + y], column.key, parseCellValue(matrix[y][x], column));
      }
      state.rows.splice(0, state.rows.length, ...nextRows); state.layout.columns = nextLayout.columns;
      selected = { ...area, rowIds: nextRows.slice(area.rowIndex, area.rowIndex + matrix.length).map(row => row.id), keys: nextColumns.slice(area.columnIndex, area.columnIndex + width).map(column => column.key) };
      onChange(true);
    } catch (error) { onError(error.message); }
  }
  function clipboardText() {
    const area = selection(), { rows, layout } = getState(), columns = gridColumns(layout).filter(column => area.keys.includes(column.key));
    return tsvFormatRows(rows.filter(row => area.rowIds.includes(row.id)).map((row, index) => columns.map(column => column.type === 'image' ? '' : column.type === 'index' ? rows.indexOf(row) + 1 : cellValue(row, column.key) ?? '')));
  }
  const isInput = target => target.closest('input,textarea,select,[contenteditable="true"]');
  element.addEventListener('copy', event => { if (isInput(event.target)) return; event.preventDefault(); event.stopImmediatePropagation(); event.clipboardData?.setData('text/plain', clipboardText()); }, true);
  element.addEventListener('cut', event => { if (isBusy() || isInput(event.target)) return; event.preventDefault(); event.clipboardData?.setData('text/plain', clipboardText()); clear(); }, true);
  element.addEventListener('paste', event => {
    const text = event.clipboardData?.getData('text/plain');
    if (isBusy() || !text || (isInput(event.target) && !/[\t\r\n]/.test(text))) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (isInput(event.target)) event.target.blur();
    paste(text);
  }, true);
  element.addEventListener('keydown', event => {
    if (isBusy() || isInput(event.target)) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopImmediatePropagation(); clear(); }
  }, true);
  return {
    replace, selection, select, clear, style, paste,
    target(keys, rowIds = selection().rowIds) { selected = { ...selected, keys, rowIds }; },
    copy() { if (ready) table.copyToClipboard('range'); },
    edit() { const area = selection(), row = getState().rows[area.rowIndex]; if (row) table.getRow(row.id)?.getCell(area.keys[0])?.edit(); },
    refreshRow(id) { if (ready) table.getRow(id)?.reformat(); onRendered?.(); },
    commit() {
      if (commitActive && !commitActive()) return false;
      const title = element.querySelector('.tabulator-title-editor:focus');
      if (title) { title.dispatchEvent(new Event('change', { bubbles: true })); title.blur(); }
      return true;
    },
    destroy() { destroyed = true; commitActive = null; table.destroy(); },
  };
}

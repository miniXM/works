const column = (key, label, type, width, visible = true) => ({ key, label, type, width, visible, align: ['number', 'price'].includes(type) ? 'right' : type === 'image' || type === 'index' ? 'center' : 'left' });
export const BOM_COLUMNS = [
  column('item', '序号', 'index', 60), column('image', '图片', 'image', 110),
  column('name', '名称', 'text', 200), column('revision', '版本', 'text', 80),
  column('material', '材料', 'text', 120), column('finish', '工艺 / 表面处理', 'text', 160),
  column('dimensions', '尺寸 (mm)', 'text', 150), column('quantity', '数量', 'number', 85),
  column('unitPrice', '单价', 'price', 115), column('subtotal', '金额', 'price', 120),
  column('notes', '备注', 'text', 180), column('format', '格式', 'text', 90, false)
];
export const BOM_CUSTOM_TYPES = ['text', 'number', 'date', 'select', 'checkbox'];
export const BOM_STYLE = { headerColor: '#273443', rowHeight: 72, fontSize: 12, stripe: true, borders: true };
export function defaultBomLayout() { return { columns: BOM_COLUMNS.map(entry => ({ ...entry })), style: { ...BOM_STYLE } }; }
const invalid = message => { throw new Error(message); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const shortText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;

export function normalizeBomLayout(input) {
  if (input == null) return defaultBomLayout();
  if (!plain(input) || Object.keys(input).some(key => !['columns', 'style', 'templateId', 'templateRevision'].includes(key))) invalid('BOM 布局格式不正确');
  if (!Array.isArray(input.columns) || input.columns.length < 1 || input.columns.length > 40) invalid('BOM 需要 1 至 40 列');
  const used = new Set();
  const columns = input.columns.map(source => {
    if (!plain(source) || Object.keys(source).some(key => !['key', 'label', 'type', 'width', 'visible', 'options', 'align'].includes(key))) invalid('列配置格式不正确');
    if (!shortText(source.key, 80) || used.has(source.key)) invalid('列标识为空或重复');
    used.add(source.key);
    const base = BOM_COLUMNS.find(entry => entry.key === source.key);
    if (!base && !/^custom_[a-zA-Z0-9_]{1,60}$/.test(source.key)) invalid('自定义列标识不正确');
    if (typeof source.label !== 'string' || source.label.trim().length > 60) invalid('列名称不得超过 60 字');
    const type = source.type ?? base?.type ?? 'text';
    if (base ? type !== base.type : !BOM_CUSTOM_TYPES.includes(type)) invalid('列类型不正确');
    const width = source.width ?? base?.width ?? 140;
    if (!integer(width, 60, 600)) invalid('列宽须为 60 至 600 像素');
    if (source.visible !== undefined && typeof source.visible !== 'boolean') invalid('列显示设置不正确');
    const align = source.align ?? base?.align ?? 'left';
    if (!['left', 'center', 'right'].includes(align)) invalid('列对齐设置不正确');
    const result = { key: source.key, label: source.label.trim(), type, width, visible: source.visible !== false, align };
    if (type === 'select') {
      if (!Array.isArray(source.options) || source.options.length < 1 || source.options.length > 50 || source.options.some(value => !shortText(value, 80))) invalid('下拉字段需要 1 至 50 个非空选项');
      result.options = source.options.map(value => value.trim());
      if (new Set(result.options).size !== result.options.length) invalid('下拉选项不能重复');
    } else if (source.options !== undefined && (!Array.isArray(source.options) || source.options.length)) invalid('此列类型不支持选项');
    return result;
  });
  if (!columns.some(entry => entry.visible)) invalid('BOM 至少需要显示一列');
  const sourceStyle = input.style ?? {};
  if (!plain(sourceStyle) || Object.keys(sourceStyle).some(key => !Object.hasOwn(BOM_STYLE, key))) invalid('样式设置不正确');
  const style = { ...BOM_STYLE, ...sourceStyle };
  if (!/^#[0-9a-fA-F]{6}$/.test(style.headerColor) || !integer(style.rowHeight, 36, 160) || !integer(style.fontSize, 10, 18) || typeof style.stripe !== 'boolean' || typeof style.borders !== 'boolean') invalid('样式数值超出允许范围');
  const layout = { columns, style };
  if (input.templateId !== undefined && input.templateId !== '') {
    if (!shortText(input.templateId, 100) || !integer(input.templateRevision, 1, 1000000000)) invalid('模板版本不正确');
    layout.templateId = input.templateId;
    layout.templateRevision = input.templateRevision;
  }
  return layout;
}

export function normalizeBomCustomValues(input, layout) {
  if (input === undefined) return {};
  if (!plain(input)) invalid('自定义字段值格式不正确');
  const definitions = new Map(layout.columns.filter(entry => entry.key.startsWith('custom_')).map(entry => [entry.key, entry]));
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    const definition = definitions.get(key);
    if (!definition) invalid('自定义字段不存在于当前模板');
    if (value === null || value === '') { result[key] = ''; continue; }
    if (definition.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) invalid(`${definition.label}须为有效数字`);
    } else if (definition.type === 'checkbox') {
      if (typeof value !== 'boolean') invalid(`${definition.label}须为勾选值`);
    } else {
      if (typeof value !== 'string' || value.length > 2000) invalid(`${definition.label}内容过长或格式不正确`);
      if (definition.type === 'select' && !definition.options.includes(value)) invalid(`${definition.label}不在选项中`);
      if (definition.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) invalid(`${definition.label}须为有效日期`);
    }
    result[key] = value;
  }
  return result;
}

export function normalizeBomCellStyles(input, layout) {
  if (input === undefined) return {};
  if (!plain(input)) invalid('单元格样式格式不正确');
  const columns = new Set(layout.columns.map(entry => entry.key));
  const entries = Object.entries(input);
  if (entries.length > columns.size || entries.length > 40) invalid('单元格样式数量超出列数');
  const result = {};
  for (const [key, style] of entries) {
    if (!columns.has(key)) invalid('单元格样式关联的列不存在');
    if (!plain(style) || Object.keys(style).some(property => !['bold', 'italic', 'color', 'background', 'align'].includes(property))) invalid('单元格包含不支持的样式');
    const normalized = {};
    for (const [property, value] of Object.entries(style)) {
      if (['bold', 'italic'].includes(property)) {
        if (typeof value !== 'boolean') invalid('加粗和斜体设置须为勾选值');
      } else if (['color', 'background'].includes(property)) {
        if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) invalid('单元格颜色须为六位十六进制颜色');
      } else if (!['left', 'center', 'right'].includes(value)) invalid('单元格对齐设置不正确');
      normalized[property] = value;
    }
    result[key] = normalized;
  }
  return result;
}

export function visibleBomColumns(layout, canReadPrices) {
  return normalizeBomLayout(layout).columns.filter(entry => entry.visible && (canReadPrices || entry.type !== 'price'));
}

export function bomHeaderTextColor(color) {
  const rgb = color.slice(1).match(/.{2}/g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > .179 ? '#17212b' : '#ffffff';
}

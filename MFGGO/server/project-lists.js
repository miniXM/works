import { randomUUID } from 'node:crypto';
import { enterpriseCan } from '../access-policy.js';
import { defaultBomLayout, normalizeBomLayout, normalizeBomCustomValues, normalizeBomCellStyles } from '../bom-schema.js';
import { normalizeBomWorkbook, bomWorkbookTemplate } from '../bom-workbook-schema.js';

export class ProjectListError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
const fail = (status, code, message) => { throw new ProjectListError(status, code, message); };
const identifier = () => `project_list_${randomUUID()}`;
const text = (value, limit, required = false) => {
  if (typeof value !== 'string' || value.trim().length > limit || required && !value.trim()) {
    fail(400, 'invalid_project_list', '清单字段格式不正确或超出长度限制');
  }
  return value.trim();
};
const object = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    fail(400, 'invalid_project_list', '清单包含不支持的字段');
  }
};
const fromRow = row => row ? ({
  id: row.id, projectId: row.project_id, title: row.title, items: JSON.parse(row.items_json),
  revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
  workbook: row.workbook_json ? JSON.parse(row.workbook_json) : null,
  ...(row.layout_json ? { layout: JSON.parse(row.layout_json) } : {}),
  ...(row.source_quote_id ? { sourceQuoteId: row.source_quote_id } : {})
}) : null;
const schemaValue = normalize => {
  try { return normalize(); }
  catch (error) { fail(400, 'invalid_bom_layout', error.message || 'BOM 表格配置不正确'); }
};
const templateFromRow = row => ({ id: row.id, name: row.name, layout: JSON.parse(row.layout_json),
  workbook: row.workbook_json ? JSON.parse(row.workbook_json) : null,
  revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at });
const workbookValue = input => {
  try { return normalizeBomWorkbook(input); }
  catch (error) { fail(400, 'invalid_bom_workbook', error.message || '工作簿数据不正确'); }
};
const imageFromRow = row => ({ id: row.id, name: row.name, dataUrl: `data:${row.mime_type};base64,${Buffer.from(row.content).toString('base64')}` });

export function instrumentProjectLists(api, db) {
  const transaction = operation => {
    const savepoint = `project_list_${randomUUID().replaceAll('-', '')}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try { const result = operation(); db.exec(`RELEASE SAVEPOINT ${savepoint}`); return result; }
    catch (error) { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`); throw error; }
  };
  const find = (organizationId, projectId, listId) => db.prepare('SELECT * FROM project_lists WHERE organization_id = ? AND project_id = ? AND id = ?')
    .get(organizationId, projectId, listId);
  const selected = (organizationId, projectId) => db.prepare('SELECT list_id FROM project_list_selections WHERE organization_id = ? AND project_id = ?')
    .get(organizationId, projectId)?.list_id || null;
  const select = (organizationId, projectId, listId, timestamp) => db.prepare(`INSERT INTO project_list_selections(organization_id, project_id, list_id, updated_at)
    VALUES(?, ?, ?, ?) ON CONFLICT(organization_id, project_id) DO UPDATE SET list_id = excluded.list_id, updated_at = excluded.updated_at`)
    .run(organizationId, projectId, listId, timestamp);
  const insert = ({ id, organizationId, projectId, title, items, layout = null, workbook = null, sourceQuoteId = null, createdAt, updatedAt }) => {
    db.prepare(`INSERT INTO project_lists(id, organization_id, project_id, title, items_json, layout_json, workbook_json, revision, source_quote_id, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).run(id, organizationId, projectId, title, JSON.stringify(items), layout ? JSON.stringify(layout) : null,
      workbook ? JSON.stringify(workbook) : null, sourceQuoteId, createdAt, updatedAt);
  };
  transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS project_lists (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      items_json TEXT NOT NULL CHECK(json_valid(items_json)),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
      source_quote_id TEXT REFERENCES quotes(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(organization_id, project_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_project_lists_project ON project_lists(organization_id, project_id, updated_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_lists_source_quote ON project_lists(organization_id, project_id, source_quote_id) WHERE source_quote_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS project_list_selections (
      organization_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      list_id TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(organization_id, project_id),
      FOREIGN KEY(organization_id, project_id, list_id) REFERENCES project_lists(organization_id, project_id, id) ON DELETE CASCADE,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS project_list_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);`);
    const columns = new Set(db.prepare('PRAGMA table_info(project_lists)').all().map(column => column.name));
    if (!columns.has('layout_json')) db.exec('ALTER TABLE project_lists ADD COLUMN layout_json TEXT CHECK(layout_json IS NULL OR json_valid(layout_json))');
    db.exec(`CREATE TABLE IF NOT EXISTS project_list_templates (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      layout_json TEXT NOT NULL CHECK(json_valid(layout_json)),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(organization_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_project_list_templates_organization ON project_list_templates(organization_id, updated_at);
    CREATE TABLE IF NOT EXISTS project_list_template_versions (
      organization_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision > 0),
      name TEXT NOT NULL,
      layout_json TEXT NOT NULL CHECK(json_valid(layout_json)),
      created_at TEXT NOT NULL,
      PRIMARY KEY(organization_id, template_id, revision),
      FOREIGN KEY(organization_id, template_id) REFERENCES project_list_templates(organization_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS project_list_images (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
      content BLOB NOT NULL CHECK(length(content) <= 524288),
      created_at TEXT NOT NULL,
      UNIQUE(organization_id, project_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_project_list_images_project ON project_list_images(organization_id, project_id);`);
    for (const table of ['project_lists', 'project_list_templates', 'project_list_template_versions']) {
      const existing = db.prepare(`PRAGMA table_info(${table})`).all();
      if (!existing.some(column => column.name === 'workbook_json')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN workbook_json TEXT CHECK(workbook_json IS NULL OR json_valid(workbook_json))`);
      }
    }
    db.prepare('INSERT OR IGNORE INTO project_list_migrations(version, applied_at) VALUES(?, ?)').run('project-lists-workbook-v1', new Date().toISOString());
    db.prepare('INSERT OR IGNORE INTO project_list_migrations(version, applied_at) VALUES(?, ?)').run('project-lists-bom-v1', new Date().toISOString());
    const version = 'project-lists-v1';
    if (db.prepare('SELECT 1 FROM project_list_migrations WHERE version = ?').get(version)) return;
    const timestamp = new Date().toISOString();
    // Snapshot the original quote rows once. Later quote changes must not overwrite an edited list.
    for (const project of db.prepare('SELECT * FROM projects').all()) {
      const organizationId = project.organization_id, projectId = project.id;
      const quotes = db.prepare('SELECT * FROM quotes WHERE organization_id = ? AND project_id = ? ORDER BY updated_at DESC, id').all(organizationId, projectId);
      const parts = db.prepare('SELECT * FROM parts WHERE organization_id = ? AND project_id = ? ORDER BY created_at, id').all(organizationId, projectId);
      const partById = new Map(parts.map(part => [part.id, part]));
      const quotedPartIds = new Set();
      const partItem = part => ({ id: part.id, partId: part.id, name: part.name, revision: '', material: part.material,
        finish: part.finish, dimensions: part.dimensions, quantity: part.quantity, notes: '', format: part.format });
      let initialId = null;
      for (const quote of quotes) {
        const items = db.prepare('SELECT * FROM quote_lines WHERE organization_id = ? AND quote_id = ? ORDER BY created_at, rowid').all(organizationId, quote.id).map(line => {
          const part = partById.get(line.part_id);
          if (part) quotedPartIds.add(part.id);
          return { id: line.id, partId: part?.id || null, name: line.name, revision: '', material: line.material,
            finish: line.process || part?.finish || '', dimensions: part?.dimensions || '', quantity: line.quantity,
            notes: '', format: part?.format || '' };
        });
        const listId = identifier();
        insert({ id: listId, organizationId, projectId, title: quote.quote_no || '项目清单', items, sourceQuoteId: quote.id,
          createdAt: quote.created_at, updatedAt: quote.updated_at });
        initialId ||= listId;
      }
      const unquotedParts = quotes.length ? parts.filter(part => !quotedPartIds.has(part.id)) : [];
      if (unquotedParts.length) {
        insert({ id: identifier(), organizationId, projectId, title: '项目零件清单', items: unquotedParts.map(partItem),
          createdAt: project.created_at, updatedAt: project.updated_at });
      }
      if (!quotes.length) {
        const legacyTitle = db.prepare('SELECT project_list FROM tasks WHERE organization_id = ? AND project_id = ? AND id = ?')
          .get(organizationId, projectId, project.root_task_id)?.project_list?.trim() || '';
        if (parts.length || legacyTitle) {
          initialId = identifier();
          insert({ id: initialId, organizationId, projectId, title: legacyTitle.slice(0, 160) || `${project.title}清单`.slice(0, 160),
            items: parts.map(partItem), createdAt: project.created_at, updatedAt: project.updated_at });
        }
      }
      if (initialId) select(organizationId, projectId, initialId, timestamp);
    }
    db.prepare('INSERT INTO project_list_migrations(version, applied_at) VALUES(?, ?)').run(version, timestamp);
  });
  const authorize = (organizationId, userId, projectId, write = false) => {
    const membership = api.getMembership(userId, organizationId);
    if (!membership) fail(403, 'project_list_access_denied', '无权访问此企业的项目清单');
    const actor = { role: membership.role, permissions: api.getMemberPermissions(organizationId, userId) };
    if (!api.listOrganizationModules(organizationId).projects) fail(403, 'module_disabled', '当前企业未启用项目模块');
    const project = api.getProject(organizationId, projectId);
    if (!project) fail(404, 'project_not_found', '项目不存在或已移入回收站');
    if (!['owner', 'admin'].includes(actor.role) && !api.isProjectMember(organizationId, projectId, userId)) {
      fail(403, 'project_access_denied', '当前成员未加入此项目');
    }
    if (!enterpriseCan(actor, 'project.list.read') || write && !enterpriseCan(actor, 'project.list.write')) {
      fail(403, 'project_list_permission_denied', write ? '未获得新增和编辑项目清单权限' : '未获得查看项目清单权限');
    }
    return { canRead: true, canWrite: enterpriseCan(actor, 'project.list.write') };
  };
  const normalizeLayout = (organizationId, input, current = null) => {
    if (input === undefined) return current;
    const layout = schemaValue(() => normalizeBomLayout(input));
    if (layout.templateId) {
      const source = db.prepare('SELECT 1 FROM project_list_template_versions WHERE organization_id = ? AND template_id = ? AND revision = ?')
        .get(organizationId, layout.templateId, layout.templateRevision);
      if (!source) fail(400, 'invalid_bom_template', 'BOM 模板或指定版本不存在于当前企业');
    }
    return layout;
  };
  const normalizeItems = (organizationId, projectId, items, layout = null, currentItems = []) => {
    if (!Array.isArray(items) || items.length > 500) fail(400, 'invalid_project_list_items', '每份清单最多允许 500 个零件');
    const used = new Set();
    const previous = new Map(currentItems.map(item => [item.id, item]));
    return items.map(item => {
      object(item, ['id', 'partId', 'name', 'revision', 'material', 'finish', 'dimensions', 'quantity', 'notes', 'format', 'imageId', 'customValues', 'cellStyles']);
      const itemId = item.id === undefined || item.id === '' ? `list_item_${randomUUID()}` : text(item.id, 100, true);
      if (used.has(itemId)) fail(400, 'duplicate_project_list_item', '清单行标识不能重复');
      used.add(itemId);
      const partId = item.partId == null || item.partId === '' ? null : text(item.partId, 100, true);
      if (partId) {
        const part = api.getPart(organizationId, partId);
        if (!part || part.projectId !== projectId) fail(400, 'invalid_project_list_part', '关联零件必须属于当前项目');
      }
      const quantity = layout && (item.quantity == null || item.quantity === '') ? null : item.quantity;
      if (!(layout && quantity === null) && (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000_000)) {
        fail(400, 'invalid_project_list_quantity', '数量必须为正整数且不超过 1000000000');
      }
      const old = previous.get(itemId);
      const imageInput = item.imageId === undefined ? old?.imageId : item.imageId;
      const imageId = imageInput == null || imageInput === '' ? null : text(imageInput, 100, true);
      if (imageId && !db.prepare('SELECT 1 FROM project_list_images WHERE organization_id = ? AND project_id = ? AND id = ?').get(organizationId, projectId, imageId)) {
        fail(400, 'invalid_bom_image', '清单图片必须属于当前项目');
      }
      const customLayout = layout || defaultBomLayout();
      const definedCustomKeys = new Set(customLayout.columns.filter(column => column.key.startsWith('custom_')).map(column => column.key));
      const retainedValues = Object.fromEntries(Object.entries(old?.customValues || {}).filter(([key]) => definedCustomKeys.has(key)));
      const customInput = item.customValues === undefined ? undefined
        : schemaValue(() => normalizeBomCustomValues(item.customValues, customLayout));
      const customValues = item.customValues === undefined && old?.customValues === undefined ? undefined
        : schemaValue(() => normalizeBomCustomValues({ ...retainedValues, ...customInput }, customLayout));
      const definedKeys = new Set(customLayout.columns.map(column => column.key));
      const styleInput = item.cellStyles === undefined
        ? old?.cellStyles === undefined ? undefined : Object.fromEntries(Object.entries(old.cellStyles).filter(([key]) => definedKeys.has(key)))
        : item.cellStyles;
      const cellStyles = styleInput === undefined ? undefined : schemaValue(() => normalizeBomCellStyles(styleInput, customLayout));
      return { id: itemId, partId, name: text(layout ? item.name ?? '' : item.name, 160, !layout), revision: text(item.revision ?? '', 80),
        material: text(item.material ?? '', 80), finish: text(item.finish ?? '', 160),
        dimensions: text(item.dimensions ?? '', 160), quantity,
        notes: text(item.notes ?? '', 2000), format: text(item.format ?? '', 40),
        ...(imageInput === undefined ? {} : { imageId }), ...(customValues === undefined ? {} : { customValues }),
        ...(cellStyles === undefined ? {} : { cellStyles }) };
    });
  };
  const get = (organizationId, projectId, listId) => {
    const row = find(organizationId, projectId, listId);
    if (!row) fail(404, 'project_list_not_found', '项目清单不存在');
    return fromRow(row);
  };
  api.listProjectLists = (organizationId, userId, projectId) => {
    const capabilities = authorize(organizationId, userId, projectId);
    const lists = db.prepare('SELECT * FROM project_lists WHERE organization_id = ? AND project_id = ? ORDER BY updated_at DESC, id')
      .all(organizationId, projectId).map(row => {
        const { items, workbook, ...summary } = fromRow(row);
        return { ...summary, hasWorkbook: Boolean(workbook), itemCount: items.length };
      });
    const selectedListId = selected(organizationId, projectId);
    return { lists, selectedListId, list: selectedListId ? get(organizationId, projectId, selectedListId) : null, capabilities };
  };
  api.getProjectList = (organizationId, userId, projectId, listId) => {
    authorize(organizationId, userId, projectId);
    return get(organizationId, projectId, listId);
  };
  api.createProjectList = (organizationId, userId, projectId, input) => transaction(() => {
    authorize(organizationId, userId, projectId, true);
    object(input, ['title', 'items', 'sourceQuoteId', 'layout', 'workbook']);
    const workbook = input.workbook == null ? null : workbookValue(input.workbook);
    const layout = normalizeLayout(organizationId, input.layout);
    const title = text(input.title, 160, true), items = normalizeItems(organizationId, projectId, input.items ?? (workbook ? [] : undefined), layout);
    const sourceQuoteId = input.sourceQuoteId == null || input.sourceQuoteId === '' ? null : text(input.sourceQuoteId, 100, true);
    if (sourceQuoteId) {
      if (!db.prepare('SELECT 1 FROM quotes WHERE organization_id = ? AND project_id = ? AND id = ?').get(organizationId, projectId, sourceQuoteId)) {
        fail(400, 'invalid_project_list_source', '来源记录必须属于当前项目');
      }
      if (db.prepare('SELECT 1 FROM project_lists WHERE organization_id = ? AND project_id = ? AND source_quote_id = ?').get(organizationId, projectId, sourceQuoteId)) {
        fail(409, 'project_list_source_exists', '此来源已生成项目清单');
      }
    }
    const listId = identifier(), timestamp = new Date().toISOString();
    insert({ id: listId, organizationId, projectId, title, items, layout, workbook, sourceQuoteId, createdAt: timestamp, updatedAt: timestamp });
    select(organizationId, projectId, listId, timestamp);
    api.addAudit({ organizationId, userId, action: 'project_list.create', entityType: 'project_list', entityId: listId, metadata: { projectId, title, itemCount: items.length } });
    return { list: get(organizationId, projectId, listId), selectedListId: listId };
  });
  api.selectProjectList = (organizationId, userId, projectId, input) => transaction(() => {
    authorize(organizationId, userId, projectId, true);
    object(input, ['listId']);
    const listId = input.listId === null ? null : text(input.listId, 100, true);
    const list = listId ? get(organizationId, projectId, listId) : null;
    const previousListId = selected(organizationId, projectId);
    if (previousListId !== listId) {
      select(organizationId, projectId, listId, new Date().toISOString());
      api.addAudit({ organizationId, userId, action: 'project_list.select', entityType: 'project', entityId: projectId, metadata: { previousListId, listId } });
    }
    return { list, selectedListId: listId };
  });
  api.updateProjectList = (organizationId, userId, projectId, listId, input) => transaction(() => {
    authorize(organizationId, userId, projectId, true);
    object(input, ['title', 'items', 'revision', 'layout', 'workbook']);
    const current = get(organizationId, projectId, listId);
    if (!Number.isSafeInteger(input.revision) || input.revision < 1) fail(400, 'invalid_project_list_revision', '缺少有效的清单版本');
    if (input.revision !== current.revision) fail(409, 'project_list_conflict', '清单已被其他人修改，请重新打开后再编辑');
    if (current.workbook && input.workbook == null) fail(409, 'bom_workbook_required', '此清单已升级为电子表格，请刷新页面后使用新版编辑器保存');
    const workbook = input.workbook == null ? null : workbookValue(input.workbook);
    const layout = normalizeLayout(organizationId, input.layout, current.layout);
    const title = text(input.title, 160, true), items = workbook ? current.items : normalizeItems(organizationId, projectId, input.items, layout, current.items);
    db.prepare('UPDATE project_lists SET title = ?, items_json = ?, layout_json = ?, workbook_json = ?, revision = revision + 1, updated_at = ? WHERE organization_id = ? AND project_id = ? AND id = ? AND revision = ?')
      .run(title, JSON.stringify(items), layout ? JSON.stringify(layout) : null, workbook ? JSON.stringify(workbook) : null,
        new Date().toISOString(), organizationId, projectId, listId, input.revision);
    api.addAudit({ organizationId, userId, action: 'project_list.update', entityType: 'project_list', entityId: listId,
      metadata: { projectId, title, revision: current.revision + 1, itemCount: items.length } });
    return get(organizationId, projectId, listId);
  });
  const templateAccess = (organizationId, userId, projectId, write = false) => {
    const capabilities = authorize(organizationId, userId, projectId, write);
    const role = api.getMembership(userId, organizationId).role;
    const canManageTemplates = capabilities.canWrite && ['owner', 'admin'].includes(role);
    if (write && !canManageTemplates) fail(403, 'bom_template_management_denied', '仅获授权的企业管理者可以维护 BOM 模板');
    return { canManageTemplates };
  };
  const saveTemplateVersion = row => db.prepare(`INSERT INTO project_list_template_versions(organization_id, template_id, revision, name, layout_json, workbook_json, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?)`).run(row.organization_id, row.id, row.revision, row.name, row.layout_json, row.workbook_json || null, row.updated_at);
  const templateWorkbook = input => {
    if (input.includeContent !== undefined && typeof input.includeContent !== 'boolean') fail(400, 'invalid_bom_template', '模板内容选项必须为布尔值');
    if (input.workbook == null) return null;
    const workbook = workbookValue(input.workbook);
    return bomWorkbookTemplate(workbook, { includeContent: input.includeContent === true, name: text(input.name, 100, true) });
  };
  api.listProjectListTemplates = (organizationId, userId, projectId) => {
    const capabilities = templateAccess(organizationId, userId, projectId);
    const templates = db.prepare('SELECT * FROM project_list_templates WHERE organization_id = ? ORDER BY updated_at DESC, id')
      .all(organizationId).map(templateFromRow);
    return { templates, capabilities };
  };
  api.createProjectListTemplate = (organizationId, userId, projectId, input) => transaction(() => {
    templateAccess(organizationId, userId, projectId, true);
    object(input, ['name', 'layout', 'workbook', 'includeContent']);
    const workbook = templateWorkbook(input);
    const name = text(input.name, 100, true), layout = schemaValue(() => normalizeBomLayout(input.layout ?? (workbook ? defaultBomLayout() : undefined)));
    delete layout.templateId;
    delete layout.templateRevision;
    const row = { id: `bom_template_${randomUUID()}`, organization_id: organizationId, name, layout_json: JSON.stringify(layout), workbook_json: workbook ? JSON.stringify(workbook) : null,
      revision: 1, created_at: new Date().toISOString() };
    row.updated_at = row.created_at;
    db.prepare(`INSERT INTO project_list_templates(id, organization_id, name, layout_json, workbook_json, revision, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)`).run(row.id, organizationId, name, row.layout_json, row.workbook_json, row.revision, row.created_at, row.updated_at);
    saveTemplateVersion(row);
    api.addAudit({ organizationId, userId, action: 'project_list.template.create', entityType: 'project_list_template', entityId: row.id,
      metadata: { name, revision: row.revision } });
    return { template: templateFromRow(row) };
  });
  api.updateProjectListTemplate = (organizationId, userId, projectId, templateId, input) => transaction(() => {
    templateAccess(organizationId, userId, projectId, true);
    object(input, ['name', 'layout', 'revision', 'workbook', 'includeContent']);
    const current = db.prepare('SELECT * FROM project_list_templates WHERE organization_id = ? AND id = ?').get(organizationId, templateId);
    if (!current) fail(404, 'bom_template_not_found', 'BOM 模板不存在');
    if (!Number.isSafeInteger(input.revision) || input.revision < 1) fail(400, 'invalid_bom_template_revision', '缺少有效的 BOM 模板版本');
    if (current.revision !== input.revision) fail(409, 'bom_template_conflict', 'BOM 模板已被其他人修改，请重新打开');
    if (current.workbook_json && input.workbook == null) fail(409, 'bom_workbook_required', '此模板已升级为电子表格，请刷新页面后使用新版编辑器保存');
    const workbook = templateWorkbook(input);
    const name = text(input.name, 100, true), layout = schemaValue(() => normalizeBomLayout(input.layout ?? (workbook ? JSON.parse(current.layout_json) : undefined)));
    delete layout.templateId;
    delete layout.templateRevision;
    const row = { ...current, name, layout_json: JSON.stringify(layout), workbook_json: workbook ? JSON.stringify(workbook) : null, revision: current.revision + 1, updated_at: new Date().toISOString() };
    db.prepare('UPDATE project_list_templates SET name = ?, layout_json = ?, workbook_json = ?, revision = ?, updated_at = ? WHERE organization_id = ? AND id = ?')
      .run(row.name, row.layout_json, row.workbook_json, row.revision, row.updated_at, organizationId, templateId);
    saveTemplateVersion(row);
    api.addAudit({ organizationId, userId, action: 'project_list.template.update', entityType: 'project_list_template', entityId: templateId,
      metadata: { name, revision: row.revision } });
    return { template: templateFromRow(row) };
  });
  const getImage = (organizationId, userId, projectId, imageId) => {
    authorize(organizationId, userId, projectId);
    const row = db.prepare('SELECT * FROM project_list_images WHERE organization_id = ? AND project_id = ? AND id = ?').get(organizationId, projectId, imageId);
    if (!row) fail(404, 'bom_image_not_found', 'BOM 图片不存在');
    return row;
  };
  api.getProjectListImage = (...args) => ({ image: imageFromRow(getImage(...args)) });
  api.getProjectListImageContent = (...args) => {
    const row = getImage(...args);
    return { content: Buffer.from(row.content), mimeType: row.mime_type };
  };
  api.createProjectListImage = (organizationId, userId, projectId, input) => transaction(() => {
    authorize(organizationId, userId, projectId, true);
    object(input, ['name', 'dataUrl']);
    const name = text(input.name, 160, true);
    if (typeof input.dataUrl !== 'string' || input.dataUrl.length > 700_000) fail(400, 'invalid_bom_image', '图片必须为 512 KiB 以内的 PNG、JPEG 或 WebP');
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.dataUrl);
    if (!match) fail(400, 'invalid_bom_image', '图片必须为 PNG、JPEG 或 WebP');
    const content = Buffer.from(match[2], 'base64'), mimeType = match[1];
    if (!content.length || content.length > 524_288 || content.toString('base64') !== match[2]) fail(400, 'invalid_bom_image', '图片编码不正确或超过 512 KiB');
    const isPng = content.length >= 45 && content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && content.subarray(12, 16).toString('ascii') === 'IHDR' && content.readUInt32BE(8) === 13
      && content.readUInt32BE(16) > 0 && content.readUInt32BE(20) > 0
      && content.subarray(content.length - 8, content.length - 4).toString('ascii') === 'IEND';
    const isJpeg = content.length >= 12 && content[0] === 255 && content[1] === 216 && content[2] === 255
      && content[content.length - 2] === 255 && content[content.length - 1] === 217;
    const isWebp = content.length >= 20 && content.subarray(0, 4).toString('ascii') === 'RIFF'
      && content.subarray(8, 12).toString('ascii') === 'WEBP' && content.readUInt32LE(4) === content.length - 8
      && ['VP8 ', 'VP8L', 'VP8X'].includes(content.subarray(12, 16).toString('ascii'));
    if (!(mimeType === 'image/png' && isPng || mimeType === 'image/jpeg' && isJpeg || mimeType === 'image/webp' && isWebp)) {
      fail(400, 'invalid_bom_image', '图片文件内容与格式不匹配');
    }
    const imageId = `bom_image_${randomUUID()}`;
    db.prepare('INSERT INTO project_list_images(id, organization_id, project_id, name, mime_type, content, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
      .run(imageId, organizationId, projectId, name, mimeType, content, new Date().toISOString());
    api.addAudit({ organizationId, userId, action: 'project_list.image.create', entityType: 'project_list_image', entityId: imageId,
      metadata: { projectId, name, bytes: content.length } });
    return { image: { id: imageId, name, dataUrl: `data:${mimeType};base64,${content.toString('base64')}` } };
  });
  api.importProjectList = (organizationId, userId, projectId, input) => transaction(() => {
    authorize(organizationId, userId, projectId, true);
    const membership = api.getMembership(userId, organizationId);
    const actor = { role: membership.role, permissions: api.getMemberPermissions(organizationId, userId) };
    const modules = api.listOrganizationModules(organizationId);
    if (!modules.parts || !modules.workspace || !enterpriseCan(actor, 'part.write') || !enterpriseCan(actor, 'quote.write')) {
      fail(403, 'project_list_import_denied', '导入清单需要零件和报价维护权限，并启用零件与制表模块');
    }
    object(input, ['parts', 'quoteMeta', 'fairItems']);
    if (!Array.isArray(input.parts) || !input.parts.length || input.parts.length > 500) fail(400, 'invalid_project_list_items', '请导入 1 至 500 项零件');
    const quoteMeta = input.quoteMeta ?? {};
    object(quoteMeta, ['quoteNo', 'currency']);
    const quoteNo = text(quoteMeta.quoteNo || `QT-${Date.now()}`, 80, true);
    const currency = text(quoteMeta.currency || 'CNY', 8, true);
    const fairItems = input.fairItems ?? [];
    if (!Array.isArray(fairItems) || fairItems.length > 500) fail(400, 'invalid_fair_items', '检验项数量不正确');
    if (fairItems.length && !enterpriseCan(actor, 'fair.write')) fail(403, 'fair_write_denied', '未获得维护质检权限');
    const knownParts = api.listParts(organizationId, projectId);
    const parts = [], items = [], lines = [];
    let total = 0;
    for (const source of input.parts) {
      object(source, ['clientId', 'partId', 'name', 'format', 'material', 'finish', 'dimensions', 'volume', 'quantity', 'revision', 'notes', 'process', 'unitPriceCents']);
      const normalized = normalizeItems(organizationId, projectId, [{ name: source.name, partId: source.partId,
        format: source.format, material: source.material, finish: source.finish, dimensions: source.dimensions,
        quantity: source.quantity, revision: source.revision, notes: source.notes }])[0];
      const data = { name: normalized.name, format: text(normalized.format || 'STEP', 20), material: normalized.material,
        finish: text(normalized.finish, 120), dimensions: text(normalized.dimensions, 120), volume: text(source.volume ?? '', 60), quantity: normalized.quantity };
      const clientId = text(source.clientId ?? '', 100);
      const process = text(source.process ?? '', 80);
      const unitPriceCents = source.unitPriceCents ?? 0;
      total += unitPriceCents * normalized.quantity;
      if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0 || !Number.isSafeInteger(total)) fail(400, 'invalid_quote_amount', '报价金额不正确');
      const existing = normalized.partId ? knownParts.find(part => part.id === normalized.partId)
        : knownParts.find(part => part.name.trim().toLowerCase() === normalized.name.toLowerCase());
      const part = existing ? api.updatePart(organizationId, existing.id, data) : api.createPart({ organizationId, projectId, ...data });
      if (!part) fail(404, 'project_not_found', '项目或零件已不可用');
      if (!existing) knownParts.push(part);
      parts.push({ ...part, clientId });
      items.push({ ...normalized, partId: part.id });
      lines.push({ partId: part.id, name: normalized.name, material: normalized.material, process, quantity: normalized.quantity, unitPriceCents });
      api.addAudit({ organizationId, userId, action: existing ? 'part.update' : 'part.create', entityType: 'part', entityId: part.id, metadata: { projectId, name: part.name } });
    }
    for (const source of fairItems) {
      object(source, ['partId', 'characteristic', 'nominal', 'tolerance', 'status']);
      const partId = source.partId ? text(source.partId, 100, true) : null;
      if (partId && !knownParts.some(part => part.id === partId)) fail(400, 'invalid_fair_part', '检验零件必须属于当前项目');
      const status = text(source.status || 'pending', 30);
      if (!['pending', 'pass', 'fail'].includes(status)) fail(400, 'invalid_fair_status', '检验状态不正确');
      const item = api.createFairItem({ organizationId, projectId, partId, characteristic: text(source.characteristic, 160, true), nominal: text(source.nominal ?? '', 80), tolerance: text(source.tolerance ?? '', 80), status });
      api.addAudit({ organizationId, userId, action: 'fair.create', entityType: 'fair_item', entityId: item.id, metadata: { projectId, characteristic: item.characteristic } });
    }
    const previous = api.listQuotes(organizationId, projectId).find(quote => quote.quoteNo === quoteNo);
    const quote = previous ? api.updateQuote({ organizationId, projectId, quoteId: previous.id, quoteNo, currency, lines })
      : api.createQuote({ organizationId, projectId, userId, quoteNo, currency, lines });
    api.addAudit({ organizationId, userId, action: previous ? 'quote.update' : 'quote.create', entityType: 'quote', entityId: quote.id, metadata: { projectId, quoteNo, totalCents: quote.totalCents } });
    // Each import is a new snapshot; existing lists may contain manual production edits.
    const linked = db.prepare('SELECT 1 FROM project_lists WHERE organization_id = ? AND project_id = ? AND source_quote_id = ?').get(organizationId, projectId, quote.id);
    const count = db.prepare('SELECT COUNT(*) AS count FROM project_lists WHERE organization_id = ? AND project_id = ?').get(organizationId, projectId).count;
    const result = api.createProjectList(organizationId, userId, projectId, { title: linked ? `${quoteNo} / 导入 ${count + 1}` : quoteNo,
      items, ...(linked ? {} : { sourceQuoteId: quote.id }) });
    return { ...result, parts, quote };
  });
  return api;
}

export function registerProjectListRoutes(router, { db, requireAuth, jsonError }) {
  const handle = operation => ctx => {
    try { operation(ctx); }
    catch (error) {
      if (!(error instanceof ProjectListError)) throw error;
      jsonError(ctx, error.status, error.code, error.message);
    }
  };
  const args = ctx => [ctx.state.session.organizationId, ctx.state.session.userId, ctx.params.projectId];
  router.get('/projects/:projectId/lists', requireAuth, handle(ctx => { ctx.body = db.listProjectLists(...args(ctx)); }));
  router.post('/projects/:projectId/lists', requireAuth, handle(ctx => {
    ctx.body = db.createProjectList(...args(ctx), ctx.request.body);
    ctx.status = 201;
  }));
  router.post('/projects/:projectId/lists/import', requireAuth, handle(ctx => {
    ctx.body = db.importProjectList(...args(ctx), ctx.request.body);
    ctx.status = 201;
  }));
  router.put('/projects/:projectId/lists/selection', requireAuth, handle(ctx => { ctx.body = db.selectProjectList(...args(ctx), ctx.request.body); }));
  router.get('/projects/:projectId/lists/templates', requireAuth, handle(ctx => { ctx.body = db.listProjectListTemplates(...args(ctx)); }));
  router.post('/projects/:projectId/lists/templates', requireAuth, handle(ctx => {
    ctx.body = db.createProjectListTemplate(...args(ctx), ctx.request.body);
    ctx.status = 201;
  }));
  router.put('/projects/:projectId/lists/templates/:templateId', requireAuth, handle(ctx => {
    ctx.body = db.updateProjectListTemplate(...args(ctx), ctx.params.templateId, ctx.request.body);
  }));
  router.post('/projects/:projectId/lists/images', requireAuth, handle(ctx => {
    ctx.set('Cache-Control', 'private, no-store');
    ctx.body = db.createProjectListImage(...args(ctx), ctx.request.body);
    ctx.status = 201;
  }));
  router.get('/projects/:projectId/lists/images/:imageId', requireAuth, handle(ctx => {
    ctx.set('Cache-Control', 'private, no-store');
    ctx.body = db.getProjectListImage(...args(ctx), ctx.params.imageId);
  }));
  router.post('/projects/:projectId/list-images', requireAuth, handle(ctx => {
    ctx.set('Cache-Control', 'private, no-store');
    ctx.body = db.createProjectListImage(...args(ctx), ctx.request.body);
    ctx.status = 201;
  }));
  router.get('/projects/:projectId/list-images/:imageId', requireAuth, handle(ctx => {
    const image = db.getProjectListImageContent(...args(ctx), ctx.params.imageId);
    ctx.set('Cache-Control', 'private, no-store');
    ctx.set('X-Content-Type-Options', 'nosniff');
    ctx.type = image.mimeType;
    ctx.body = image.content;
  }));
  router.get('/projects/:projectId/lists/:listId', requireAuth, handle(ctx => { ctx.body = { list: db.getProjectList(...args(ctx), ctx.params.listId) }; }));
  router.put('/projects/:projectId/lists/:listId', requireAuth, handle(ctx => { ctx.body = { list: db.updateProjectList(...args(ctx), ctx.params.listId, ctx.request.body) }; }));
}

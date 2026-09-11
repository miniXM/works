import { randomUUID, randomInt } from 'node:crypto';
import { compileAutomation, AUTOMATION_TEMPLATES } from '../automation-language.js';

export class AutomationError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new AutomationError(status, code, message); };
const now = () => new Date().toISOString();
const id = () => `automation_${randomUUID()}`;
const name = value => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) fail(400, 'invalid_automation_name', '名称不能为空且不能超过 100 字符');
  return value.trim();
};
const ruleFromRow = row => row && ({ id: row.id, name: row.name, source: row.source, enabled: Boolean(row.enabled), position: row.position, revision: row.revision });

export function instrumentAutomations(api, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS automation_migrations (organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE, version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS automation_rules (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, name TEXT NOT NULL, source TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS automation_rules_tenant ON automation_rules(organization_id, position);
    CREATE TABLE IF NOT EXISTS automation_sets (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, name TEXT NOT NULL, user_ids TEXT NOT NULL, UNIQUE(organization_id,name));
    CREATE TABLE IF NOT EXISTS automation_runs (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, rule_id TEXT NOT NULL, rule_name TEXT NOT NULL, entity_id TEXT NOT NULL, event_type TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS automation_runs_tenant ON automation_runs(organization_id,sequence);
    CREATE TABLE IF NOT EXISTS automation_creators (organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, entity_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(organization_id,entity_id));
    CREATE TABLE IF NOT EXISTS automation_task_participants (organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, subtask_id TEXT NOT NULL DEFAULT '', user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(organization_id,task_id,subtask_id,user_id));
  `);
  const transaction = callback => {
    const point = `automation_${randomUUID().replaceAll('-', '')}`;
    db.exec(`SAVEPOINT ${point}`);
    try { const result = callback(); db.exec(`RELEASE ${point}`); return result; }
    catch (error) { db.exec(`ROLLBACK TO ${point}`); db.exec(`RELEASE ${point}`); throw error; }
  };
  const ensureDefaults = organizationId => transaction(() => {
    const migration = db.prepare('SELECT version FROM automation_migrations WHERE organization_id = ?').get(organizationId);
    if (!migration) {
      for (const [position, template] of AUTOMATION_TEMPLATES.slice(0, 3).entries()) db.prepare('INSERT INTO automation_rules(id,organization_id,name,source,enabled,position,revision) VALUES(?,?,?,?,1,?,1)')
        .run(id(), organizationId, template.name, template.source, position);
      db.prepare('INSERT INTO automation_migrations VALUES(?,2)').run(organizationId);
      return;
    }
    if (migration.version < 2 && !db.prepare('SELECT 1 FROM automation_rules WHERE organization_id=? AND name=?').get(organizationId, AUTOMATION_TEMPLATES[2].name)) {
      const position = Number(db.prepare('SELECT COALESCE(MAX(position), -1) AS position FROM automation_rules WHERE organization_id=?').get(organizationId).position) + 1;
      db.prepare('INSERT INTO automation_rules(id,organization_id,name,source,enabled,position,revision) VALUES(?,?,?,?,1,?,1)').run(id(), organizationId, AUTOMATION_TEMPLATES[2].name, AUTOMATION_TEMPLATES[2].source, position);
      db.prepare('UPDATE automation_migrations SET version=2 WHERE organization_id=?').run(organizationId);
    }
  });
  for (const row of db.prepare('SELECT id FROM organizations').all()) ensureDefaults(row.id);
  const owner = (organizationId, actorUserId) => {
    if (api.getMembership(actorUserId, organizationId)?.role !== 'owner') fail(403, 'automation_owner_required', '仅企业主管理可管理自动化功能');
    ensureDefaults(organizationId);
  };
  const rules = organizationId => db.prepare('SELECT * FROM automation_rules WHERE organization_id = ? ORDER BY position,id').all(organizationId).map(ruleFromRow);
  const sets = organizationId => db.prepare('SELECT * FROM automation_sets WHERE organization_id = ? ORDER BY name,id').all(organizationId).map(row => ({ id: row.id, name: row.name, userIds: JSON.parse(row.user_ids) }));
  const memberByName = (organizationId, value) => {
    const members = api.listMembers(organizationId);
    // Account names and IDs are stable identifiers even if another member uses
    // the same text as their display name. Display-name fallback stays strict.
    const identity = members.find(member => member.id === value || member.username === value);
    if (identity) return identity;
    const matches = members.filter(member => member.displayName === value);
    if (matches.length !== 1) fail(400, 'automation_member_invalid', matches.length ? `成员「${value}」有重名，请使用唯一账号或成员 ID` : `成员「${value}」不存在或不属于当前企业`);
    return matches[0];
  };
  const setByName = (organizationId, value) => {
    const matches = sets(organizationId).filter(set => set.name === value || set.id === value);
    if (matches.length !== 1) fail(400, 'automation_set_invalid', `集合「${value}」不存在或名称有歧义`);
    return matches[0];
  };
  const memberIds = (organizationId, values) => {
    if (!Array.isArray(values) || !values.length || values.length > 500 || values.some(value => typeof value !== 'string')) fail(400, 'automation_set_members_invalid', '集合应选择 1 至 500 名企业成员');
    const unique = [...new Set(values)];
    if (unique.some(value => !api.getMembership(value, organizationId))) fail(400, 'automation_member_invalid', '集合包含不存在或不属于当前企业的成员');
    return unique;
  };
  const validateReferences = (organizationId, body) => {
    for (const statement of body) {
      if (statement.type === 'if') { validateReferences(organizationId, statement.then); validateReferences(organizationId, statement.else); continue; }
      try {
        if (statement.type === 'declare_array') for (const member of statement.members) memberByName(organizationId, member.name);
        if (statement.recipient?.type === 'member') memberByName(organizationId, statement.recipient.name);
        if (['set', 'random'].includes(statement.recipient?.type)) memberIds(organizationId, setByName(organizationId, statement.recipient.name).userIds);
      } catch (error) { error.message = `第 ${statement.line} 行：${error.message}`; throw error; }
    }
  };
  const validateRule = (organizationId, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'invalid_automation', '请提供规则内容');
    const ruleName = name(input.name);
    if (typeof input.enabled !== 'boolean') fail(400, 'invalid_automation_enabled', '启用状态必须为布尔值');
    const program = compileAutomation(input.source);
    validateReferences(organizationId, program.body);
    return { name: ruleName, source: input.source.trim(), enabled: input.enabled };
  };
  const getRule = (organizationId, ruleId) => {
    const row = db.prepare('SELECT * FROM automation_rules WHERE organization_id = ? AND id = ?').get(organizationId, ruleId);
    if (!row) fail(404, 'automation_not_found', '规则不存在');
    return row;
  };
  const checkRevision = (row, revision) => { if (!Number.isInteger(revision) || row.revision !== revision) fail(409, 'automation_revision_conflict', '规则已被修改，请刷新后重试'); };
  Object.assign(api, {
    listAutomations(organizationId, actorUserId) {
      owner(organizationId, actorUserId);
      return { rules: rules(organizationId), sets: sets(organizationId), members: api.listMembers(organizationId),
        runs: db.prepare('SELECT id,rule_name AS ruleName,status,message,created_at AS createdAt FROM automation_runs WHERE organization_id = ? ORDER BY sequence DESC LIMIT 100').all(organizationId) };
    },
    validateAutomationSource(organizationId, actorUserId, source) { owner(organizationId, actorUserId); const program = compileAutomation(source); validateReferences(organizationId, program.body); return program; },
    createAutomation(organizationId, actorUserId, input) {
      owner(organizationId, actorUserId); const value = validateRule(organizationId, input); const ruleId = id();
      if (rules(organizationId).length >= 100) fail(400, 'automation_limit', '每个企业最多 100 条规则');
      db.prepare('INSERT INTO automation_rules(id,organization_id,name,source,enabled,position,revision) VALUES(?,?,?,?,?,?,1)')
        .run(ruleId, organizationId, value.name, value.source, Number(value.enabled), Math.max(-1, ...rules(organizationId).map(rule => rule.position)) + 1);
      return ruleFromRow(getRule(organizationId, ruleId));
    },
    updateAutomation(organizationId, actorUserId, ruleId, input) {
      owner(organizationId, actorUserId); const current = getRule(organizationId, ruleId); checkRevision(current, input?.revision);
      const value = validateRule(organizationId, input);
      db.prepare('UPDATE automation_rules SET name=?, source=?, enabled=?, revision=revision+1 WHERE organization_id=? AND id=?')
        .run(value.name, value.source, Number(value.enabled), organizationId, ruleId);
      return ruleFromRow(getRule(organizationId, ruleId));
    },
    setAutomationEnabled(organizationId, actorUserId, ruleId, input) {
      owner(organizationId, actorUserId); const current = getRule(organizationId, ruleId); checkRevision(current, input?.revision);
      if (typeof input?.enabled !== 'boolean') fail(400, 'invalid_automation_enabled', '启用状态必须为布尔值');
      // Disabling must remain possible when a saved rule references a departed
      // member or deleted legacy set. Enabling revalidates the persisted source.
      if (input.enabled) validateReferences(organizationId, compileAutomation(current.source).body);
      db.prepare('UPDATE automation_rules SET enabled=?, revision=revision+1 WHERE organization_id=? AND id=?')
        .run(Number(input.enabled), organizationId, ruleId);
      return ruleFromRow(getRule(organizationId, ruleId));
    },
    deleteAutomation(organizationId, actorUserId, ruleId, revision) {
      owner(organizationId, actorUserId); checkRevision(getRule(organizationId, ruleId), revision);
      db.prepare('DELETE FROM automation_rules WHERE organization_id=? AND id=?').run(organizationId, ruleId); return { deleted: true };
    },
    orderAutomations(organizationId, actorUserId, ids) {
      owner(organizationId, actorUserId); const existing = rules(organizationId);
      if (!Array.isArray(ids) || ids.length !== existing.length || new Set(ids).size !== ids.length || ids.some(value => !existing.some(rule => rule.id === value))) fail(400, 'automation_order_invalid', '排序必须完整包含当前企业的全部规则且不能重复');
      transaction(() => ids.forEach((value, index) => db.prepare('UPDATE automation_rules SET position=?, revision=revision+1 WHERE organization_id=? AND id=?').run(index, organizationId, value)));
      return rules(organizationId);
    },
    createAutomationSet(organizationId, actorUserId, input) { return api.saveAutomationSet(organizationId, actorUserId, null, input); },
    saveAutomationSet(organizationId, actorUserId, setId, input) {
      owner(organizationId, actorUserId); const setName = name(input?.name), userIds = memberIds(organizationId, input?.userIds);
      if (setId && !sets(organizationId).some(set => set.id === setId)) fail(404, 'automation_set_not_found', '集合不存在');
      if (sets(organizationId).some(set => set.name === setName && set.id !== setId)) fail(409, 'automation_set_name_conflict', '集合名称已存在');
      const value = setId || id();
      if (setId) db.prepare('UPDATE automation_sets SET name=?,user_ids=? WHERE organization_id=? AND id=?').run(setName, JSON.stringify(userIds), organizationId, value);
      else db.prepare('INSERT INTO automation_sets(id,organization_id,name,user_ids) VALUES(?,?,?,?)').run(value, organizationId, setName, JSON.stringify(userIds));
      return { id: value, name: setName, userIds };
    },
    deleteAutomationSet(organizationId, actorUserId, setId) {
      owner(organizationId, actorUserId);
      if (!db.prepare('DELETE FROM automation_sets WHERE organization_id=? AND id=?').run(organizationId, setId).changes) fail(404, 'automation_set_not_found', '集合不存在');
      return { deleted: true };
    }
  });

  const creatorFor = context => db.prepare('SELECT user_id FROM automation_creators WHERE organization_id=? AND entity_id=?').get(context.organizationId, context.entityId)?.user_id
    || (context.kind === 'subtask' ? api.getTaskSubtask(context.organizationId, context.taskId, context.entityId)?.createdBy
      : context.projectId ? db.prepare('SELECT created_by FROM projects WHERE organization_id=? AND id=?').get(context.organizationId, context.projectId)?.created_by
        : db.prepare("SELECT user_id FROM audit_events WHERE organization_id=? AND entity_id=? AND action='task.create' ORDER BY created_at LIMIT 1").get(context.organizationId, context.entityId)?.user_id);
  const resolveRecipients = (recipient, context) => {
    const organizationId = context.organizationId;
    if (recipient.type === 'none') return [];
    let ids;
    if (recipient.type === 'creator') ids = [creatorFor(context)];
    else if (recipient.type === 'member') ids = [memberByName(organizationId, recipient.name).id];
    else if (['array', 'random_array'].includes(recipient.type)) {
      ids = context.arrays.get(recipient.name);
      if (!ids) fail(400, 'automation_array_undefined', `人员数组「${recipient.name}」尚未定义`);
      if (recipient.type === 'random_array' && !ids.length) fail(400, 'automation_array_empty', `人员数组「${recipient.name}」为空，无法随机选择`);
    }
    else {
      ids = setByName(organizationId, recipient.name).userIds.filter(value => api.getMembership(value, organizationId));
      if (!ids.length) fail(400, 'automation_set_empty', '人员集合已没有有效的企业成员');
    }
    if (ids.some(value => !value || !api.getMembership(value, organizationId))) fail(400, 'automation_member_invalid', '创建人或目标成员已不属于当前企业');
    return ['random', 'random_array'].includes(recipient.type) ? [ids[randomInt(ids.length)]] : ids;
  };
  const snapshot = context => context.kind === 'subtask' ? api.getTaskSubtask(context.organizationId, context.taskId, context.entityId) : api.getTask(context.organizationId, context.taskId);
  const matchesCondition = (condition, context) => {
    const task = { ...snapshot(context), previousStatus: context.previousStatus || '' };
    const creator = api.listMembers(context.organizationId).find(member => member.id === creatorFor(context)) || {};
    return condition.groups.some(group => group.every(clause => {
      const value = String((clause.subject === 'creator' ? creator : task)[clause.field] ?? '');
      if (clause.operator === '等于') return value === clause.value;
      if (clause.operator === '不等于') return value !== clause.value;
      if (clause.operator === '包含') return value.includes(clause.value);
      return !value.includes(clause.value);
    }));
  };
  let running = false;
  const actions = {
    declare_array(statement, context) {
      context.arrays.set(statement.name, [...new Set(statement.members.map(member => memberByName(context.organizationId, member.name).id))]);
    },
    log(statement, context, messages) { messages.push(statement.message); },
    assign(statement, context) {
      const assigneeUserId = resolveRecipients(statement.recipient, context)[0] || null;
      if (context.projectId && assigneeUserId) api.addProjectMember({ organizationId: context.organizationId, projectId: context.projectId, userId: assigneeUserId, createdBy: context.actorUserId });
      const options = { actorUserId: context.actorUserId };
      if (context.kind === 'subtask') api.updateTaskSubtask(context.organizationId, context.taskId, context.entityId, { assigneeUserId }, options);
      else {
        const member = assigneeUserId ? api.listMembers(context.organizationId).find(value => value.id === assigneeUserId) : null;
        api.updateTask(context.organizationId, context.taskId, { assigneeUserId, owner: member?.displayName || member?.username || '' }, options);
        if (context.projectId) db.prepare('UPDATE projects SET executor_user_id=?,updated_at=? WHERE organization_id=? AND id=? AND root_task_id=?')
          .run(assigneeUserId, now(), context.organizationId, context.projectId, context.taskId);
      }
    },
    participants(statement, context) {
      if (!context.projectId) fail(400, 'automation_participant_scope', '参与者动作仅适用于项目任务');
      for (const userId of resolveRecipients(statement.recipient, context)) {
        db.prepare('INSERT OR IGNORE INTO automation_task_participants(organization_id,task_id,subtask_id,user_id) VALUES(?,?,?,?)').run(context.organizationId, context.taskId, context.kind === 'subtask' ? context.entityId : '', userId);
        if (context.projectId) api.addProjectMember({ organizationId: context.organizationId, projectId: context.projectId, userId, createdBy: context.actorUserId });
      }
    }
  };
  const executeBody = (body, context, messages) => {
    for (const statement of body) {
      try {
        if (statement.type === 'if') executeBody(matchesCondition(statement.condition, context) ? statement.then : statement.else, context, messages);
        else actions[statement.type](statement, context, messages);
      } catch (error) { throw new Error(`第 ${statement.line} 行：${error.message}`); }
    }
  };
  const execute = context => {
    if (running) return;
    ensureDefaults(context.organizationId);
    running = true;
    try {
      for (const rule of rules(context.organizationId).filter(rule => rule.enabled)) {
        // The migrated default only supplies a missing assignment. Explicit manual
        // assignments retain their value; other configured rules may override it.
        if (rule.source === AUTOMATION_TEMPLATES[0].source || rule.source === AUTOMATION_TEMPLATES[1].source) {
          if (context.explicitAssignee) continue;
        }
        let program;
        try { program = compileAutomation(rule.source); } catch { continue; } // Persisted source is compiler-validated on every write.
        if (program.event.kind !== context.kind || program.event.type !== context.type) continue;
        let status = 'success', message = '规则执行完成';
        try {
          const messages = [];
          transaction(() => {
            executeBody(program.body, { ...context, arrays: new Map() }, messages);
            api.addAudit({ organizationId: context.organizationId, userId: context.actorUserId, action: 'automation.run', entityType: 'automation', entityId: rule.id,
              metadata: { ruleName: rule.name, taskId: context.taskId, subtaskId: context.kind === 'subtask' ? context.entityId : null, projectId: context.projectId, eventType: context.type } });
          });
          message = messages.join('；') || message;
        } catch (error) { status = 'failed'; message = error.message; }
        db.prepare('INSERT INTO automation_runs(id,organization_id,rule_id,rule_name,entity_id,event_type,status,message,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(id(), context.organizationId, rule.id, rule.name, context.entityId, context.type, status, message.slice(0, 4000), now());
      }
    } finally { running = false; }
  };
  const contextFor = (organizationId, taskId, entityId = taskId, subtask = false) => {
    const task = api.getTask(organizationId, taskId);
    const project = task?.projectId ? api.getProject(organizationId, task.projectId) : null;
    return { organizationId, taskId, entityId, projectId: task?.projectId || null, kind: subtask ? 'subtask' : project?.rootTaskId === taskId ? 'project' : 'task' };
  };
  for (const method of ['createTask', 'createTaskSubtask', 'createProject']) {
    const original = api[method];
    api[method] = function (input) {
      const result = original.call(api, input);
      if (!result || running) return result;
      const taskId = method === 'createProject' ? result.rootTaskId : method === 'createTaskSubtask' ? input.taskId : result.id;
      const entityId = method === 'createProject' ? taskId : result.id;
      if (input.userId) db.prepare('INSERT OR IGNORE INTO automation_creators VALUES(?,?,?)').run(input.organizationId, entityId, input.userId);
      const context = { ...contextFor(input.organizationId, taskId, entityId, method === 'createTaskSubtask'), type: 'created', actorUserId: input.userId, explicitAssignee: Boolean(input.assigneeUserId) || (method === 'createTaskSubtask' && Object.hasOwn(input, 'assigneeUserId') && input.assigneeUserId === null) };
      execute(context);
      return method === 'createProject' ? api.getProject(input.organizationId, result.id) : snapshot(context);
    };
  }
  for (const method of ['updateTask', 'updateTaskSubtask', 'updateProject']) {
    const original = api[method];
    api[method] = function (...args) {
      if (running) return original.apply(api, args);
      const [organizationId, resourceId] = args;
      const taskId = method === 'updateProject' ? api.getProject(organizationId, resourceId)?.rootTaskId : resourceId;
      const context = contextFor(organizationId, taskId, method === 'updateTaskSubtask' ? args[2] : taskId, method === 'updateTaskSubtask');
      const before = snapshot(context);
      const result = original.apply(api, args);
      if (!result) return result;
      const after = snapshot(context);
      if (before && after && before.status !== after.status) execute({ ...context, type: 'status_changed', previousStatus: before.status, actorUserId: (method === 'updateTaskSubtask' ? args[4] : args[3])?.actorUserId });
      return method === 'updateProject' ? api.getProject(organizationId, resourceId) : snapshot(context);
    };
  }
  const createOrganization = api.createOrganization;
  api.createOrganization = function (...args) { const organization = createOrganization.apply(api, args); ensureDefaults(organization.id); return organization; };
  return api;
}

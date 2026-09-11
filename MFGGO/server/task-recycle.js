import { randomUUID } from 'node:crypto';
import { enterpriseCan } from '../access-policy.js';

export class TaskRecycleError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
const fail = (status, code, message) => { throw new TaskRecycleError(status, code, message); };

export function instrumentTaskRecycle(api, db) {
  db.exec(`CREATE TABLE IF NOT EXISTS task_recycle_entries (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL CHECK(resource_type IN ('project', 'task')),
    resource_id TEXT NOT NULL,
    project_id TEXT,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL,
    project_title TEXT NOT NULL DEFAULT '',
    deleted_at TEXT NOT NULL,
    deleted_by_user_id TEXT NOT NULL,
    deleted_by_name TEXT NOT NULL,
    restored_at TEXT,
    restored_by_user_id TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_recycle_active_resource
    ON task_recycle_entries(organization_id, resource_type, resource_id) WHERE restored_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_recycle_active_project
    ON task_recycle_entries(organization_id, project_id) WHERE restored_at IS NULL;`);

  const rawProject = (organizationId, projectId) => db.prepare('SELECT * FROM projects WHERE organization_id = ? AND id = ?').get(organizationId, projectId);
  const rawTask = (organizationId, taskId) => db.prepare('SELECT * FROM tasks WHERE organization_id = ? AND id = ?').get(organizationId, taskId);
  const recycled = (organizationId, type, resourceId) => Boolean(resourceId && db.prepare(`SELECT 1 FROM task_recycle_entries
    WHERE organization_id = ? AND resource_type = ? AND resource_id = ? AND restored_at IS NULL`).get(organizationId, type, resourceId));
  const projectActive = (organizationId, projectId) => !projectId || !recycled(organizationId, 'project', projectId);
  const taskActive = (organizationId, taskId) => {
    const row = rawTask(organizationId, taskId);
    return !recycled(organizationId, 'task', taskId) && projectActive(organizationId, row?.project_id);
  };
  const rowActive = (organizationId, row) => !row || projectActive(organizationId, row.projectId || row.project_id)
    && (!(row.taskId || row.task_id) || taskActive(organizationId, row.taskId || row.task_id));
  const rawResource = (table, organizationId, resourceId) => db.prepare(`SELECT * FROM ${table} WHERE organization_id = ? AND id = ?`).get(organizationId, resourceId);
  const resourceActive = (table, organizationId, resourceId) => {
    const row = rawResource(table, organizationId, resourceId);
    if (table === 'chat_attachments' && row) {
      const conversationId = row.pending_conversation_id || (row.message_id && rawResource('messages', organizationId, row.message_id)?.conversation_id);
      if (conversationId && !rowActive(organizationId, rawResource('conversations', organizationId, conversationId))) return false;
    }
    return rowActive(organizationId, row);
  };
  const transaction = operation => {
    const savepoint = `recycle_${randomUUID().replaceAll('-', '')}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try { const result = operation(); db.exec(`RELEASE SAVEPOINT ${savepoint}`); return result; }
    catch (error) { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`); throw error; }
  };
  const actorFor = (organizationId, userId) => {
    const member = api.getMembership(userId, organizationId);
    if (!member) fail(403, 'recycle_access_denied', '无权访问此企业的回收站');
    return { organizationId, userId, role: member.role, permissions: api.getMemberPermissions(organizationId, userId) };
  };
  const scopeAllowed = (actor, type, resource) => {
    if (!resource || !enterpriseCan(actor, type === 'project' ? 'project.delete' : 'task.delete')) return false;
    const moduleKey = type === 'project' ? 'projects' : 'tasks';
    if (!api.listOrganizationModules(actor.organizationId)[moduleKey]) return false;
    if (['owner', 'admin'].includes(actor.role)) return true;
    return type === 'project'
      ? Boolean(db.prepare('SELECT 1 FROM project_members WHERE organization_id = ? AND project_id = ? AND user_id = ?')
        .get(actor.organizationId, resource.id, actor.userId))
      : resource.assignee_user_id === actor.userId;
  };
  const dto = (row, canRestore = true) => ({
    id: row.id, resourceType: row.resource_type, resourceId: row.resource_id,
    projectId: row.project_id || null, taskId: row.task_id, title: row.title, projectTitle: row.project_title,
    deletedAt: row.deleted_at, deletedByName: row.deleted_by_name, restoredAt: row.restored_at || null, canRestore
  });
  const taskIdsFor = (organizationId, type, resource) => type === 'project'
    ? db.prepare('SELECT id FROM tasks WHERE organization_id = ? AND project_id = ?').all(organizationId, resource.id).map(row => row.id)
    : [resource.id];

  api.listRecycleBin = (organizationId, userId) => {
    const actor = actorFor(organizationId, userId);
    return db.prepare('SELECT * FROM task_recycle_entries WHERE organization_id = ? AND restored_at IS NULL ORDER BY deleted_at DESC, id')
      .all(organizationId).filter(row => scopeAllowed(actor, row.resource_type,
        row.resource_type === 'project' ? rawProject(organizationId, row.resource_id) : rawTask(organizationId, row.resource_id))).map(row => dto(row));
  };
  api.recycleResource = (organizationId, userId, type, resourceId) => transaction(() => {
    if (!['project', 'task'].includes(type)) fail(400, 'invalid_recycle_type', '不支持回收此资源');
    const actor = actorFor(organizationId, userId);
    const resource = type === 'project' ? rawProject(organizationId, resourceId) : rawTask(organizationId, resourceId);
    if (!resource) fail(404, 'recycle_resource_not_found', '任务不存在或无权访问');
    if (type === 'task' && resource.project_id) fail(400, 'project_task_recycle_required', '项目任务需要从项目卡片整体移入回收站');
    if (!scopeAllowed(actor, type, resource)) fail(403, 'recycle_permission_denied', '未获得回收此任务的权限');
    if (recycled(organizationId, type, resourceId)) fail(409, 'already_recycled', '该任务已在回收站中');
    const timestamp = new Date().toISOString();
    const name = db.prepare('SELECT display_name FROM organization_user_profiles WHERE organization_id = ? AND id = ?').get(organizationId, userId)?.display_name || '';
    const entryId = `recycle_${randomUUID()}`;
    db.prepare(`INSERT INTO task_recycle_entries(id, organization_id, resource_type, resource_id, project_id, task_id,
      title, project_title, deleted_at, deleted_by_user_id, deleted_by_name) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(entryId, organizationId, type, resourceId, type === 'project' ? resource.id : null,
        type === 'project' ? resource.root_task_id : resource.id, resource.title, type === 'project' ? resource.title : '', timestamp, userId, name);
    api.recordRecycleLifecycle(organizationId, taskIdsFor(organizationId, type, resource), 'recycled', userId, timestamp);
    api.addAudit({ organizationId, userId, action: `${type}.recycle`, entityType: type, entityId: resourceId,
      metadata: { entryId, title: resource.title } });
    return dto(db.prepare('SELECT * FROM task_recycle_entries WHERE id = ?').get(entryId));
  });
  api.restoreRecycledResource = (organizationId, userId, entryId) => transaction(() => {
    const actor = actorFor(organizationId, userId);
    const row = db.prepare('SELECT * FROM task_recycle_entries WHERE organization_id = ? AND id = ?').get(organizationId, entryId);
    if (!row) fail(404, 'recycle_entry_not_found', '回收记录不存在或无权访问');
    const resource = row.resource_type === 'project' ? rawProject(organizationId, row.resource_id) : rawTask(organizationId, row.resource_id);
    if (!scopeAllowed(actor, row.resource_type, resource)) fail(403, 'recycle_permission_denied', '未获得恢复此任务的权限');
    if (row.restored_at) fail(409, 'already_restored', '该任务已经恢复');
    const timestamp = new Date().toISOString();
    db.prepare('UPDATE task_recycle_entries SET restored_at = ?, restored_by_user_id = ? WHERE id = ? AND restored_at IS NULL').run(timestamp, userId, entryId);
    api.recordRecycleLifecycle(organizationId, taskIdsFor(organizationId, row.resource_type, resource), 'restored', userId, timestamp);
    api.addAudit({ organizationId, userId, action: `${row.resource_type}.restore`, entityType: row.resource_type, entityId: row.resource_id,
      metadata: { entryId, title: row.title } });
    return dto({ ...row, restored_at: timestamp }, false);
  });

  // All public resource reads and writes share the same active-resource boundary,
  // including file callbacks that do not use the normal authenticated routes.
  const guard = (methods, allowed, fallback = null) => {
    for (const method of methods) {
      const original = api[method];
      if (typeof original !== 'function') throw new Error(`Unknown recycle guard method: ${method}`);
      api[method] = function (...args) { return allowed(args) ? original.apply(api, args) : (Array.isArray(fallback) ? [] : fallback); };
    }
  };
  const filter = (methods, active) => {
    for (const method of methods) {
      const original = api[method];
      api[method] = function (...args) { return original.apply(api, args).filter(row => active(args[0], row)); };
    }
  };
  filter(['listProjects', 'listProjectsForUser'], (organizationId, row) => projectActive(organizationId, row.id));
  filter(['listTasks'], (organizationId, row) => taskActive(organizationId, row.id));
  filter(['listAllParts', 'listOfficeDocuments', 'listTrashedOfficeDocuments', 'listStorageFiles', 'listConversations'], rowActive);
  guard(['getProject', 'getProjectRootTask', 'updateProject'], args => projectActive(args[0], args[1]));
  guard(['listProjectMembers', 'listProjectComments', 'listParts', 'listQuotes', 'listFairItems'], args => projectActive(args[0], args[1]), []);
  guard(['isProjectMember'], args => projectActive(args[0], args[1]), false);
  guard(['getQuote', 'updateFairItem'], args => projectActive(args[0], args[1]));
  guard(['addProjectMember', 'createProjectComment', 'createPart', 'createQuote', 'updateQuote', 'createFairItem', 'createConversation', 'createOfficeDocument', 'createStorageFile', 'createTask'],
    args => projectActive(args[0].organizationId, args[0].projectId));
  guard(['getTask', 'updateTask', 'claimTask', 'transferTask', 'deleteTask', 'getTaskSubtask', 'updateTaskSubtask', 'claimTaskSubtask', 'transferTaskSubtask', 'deleteTaskSubtask', 'getTaskAttachmentStorage', 'deleteTaskAttachment'],
    args => taskActive(args[0], args[1]));
  guard(['listTaskSubtasks', 'listTaskComments', 'listTaskAttachments', 'listTaskAttachmentStorage', 'listTaskHistory'], args => taskActive(args[0], args[1]), []);
  guard(['createTaskSubtask', 'createTaskComment', 'createTaskAttachment'], args => taskActive(args[0].organizationId, args[0].taskId));
  guard(['syncProjectFromRootTask'], args => taskActive(args[0], args[1]?.id));
  for (const [table, methods, idIndex] of [
    ['office_documents', ['getOfficeDocumentStorage'], 1],
    ['office_documents', ['renameOfficeDocument', 'trashOfficeDocument', 'restoreOfficeDocument', 'deleteOfficeDocument'], 2],
    ['storage_files', ['getStorageFileStorage', 'deleteStorageFile'], 1],
    ['storage_files', ['getStorageFile'], 2],
    ['parts', ['getPart', 'updatePart'], 1],
    ['conversations', ['getConversation', 'updateConversationUserState'], 1],
    ['chat_attachments', ['getChatAttachmentStorage'], 1],
    ['chat_attachments', ['getPendingChatAttachmentStorage', 'deletePendingChatAttachment'], 2]
  ]) guard(methods, args => resourceActive(table, args[0], args[idIndex]));
  guard(['listMessages'], args => resourceActive('conversations', args[0], args[1]), []);
  guard(['createMessage'], args => resourceActive('conversations', args[0].organizationId, args[0].conversationId));
  guard(['createChatAttachment'], args => !args[0].pendingConversationId || resourceActive('conversations', args[0].organizationId, args[0].pendingConversationId));
  guard(['touchOfficeDocument'], args => {
    const document = db.prepare('SELECT * FROM office_documents WHERE id = ?').get(args[0]);
    return rowActive(document?.organization_id, document);
  });
  api.isProjectActive = projectActive;
  api.isTaskActive = taskActive;
  return api;
}

export function registerTaskRecycleRoutes(router, { db, requireAuth, jsonError }) {
  const handle = operation => ctx => {
    try { operation(ctx); }
    catch (error) {
      if (!(error instanceof TaskRecycleError)) throw error;
      jsonError(ctx, error.status, error.code, error.message);
    }
  };
  router.get('/recycle-bin', requireAuth, handle(ctx => {
    const session = ctx.state.session;
    ctx.body = { items: db.listRecycleBin(session.organizationId, session.userId) };
  }));
  for (const [route, type, parameter] of [['/projects/:projectId/recycle', 'project', 'projectId'], ['/tasks/:taskId/recycle', 'task', 'taskId']]) {
    router.post(route, requireAuth, handle(ctx => {
      const session = ctx.state.session;
      ctx.status = 201;
      ctx.body = { item: db.recycleResource(session.organizationId, session.userId, type, ctx.params[parameter]) };
    }));
  }
  router.post('/recycle-bin/:entryId/restore', requireAuth, handle(ctx => {
    const session = ctx.state.session;
    ctx.body = { item: db.restoreRecycledResource(session.organizationId, session.userId, ctx.params.entryId) };
  }));
}

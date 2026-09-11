import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import serve from 'koa-static';
import { join } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { createReadStream, renameSync } from 'node:fs';
import { mkdir, copyFile, stat, readFile, writeFile, unlink } from 'node:fs/promises';
import { createDatabase, PROJECT_WORKFLOW_STAGES, LEGACY_TASK_STATUSES } from './db.js';
import { taskHistoryCsv } from './task-history.js';
import { registerOrganizationRoutes } from './organization-routes.js';
import { registerOrganizationAssignmentRoutes } from './organization-assignment.js';
import { enterpriseCan, platformCan } from '../access-policy.js';
import { PlatformAccessError } from './platform-access.js';
import { registerPlatformRoutes } from './platform-routes.js';
import { OrganizationAccessError } from './organization-access.js';
import { registerTaskRecycleRoutes } from './task-recycle.js';
import { registerProjectListRoutes } from './project-lists.js';
import { registerProjectLinkRoutes } from './project-links.js';
import { registerAutomationRoutes } from './automation-routes.js';

const jsonError = (ctx, status, code, message) => { ctx.status = status; ctx.body = { error: code, message }; };

function authRequired(db) {
  return async (ctx, next) => {
    const header = ctx.get('authorization');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const session = token ? db.getSession(token) : null;
    if (!session) return jsonError(ctx, 401, 'unauthorized', '登录已失效，请重新登录');
    ctx.state.session = session;
    await next();
  };
}

function validString(value, max = 160) {
  const result = String(value ?? '').trim();
  return result && result.length <= max ? result : '';
}

function optionalString(value, max = 160) {
  if (value === undefined) return undefined;
  const result = String(value ?? '').trim();
  return result.length <= max ? result : null;
}

function optionalBoolean(value) {
  if (value === undefined) return undefined;
  if (value === true || value === 1 || String(value).toLowerCase() === 'true' || String(value) === '1') return true;
  if (value === false || value === 0 || String(value).toLowerCase() === 'false' || String(value) === '0' || value === '') return false;
  return null;
}

const INVALID_RICH_TEXT = Symbol('invalid-rich-text');
function richTextValue(value, max = 200000) {
  if (value === undefined) return undefined;
  if (value === null) return '';
  let result;
  if (typeof value === 'string') result = value;
  else if (typeof value === 'object') {
    try { result = JSON.stringify(value); } catch { return INVALID_RICH_TEXT; }
  } else result = String(value);
  return result.length <= max ? result : INVALID_RICH_TEXT;
}

const taskStatusAllowed = value => PROJECT_WORKFLOW_STAGES.includes(value) || LEGACY_TASK_STATUSES.includes(value);
const subtaskStatusAllowed = value => taskStatusAllowed(value);

const memberCan = enterpriseCan;
const CUSTOMER_FIELDS = new Set(['customerProfile', 'customerManagement', 'customer_profile', 'customer_management']);
const PROJECT_LIST_FIELDS = new Set(['projectList', 'project_list']);

function withoutProjectListFields(value) {
  if (Array.isArray(value)) return value
    .filter(item => !/^project[._]list\./.test(String(item?.action || '')) && item?.entityType !== 'project_list')
    .map(withoutProjectListFields);
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !PROJECT_LIST_FIELDS.has(key))
    .map(([key, item]) => [key, withoutProjectListFields(item)]));
}

// Apply the same field boundary to task snapshots and historical audit changes.
function withoutCustomerFields(value) {
  if (Array.isArray(value)) return value.map(withoutCustomerFields);
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !CUSTOMER_FIELDS.has(key))
    .map(([key, item]) => [key, withoutCustomerFields(item)]));
}

const chatAttachmentTypes = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  step: 'model/step', stp: 'model/step', iges: 'model/iges', igs: 'model/iges',
  stl: 'model/stl', obj: 'model/obj', glb: 'model/gltf-binary', gltf: 'model/gltf+json',
  '3mf': 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
  dxf: 'image/vnd.dxf', dwg: 'image/vnd.dwg', txt: 'text/plain', md: 'text/markdown',
  json: 'application/json', xml: 'application/xml', csv: 'text/csv', log: 'text/plain',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav'
};

// The general file space accepts the same manufacturing/chat formats and a
// few common preview formats. Keep this allow-list explicit so arbitrary
// executable files cannot be uploaded to the tenant storage root.
const storageFileTypes = {
  ...chatAttachmentTypes,
  bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', heic: 'image/heic',
  tiff: 'image/tiff', tif: 'image/tiff', webm: 'video/webm'
};

function chatFileName(header) {
  try { return decodeURIComponent(header || '').replace(/[\\/\x00-\x1f]/g, '_').trim().slice(0, 180); }
  catch { return ''; }
}

function uploadedFileName(header) {
  try { return decodeURIComponent(header || '').replace(/[\\/\x00-\x1f]/g, '_').trim().slice(0, 180); }
  catch { return ''; }
}

export async function createApp({ dbPath = join(process.cwd(), 'data', 'machquote.sqlite'), staticDir = '' } = {}) {
  const db = await createDatabase({ dbPath });
  const app = new Koa();
  const router = new Router({ prefix: '/api' });
  const requireAuth = authRequired(db);
  const platformSnapshot = userId => {
    const access = db.getPlatformAccess(userId);
    return { platformAdmin: Boolean(access.role), platformRole: access.role, platformPermissions: access.permissions };
  };
  const sessionSnapshot = session => ({
    user: session.user, organization: session.organization, role: session.role,
    permissions: session.permissions, grantablePermissions: session.grantablePermissions || {},
    ...platformSnapshot(session.userId), modules: db.listOrganizationModules(session.organizationId), expiresAt: session.expiresAt
  });
  const requirePlatform = (ctx, permission) => {
    if (platformCan(db.getPlatformAccess(ctx.state.session.userId), permission)) return true;
    jsonError(ctx, 403, 'platform_permission_denied', '当前账号未获授权执行此平台操作');
    return false;
  };
  registerPlatformRoutes(router, { db, requireAuth, jsonError });
  const officeRoot = process.env.ONLYOFFICE_STORAGE_DIR || join(process.cwd(),'data','office-documents');
  const chatAttachmentRoot = process.env.CHAT_ATTACHMENT_STORAGE_DIR || join(process.cwd(), 'data', 'chat-attachments');
  const taskAttachmentRoot = process.env.TASK_ATTACHMENT_STORAGE_DIR || join(process.cwd(), 'data', 'task-attachments');
  const storageFileRoot = process.env.STORAGE_FILE_STORAGE_DIR || process.env.STORAGE_FILES_DIR || join(process.cwd(), 'data', 'storage-files');
  const storageFileMaxBytes = Math.max(1, Number(process.env.STORAGE_FILE_MAX_BYTES) || 50 * 1024 * 1024);
  const officeServer = process.env.ONLYOFFICE_SERVER_URL || 'http://43.139.7.28:8080';
  const resolvePublicBase = ctx => (process.env.PUBLIC_BASE_URL || `${ctx.origin}/api`).replace(/\/$/, '');
  const jwtSecret = process.env.ONLYOFFICE_JWT_SECRET || 'mfggo-onlyoffice-2026';
  const jwt = payload => { const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url'); const head=enc({alg:'HS256',typ:'JWT'}),body=enc(payload); return `${head}.${body}.${createHmac('sha256',jwtSecret).update(`${head}.${body}`).digest('base64url')}`; };
  const fileSignature = (organizationId,documentId) => createHmac('sha256',jwtSecret).update(`${organizationId}:${documentId}`).digest('hex');
  const hasProjectAccess = (session, projectId) => ['owner', 'admin'].includes(session.role)
    || db.isProjectMember(session.organizationId, projectId, session.userId);
  const authorize = (ctx, permission, { moduleKey = '', projectId = '' } = {}) => {
    const session = ctx.state.session;
    if (!enterpriseCan(session, permission)) {
      jsonError(ctx, 403, 'permission_denied', '当前账号未获授权执行此操作');
      return null;
    }
    if (moduleKey === 'files') {
      jsonError(ctx, 404, 'not_found', '接口已移除');
      return null;
    }
    if (moduleKey && !db.listOrganizationModules(session.organizationId)[moduleKey]) {
      jsonError(ctx, 403, 'module_disabled', '当前企业未启用此功能模块');
      return null;
    }
    if (!projectId) return true;
    const project = db.getProject(session.organizationId, projectId);
    if (!project) {
      jsonError(ctx, 404, 'project_not_found', '项目不存在');
      return null;
    }
    if (!hasProjectAccess(session, project.id)) {
      jsonError(ctx, 403, 'project_access_denied', '当前成员未加入此项目');
      return null;
    }
    return project;
  };
  const authorizeConversation = (ctx, conversation, write = false) => {
    const isProjectConversation = Boolean(conversation.projectId);
    return authorize(ctx, `${isProjectConversation ? 'communication' : 'chat'}.${write ? 'write' : 'read'}`, {
      moduleKey: isProjectConversation ? 'communication' : 'chat',
      projectId: conversation.projectId || ''
    });
  };
  const authorizeDocument = (ctx, permission, document) => authorize(ctx, permission, {
    moduleKey: 'workspace',
    projectId: document?.project_id || document?.projectId || ''
  });
  // Enterprise ownership governs the organization itself. It must not turn
  // into silent authority over a project's participants: that comes from the
  // current responsible person or an explicit organization grant.
  const hasProjectMemberManagementGrant = session => session?.role !== 'owner'
    && memberCan(session, 'project.members.manage');
  // Member administration comes from an organization grant or the current
  // executor of the project's root task. Project role labels confer nothing.
  const authorizeProjectMemberManage = (ctx, projectId) => {
    const project = authorize(ctx, 'project.read', { moduleKey: 'projects', projectId });
    if (!project) return null;
    const session = ctx.state.session;
    const rootTask = project.rootTaskId ? db.getTask(session.organizationId, project.rootTaskId) : null;
    const canManage = hasProjectMemberManagementGrant(session) || rootTask?.assigneeUserId === session.userId;
    if (!canManage) {
      jsonError(ctx, 403, 'project_member_manage_denied', '只有当前负责人或获得“管理项目参与者”授权的成员可以操作');
      return null;
    }
    return project;
  };
  const requireStandaloneTaskAssignee = (ctx, task) => {
    const session = ctx.state.session;
    if (!task.projectId && !['owner', 'admin'].includes(session.role) && task.assigneeUserId !== session.userId) {
      jsonError(ctx, 403, 'task_access_denied', '当前成员未被分配此任务');
      return false;
    }
    return true;
  };
  // A project card is represented by its root task.  Project membership is the
  // read boundary; task-level mutation checks below decide whether the caller
  // is the current executor.  In particular, do not use the enterprise
  // `task.write` role permission as a substitute for task assignment: a viewer
  // who is explicitly assigned to a project task must still be able to work it.
  const authorizeTask = (ctx, task, write = false) => {
    const session = ctx.state.session;
    const project = task?.projectId ? db.getProject(session.organizationId, task.projectId) : null;
    if (project?.rootTaskId === task.id || task?.projectId) {
      return authorize(ctx, 'project.read', { moduleKey: 'projects', projectId: project?.id || task.projectId });
    }
    return authorize(ctx, write ? 'task.write' : 'task.read', { moduleKey: 'tasks', projectId: '' });
  };
  const authorizeSubtaskTask = (ctx, task, write = false) => {
    // Project subtasks are collaboration resources.  Their mutation rights
    // are checked against the subtask assignee, not against the caller's
    // enterprise role.  Standalone tasks retain the existing task module gate.
    if (!authorizeTask(ctx, task, task?.projectId ? false : write)) return false;
    if (!requireStandaloneTaskAssignee(ctx, task)) return false;
    return true;
  };
  const isElevated = session => ['owner', 'admin'].includes(session?.role);
  const isProjectTaskMember = (session, task) => Boolean(task?.projectId)
    && (isElevated(session) || db.isProjectMember(session.organizationId, task.projectId, session.userId));
  const isTaskExecutor = (session, task) => {
    if (!session || !task) return false;
    // Project work is delegated to the task's current executor.  Enterprise
    // owner/admin is still allowed to read the project and manage its member
    // list, but that global role must not silently change the work in flight.
    // This keeps status, attachments and handoffs on one predictable rule.
    if (task.projectId) return isProjectTaskMember(session, task) && task.assigneeUserId === session.userId;
    return task.assigneeUserId === session.userId && enterpriseCan(session, 'task.write');
  };
  const canClaimProjectTask = (session, task) => Boolean(task?.projectId)
    && isProjectTaskMember(session, task)
    && !task.assigneeUserId;
  const canTransferTask = (session, task) => isTaskExecutor(session, task);
  const canCommentTask = (session, task) => task?.projectId
    ? isProjectTaskMember(session, task)
    : (isElevated(session) || (task?.assigneeUserId === session?.userId && enterpriseCan(session, 'task.write')));
  const isSubtaskExecutor = (session, task, subtask) => {
    if (!session || !task || !subtask) return false;
    if (task.projectId) return isProjectTaskMember(session, task) && subtask.assigneeUserId === session.userId;
    return subtask.assigneeUserId === session.userId && enterpriseCan(session, 'task.write');
  };
  const requireTaskExecutor = (ctx, task, action = 'change') => {
    if (isTaskExecutor(ctx.state.session, task)) return true;
    jsonError(ctx, 403, 'task_executor_required', action === 'attachment'
      ? '只有当前负责人可以修改任务附件'
      : '只有当前负责人可以修改任务状态和任务内容');
    return false;
  };
  const requireTaskCommentAccess = (ctx, task) => {
    if (canCommentTask(ctx.state.session, task)) return true;
    jsonError(ctx, 403, 'task_comment_denied', '当前成员无权评论此任务');
    return false;
  };
  const taskCapabilities = (session, task) => {
    const member = isProjectTaskMember(session, task);
    const executor = isTaskExecutor(session, task);
    const standalone = !task?.projectId;
    return {
      canRead: Boolean(member || (standalone && (isElevated(session) || task.assigneeUserId === session.userId))),
      canComment: canCommentTask(session, task),
      canClaim: canClaimProjectTask(session, task),
      canChangeStatus: executor,
      canEdit: executor,
      canDelete: memberCan(session, 'task.delete') && !task?.projectId,
      canRecycle: task?.projectId ? member && memberCan(session, 'project.delete')
        : memberCan(session, 'task.delete') && (isElevated(session) || task.assigneeUserId === session.userId),
      canViewCustomers: memberCan(session, 'customer.read'),
      canViewProjectLists: member && memberCan(session, 'project.list.read'),
      canEditProjectLists: member && memberCan(session, 'project.list.read') && memberCan(session, 'project.list.write'),
      canManageProjectMembers: member && (executor || hasProjectMemberManagementGrant(session)),
      canManageOrganization: ['owner', 'admin'].includes(session.role),
      canManageAttachments: executor,
      canTransferAssignee: canTransferTask(session, task),
      canManageSubtasks: executor,
      isExecutor: executor,
      isProjectMember: member
    };
  };
  const subtaskCapabilities = (session, task, subtask) => {
    const member = isProjectTaskMember(session, task);
    const executor = isSubtaskExecutor(session, task, subtask);
    return {
      canRead: Boolean(member || (!task.projectId && (isElevated(session) || task.assigneeUserId === session.userId))),
      canComment: task.projectId ? member : (isElevated(session) || task.assigneeUserId === session.userId),
      canClaim: Boolean(member && !subtask?.assigneeUserId),
      canChangeStatus: executor,
      canEdit: executor,
      canManageAttachments: executor,
      canTransferAssignee: executor,
      canDelete: memberCan(session, 'task.delete'),
      canViewCustomers: false,
      canManageOrganization: ['owner', 'admin'].includes(session.role),
      isExecutor: executor,
      isProjectMember: member
    };
  };
  const resolveSubtaskScope = (ctx, write = false) => {
    const session = ctx.state.session;
    const task = db.getTask(session.organizationId, ctx.params.taskId);
    if (!task) {
      jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
      return null;
    }
    if (!authorizeSubtaskTask(ctx, task, write)) return null;
    const subtask = db.getTaskSubtask(session.organizationId, task.id, ctx.params.subtaskId);
    if (!subtask) {
      jsonError(ctx, 404, 'subtask_not_found', '子任务不存在或无权访问');
      return null;
    }
    return { session, task, subtask };
  };
  const uploadTaskAttachmentForScope = async (ctx, task, subtaskId = '') => {
    const session = ctx.state.session;
    const name = chatFileName(ctx.get('x-file-name'));
    const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    const mimeType = chatAttachmentTypes[extension];
    if (!name || !mimeType) return jsonError(ctx, 400, 'unsupported_task_attachment', '不支持此附件格式');
    const chunks = []; let size = 0;
    for await (const chunk of ctx.req) {
      size += chunk.length;
      if (size > 50 * 1024 * 1024) return jsonError(ctx, 413, 'task_attachment_too_large', '单个任务附件不能超过 50MB');
      chunks.push(chunk);
    }
    if (!size) return jsonError(ctx, 400, 'empty_task_attachment', '附件内容为空');
    await mkdir(join(taskAttachmentRoot, session.organizationId), { recursive: true });
    const storageKey = join(session.organizationId, `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
    const storagePath = join(taskAttachmentRoot, storageKey);
    let attachment;
    try {
      await writeFile(storagePath, Buffer.concat(chunks));
      attachment = db.createTaskAttachment({ organizationId: session.organizationId, taskId: task.id, subtaskId: subtaskId || null, userId: session.userId, name, mimeType, sizeBytes: size, storageKey });
    } catch (error) {
      await unlink(storagePath).catch(() => {});
      throw error;
    }
    if (!attachment) {
      await unlink(storagePath).catch(() => {});
      return jsonError(ctx, 400, 'task_attachment_unavailable', '附件关联的任务不可用');
    }
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'task.attachment.upload', entityType: 'task_attachment', entityId: attachment.id, metadata: { taskId: task.id, subtaskId: subtaskId || '', projectId: task.projectId, name: attachment.name, sizeBytes: attachment.sizeBytes } });
    ctx.status = 201;
    ctx.body = { attachment };
  };
  const deleteTaskAttachmentForScope = async (ctx, task, attachmentId, subtaskId = '') => {
    const session = ctx.state.session;
    const source = db.getTaskAttachmentStorage(session.organizationId, task.id, attachmentId, subtaskId || null);
    if (!source) return jsonError(ctx, 404, 'task_attachment_not_found', '任务附件不存在或无权删除');
    const row = db.deleteTaskAttachment(session.organizationId, task.id, attachmentId, subtaskId || null);
    if (!row) return jsonError(ctx, 404, 'task_attachment_not_found', '任务附件不存在或无权删除');
    await unlink(join(taskAttachmentRoot, row.storage_key)).catch(() => {});
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'task.attachment.delete', entityType: 'task_attachment', entityId: row.id, metadata: { taskId: task.id, subtaskId: subtaskId || '', projectId: task.projectId, name: row.name, sizeBytes: row.size_bytes } });
    ctx.body = { ok: true };
  };
  const downloadTaskAttachmentForScope = async (ctx, task, attachmentId, subtaskId = '') => {
    const session = ctx.state.session;
    const row = db.getTaskAttachmentStorage(session.organizationId, task.id, attachmentId, subtaskId || null);
    if (!row) return jsonError(ctx, 404, 'task_attachment_not_found', '任务附件不存在或无权下载');
    const storagePath = join(taskAttachmentRoot, row.storage_key);
    let info;
    try {
      info = await stat(storagePath);
    } catch (error) {
      if (error?.code === 'ENOENT') return jsonError(ctx, 404, 'task_attachment_file_missing', '附件文件已不存在或已清理');
      throw error;
    }
    ctx.type = row.mime_type || 'application/octet-stream';
    ctx.length = info.size;
    ctx.attachment(row.name);
    ctx.body = createReadStream(storagePath);
  };
  const previewTaskAttachmentForScope = async (ctx, task, attachmentId, subtaskId = '') => {
    const session = ctx.state.session;
    const row = db.getTaskAttachmentStorage(session.organizationId, task.id, attachmentId, subtaskId || null);
    if (!row) return jsonError(ctx, 404, 'task_attachment_not_found', '任务附件不存在或无权预览');
    const mimeType = String(row.mime_type || 'application/octet-stream').toLowerCase();
    const previewable = mimeType.startsWith('image/')
      || mimeType.startsWith('video/')
      || mimeType.startsWith('audio/')
      || mimeType === 'application/pdf'
      || mimeType.startsWith('text/')
      || mimeType === 'application/json'
      || mimeType === 'application/xml';
    if (!previewable) return jsonError(ctx, 415, 'task_attachment_preview_unsupported', '此附件类型不支持在线预览');
    const storagePath = join(taskAttachmentRoot, row.storage_key);
    let info;
    try {
      info = await stat(storagePath);
    } catch (error) {
      if (error?.code === 'ENOENT') return jsonError(ctx, 404, 'task_attachment_file_missing', '附件文件已不存在或已清理');
      throw error;
    }
    if ((mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') && info.size > 1024 * 1024) {
      return jsonError(ctx, 413, 'task_attachment_text_preview_too_large', '超过 1MB 的文本附件请下载后查看');
    }
    ctx.type = row.mime_type || 'application/octet-stream';
    ctx.length = info.size;
    ctx.set('Cache-Control', 'private, max-age=60');
    ctx.body = createReadStream(storagePath);
  };

  app.context.db = db;
  app.close = () => db.close();
  app.on('error', error => console.error('[server]', error));
  app.use(async (ctx, next) => {
    try { await next(); } catch (error) { ctx.status = error.status || 500; ctx.body = { error: 'server_error', message: error.expose ? error.message : '服务暂时不可用' }; app.emit('error', error, ctx); }
  });
  const standardJson = bodyParser({ enableTypes: ['json'], jsonLimit: '2mb' });
  const workbookJson = bodyParser({ enableTypes: ['json'], jsonLimit: '20mb' });
  app.use((ctx, next) => {
    const listWrite = ctx.method === 'POST' && /^\/api\/projects\/[^/]+\/lists(?:\/templates)?\/?$/.test(ctx.path)
      || ctx.method === 'PUT' && /^\/api\/projects\/[^/]+\/lists\/(?!selection\/?$|images(?:\/|$))[^/]+\/?$/.test(ctx.path)
      || ctx.method === 'PUT' && /^\/api\/projects\/[^/]+\/lists\/templates\/[^/]+\/?$/.test(ctx.path);
    return (listWrite ? workbookJson : standardJson)(ctx, next);
  });
  app.use(async (ctx, next) => {
    await next();
    if (ctx.state.session && !memberCan(ctx.state.session, 'customer.read')) {
      ctx.body = withoutCustomerFields(ctx.body);
    }
    if (ctx.state.session && !memberCan(ctx.state.session, 'project.list.read')) {
      ctx.body = withoutProjectListFields(ctx.body);
    }
  });
  registerOrganizationRoutes(router, { db, requireAuth, jsonError });
  registerOrganizationAssignmentRoutes(router, { db, requireAuth, jsonError });
  registerTaskRecycleRoutes(router, { db, requireAuth, jsonError });
  registerProjectListRoutes(router, { db, requireAuth, jsonError, authorize });
  registerProjectLinkRoutes(router, { db, requireAuth, jsonError });
  registerAutomationRoutes(router, { db, requireAuth, jsonError });

  router.get('/health', ctx => { ctx.body = { ok: true, service: 'mfggo-saas', time: new Date().toISOString() }; });

  router.get('/documents', requireAuth, ctx => {
    const session = ctx.state.session;
    const projectId = validString(ctx.query.projectId, 100) || undefined;
    // The historical online document center is backed by ONLYOFFICE and is
    // governed by the workspace module. The newer general file space uses
    // the separate /storage/files routes below.
    if (!authorize(ctx, 'document.read', { moduleKey: 'workspace', projectId: projectId || '' })) return;
    const documents = db.listOfficeDocuments(session.organizationId, session.userId, projectId)
      .filter(document => !document.projectId || hasProjectAccess(session, document.projectId));
    ctx.body = { documents };
  });
  router.get('/documents/trash', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!authorize(ctx, 'document.read', { moduleKey: 'workspace' })) return;
    ctx.body = { documents: db.listTrashedOfficeDocuments(session.organizationId, session.userId)
      .filter(document => !document.projectId || hasProjectAccess(session, document.projectId)) };
  });
  router.post('/documents', requireAuth, async ctx => {
    const session = ctx.state.session;
    const requested = validString(ctx.request.body?.fileType, 10).toLowerCase();
    const fileType = ['docx', 'xlsx', 'pptx'].includes(requested) ? requested : 'xlsx';
    const title = validString(ctx.request.body?.title, 180) || `未命名.${fileType}`;
    const projectId = validString(ctx.request.body?.projectId, 100) || null;
    if (!authorize(ctx, 'document.write', { moduleKey: 'workspace', projectId: projectId || '' })) return;
    await mkdir(join(officeRoot, session.organizationId), { recursive: true });
    const storageKey = join(session.organizationId, `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileType}`);
    let document;
    try {
      await copyFile(join(process.cwd(), 'templates', `blank.${fileType}`), join(officeRoot, storageKey));
      const info = await stat(join(officeRoot, storageKey));
      document = db.createOfficeDocument({ organizationId: session.organizationId, projectId, userId: session.userId, title, storageKey, sizeBytes: info.size, fileType });
    } catch (error) {
      await unlink(join(officeRoot, storageKey)).catch(() => {});
      throw error;
    }
    if (!document) {
      await unlink(join(officeRoot, storageKey)).catch(() => {});
      return jsonError(ctx, 404, 'project_not_found', '项目已回收或不可用，文档未创建');
    }
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'document.create', entityType: 'document', entityId: document.id, metadata: { projectId, title } });
    ctx.status = 201;
    ctx.body = { document };
  });
  router.post('/documents/upload', requireAuth, async ctx => {
    const session = ctx.state.session;
    const title = uploadedFileName(ctx.get('x-file-name'));
    const fileType = title.split('.').pop()?.toLowerCase();
    const projectId = validString(ctx.get('x-project-id'), 100) || null;
    if (!title) return jsonError(ctx, 400, 'invalid_document_name', '文件名无效');
    if (!authorize(ctx, 'document.write', { moduleKey: 'workspace', projectId: projectId || '' })) return;
    if (!['docx', 'xlsx', 'pptx', 'pdf'].includes(fileType)) return jsonError(ctx, 400, 'unsupported_document', '仅支持 DOCX、XLSX、PPTX 和 PDF');
    const chunks = []; let size = 0;
    for await (const chunk of ctx.req) {
      size += chunk.length;
      if (size > 50 * 1024 * 1024) return jsonError(ctx, 413, 'document_too_large', '文件不能超过 50MB');
      chunks.push(chunk);
    }
    if (!size) return jsonError(ctx, 400, 'empty_document', '文件内容为空');
    await mkdir(join(officeRoot, session.organizationId), { recursive: true });
    const storageKey = join(session.organizationId, `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileType}`);
    let document;
    try {
      await writeFile(join(officeRoot, storageKey), Buffer.concat(chunks));
      document = db.createOfficeDocument({ organizationId: session.organizationId, projectId, userId: session.userId, title, storageKey, sizeBytes: size, fileType });
    } catch (error) {
      await unlink(join(officeRoot, storageKey)).catch(() => {});
      throw error;
    }
    if (!document) {
      await unlink(join(officeRoot, storageKey)).catch(() => {});
      return jsonError(ctx, 404, 'project_not_found', '项目已回收或不可用，文档未上传');
    }
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'document.upload', entityType: 'document', entityId: document.id, metadata: { projectId, title } });
    ctx.status = 201;
    ctx.body = { document };
  });
  router.put('/documents/:documentId', requireAuth, ctx => {
    const session = ctx.state.session;
    const source = db.getOfficeDocumentStorage(session.organizationId, ctx.params.documentId);
    if (!source || source.owner_user_id !== session.userId) return jsonError(ctx, 404, 'document_not_found', '文档不存在或无权修改');
    if (!authorizeDocument(ctx, 'document.write', source)) return;
    const title = validString(ctx.request.body?.title, 180);
    const document = title && db.renameOfficeDocument(session.organizationId, session.userId, ctx.params.documentId, title);
    if (!document) return jsonError(ctx, 404, 'document_not_found', '文档不存在或无权修改');
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'document.update', entityType: 'document', entityId: document.id, metadata: { projectId: document.projectId, changed: { title: { from: source.title, to: document.title } } } });
    ctx.body = { document };
  });
  router.delete('/documents/:documentId', requireAuth, ctx => {
    const session = ctx.state.session;
    const source = db.getOfficeDocumentStorage(session.organizationId, ctx.params.documentId);
    if (!source || source.owner_user_id !== session.userId) return jsonError(ctx, 404, 'document_not_found', '文档不存在或无权删除');
    if (!authorizeDocument(ctx, 'document.write', source)) return;
    if (!db.trashOfficeDocument(session.organizationId, session.userId, ctx.params.documentId)) return jsonError(ctx, 404, 'document_not_found', '文档不存在或无权删除');
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'document.trash', entityType: 'document', entityId: source.id, metadata: { projectId: source.project_id || null, title: source.title } });
    ctx.body = { ok: true };
  });
  router.post('/documents/:documentId/restore', requireAuth, ctx => {
    const session = ctx.state.session;
    const source = db.getOfficeDocumentStorage(session.organizationId, ctx.params.documentId);
    if (!source || source.owner_user_id !== session.userId) return jsonError(ctx, 404, 'document_not_found', '回收站中不存在该文档');
    if (!authorizeDocument(ctx, 'document.write', source)) return;
    if (!db.restoreOfficeDocument(session.organizationId, session.userId, ctx.params.documentId)) return jsonError(ctx, 404, 'document_not_found', '回收站中不存在该文档');
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'document.restore', entityType: 'document', entityId: source.id, metadata: { projectId: source.project_id || null, title: source.title } });
    ctx.body = { ok: true };
  });
  router.delete('/documents/:documentId/permanent', requireAuth, async ctx => {
    const session = ctx.state.session;
    const source = db.getOfficeDocumentStorage(session.organizationId, ctx.params.documentId);
    if (!source || source.owner_user_id !== session.userId) return jsonError(ctx, 404, 'document_not_found', '回收站中不存在该文档');
    if (!authorizeDocument(ctx, 'document.write', source)) return;
    const row = db.deleteOfficeDocument(session.organizationId, session.userId, ctx.params.documentId);
    if (!row) return jsonError(ctx, 404, 'document_not_found', '回收站中不存在该文档');
    await unlink(join(officeRoot, row.storage_key)).catch(() => {});
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'document.delete', entityType: 'document', entityId: row.id, metadata: { projectId: row.project_id || null, title: row.title } });
    ctx.body = { ok: true };
  });
  router.get('/documents/:documentId/download', requireAuth, async ctx => {
    const session = ctx.state.session;
    const document = db.getOfficeDocument(session.organizationId, session.userId, ctx.params.documentId);
    const row = db.getOfficeDocumentStorage(session.organizationId, ctx.params.documentId);
    if (!document || !row) return jsonError(ctx, 404, 'document_not_found', '文档不存在或无权下载');
    if (!authorizeDocument(ctx, 'document.read', document)) return;
    ctx.attachment(document.title);
    ctx.body = await readFile(join(officeRoot, row.storage_key));
  });
  router.get('/documents/:documentId/config', requireAuth, ctx => {
    const session = ctx.state.session;
    const document = db.getOfficeDocument(session.organizationId, session.userId, ctx.params.documentId);
    if (!document) return jsonError(ctx, 404, 'document_not_found', '文档不存在或无权访问');
    if (!authorizeDocument(ctx, 'document.read', document)) return;
    ctx.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const type = document.fileType === 'docx' ? 'word' : document.fileType === 'pptx' ? 'slide' : document.fileType === 'pdf' ? 'pdf' : 'cell';
    const signature = fileSignature(session.organizationId, document.id);
    const downloadName = `document.${document.fileType}`;
    const publicBase = resolvePublicBase(ctx);
    const config = { documentServer: officeServer, documentType: type, type: 'desktop', document: { fileType: document.fileType, key: `${document.id}-v${document.version}`, title: document.title, url: `${publicBase}/office-files/${document.id}/${downloadName}?v=${document.version}&organizationId=${encodeURIComponent(session.organizationId)}&signature=${signature}`, permissions: { edit: document.permission === 'edit' && document.fileType !== 'pdf', download: true, print: true } }, editorConfig: { mode: document.permission === 'edit' && document.fileType !== 'pdf' ? 'edit' : 'view', lang: 'zh-CN', callbackUrl: `${publicBase}/onlyoffice/callback/${document.id}?organizationId=${encodeURIComponent(session.organizationId)}&signature=${signature}`, user: { id: session.user.id, name: session.user.displayName } } };
    const tokenPayload = { ...config };
    delete tokenPayload.documentServer;
    config.token = jwt(tokenPayload);
    ctx.body = config;
  });
  router.get('/office-files/:documentId/:fileName', async ctx => { const organizationId=String(ctx.query.organizationId||'');if(ctx.query.signature!==fileSignature(organizationId,ctx.params.documentId))return jsonError(ctx,403,'forbidden','文件签名无效');const row=db.getOfficeDocumentStorage(organizationId,ctx.params.documentId);if(!row)return jsonError(ctx,404,'document_not_found','文档不存在');ctx.type=row.file_type==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':row.file_type==='pptx'?'application/vnd.openxmlformats-officedocument.presentationml.presentation':row.file_type==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';ctx.remove('Content-Disposition');ctx.body=await readFile(join(officeRoot,row.storage_key)); });
  // Keep existing editor sessions alive while clients roll over from the old /api-prefixed URLs.
  router.get('/api/office-files/:documentId', async ctx => { const organizationId=String(ctx.query.organizationId||'');if(ctx.query.signature!==fileSignature(organizationId,ctx.params.documentId))return jsonError(ctx,403,'forbidden','文件签名无效');const row=db.getOfficeDocumentStorage(organizationId,ctx.params.documentId);if(!row)return jsonError(ctx,404,'document_not_found','文档不存在');ctx.type=row.file_type==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':row.file_type==='pptx'?'application/vnd.openxmlformats-officedocument.presentationml.presentation':row.file_type==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';ctx.body=await readFile(join(officeRoot,row.storage_key)); });
  const saveOfficeCallback = async ctx => {
    const organizationId = String(ctx.query.organizationId || '');
    if (ctx.query.signature !== fileSignature(organizationId, ctx.params.documentId)) return jsonError(ctx, 403, 'forbidden', '回调签名无效');
    const row = db.getOfficeDocumentStorage(organizationId, ctx.params.documentId);
    if (!row) return jsonError(ctx, 404, 'document_not_found', '文档不存在');
    if ([2, 6].includes(Number(ctx.request.body?.status)) && ctx.request.body?.url) {
      const response = await fetch(ctx.request.body.url);
      if (!response.ok) throw new Error('ONLYOFFICE save download failed');
      const data = Buffer.from(await response.arrayBuffer());
      const targetPath = join(officeRoot, row.storage_key);
      const stagedPath = `${targetPath}.${randomUUID()}.tmp`;
      try {
        await writeFile(stagedPath, data);
        // A project may be recycled while the editor's save payload is in flight.
        if (!db.getOfficeDocumentStorage(organizationId, row.id)) return jsonError(ctx, 404, 'document_not_found', '文档不存在');
        renameSync(stagedPath, targetPath);
        db.touchOfficeDocument(row.id, data.length);
      } finally { await unlink(stagedPath).catch(() => {}); }
    }
    ctx.body = { error: 0 };
  };
  router.post('/onlyoffice/callback/:documentId', saveOfficeCallback);
  router.post('/api/onlyoffice/callback/:documentId', saveOfficeCallback);

  // General file space. This is deliberately separate from the historical
  // office-document and task/chat attachment tables: those resources have
  // different ownership and lifecycle rules. A storage file belongs either
  // to the current user (personal) or to the tenant (enterprise).
  router.get('/storage/files', requireAuth, ctx => {
    const session = ctx.state.session;
    const requestedScope = validString(ctx.query.scope, 20).toLowerCase();
    if (requestedScope && !['personal', 'enterprise', 'all'].includes(requestedScope)) {
      return jsonError(ctx, 400, 'invalid_storage_scope', '空间范围只能是 personal、enterprise 或 all');
    }
    const scope = requestedScope || 'all';
    const projectId = validString(ctx.query.projectId, 100) || undefined;
    if (scope === 'personal' && projectId) return jsonError(ctx, 400, 'personal_project_invalid', '个人空间文件不能关联项目');
    if (!authorize(ctx, 'document.read', { moduleKey: 'files', projectId: projectId || '' })) return;
    const files = db.listStorageFiles(session.organizationId, session.userId, { scope, projectId })
      .filter(file => !file.projectId || hasProjectAccess(session, file.projectId));
    ctx.body = { files, scope };
  });

  router.post('/storage/files', requireAuth, async ctx => {
    const session = ctx.state.session;
    const name = uploadedFileName(ctx.get('x-file-name') || ctx.query.name);
    const requestedScope = validString(ctx.get('x-file-scope') || ctx.query.scope, 20).toLowerCase();
    const scope = requestedScope || 'personal';
    const projectId = validString(ctx.get('x-project-id') || ctx.query.projectId, 100) || null;
    if (!name) return jsonError(ctx, 400, 'invalid_storage_file_name', '文件名无效');
    if (!['personal', 'enterprise'].includes(scope)) return jsonError(ctx, 400, 'invalid_storage_scope', '空间范围只能是 personal 或 enterprise');
    if (scope === 'personal' && projectId) return jsonError(ctx, 400, 'personal_project_invalid', '个人空间文件不能关联项目');
    if (!authorize(ctx, 'document.write', { moduleKey: 'files', projectId: projectId || '' })) return;

    const lastDot = name.lastIndexOf('.');
    const extension = lastDot > 0 && lastDot < name.length - 1 ? name.slice(lastDot + 1).toLowerCase() : '';
    const headerMime = String(ctx.get('x-file-mime-type') || '').trim().toLowerCase();
    const mimeType = storageFileTypes[extension] || (headerMime && headerMime !== 'application/octet-stream' ? headerMime : '');
    if (!extension || !mimeType || !storageFileTypes[extension]) return jsonError(ctx, 400, 'unsupported_storage_file', '不支持此文件格式');

    const chunks = [];
    let size = 0;
    for await (const chunk of ctx.req) {
      size += chunk.length;
      if (size <= storageFileMaxBytes) chunks.push(chunk);
    }
    if (size > storageFileMaxBytes) return jsonError(ctx, 413, 'storage_file_too_large', `单个文件不能超过 ${Math.round(storageFileMaxBytes / 1024 / 1024)}MB`);
    if (!size) return jsonError(ctx, 400, 'empty_storage_file', '文件内容为空');

    const storageKey = join(session.organizationId, scope, `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
    const storagePath = join(storageFileRoot, storageKey);
    await mkdir(join(storageFileRoot, session.organizationId, scope), { recursive: true });
    await writeFile(storagePath, Buffer.concat(chunks));
    let file;
    try {
      file = db.createStorageFile({ organizationId: session.organizationId, ownerUserId: session.userId, projectId, scope, name, mimeType, extension, sizeBytes: size, storageKey });
    } catch (error) {
      await unlink(storagePath).catch(() => {});
      throw error;
    }
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'storage.file.upload', entityType: 'storage_file', entityId: file.id, metadata: { scope: file.scope, projectId: file.projectId, name: file.name, sizeBytes: file.sizeBytes } });
    ctx.status = 201;
    ctx.body = { file };
  });

  const getVisibleStorageFile = (ctx, write = false) => {
    const session = ctx.state.session;
    const file = db.getStorageFile(session.organizationId, session.userId, ctx.params.fileId);
    if (!file) {
      jsonError(ctx, 404, 'storage_file_not_found', '文件不存在或无权访问');
      return null;
    }
    if (!authorize(ctx, write ? 'document.write' : 'document.read', { moduleKey: 'files', projectId: file.projectId || '' })) return null;
    return file;
  };

  const serveStorageFile = async (ctx, inline = false) => {
    const session = ctx.state.session;
    const file = getVisibleStorageFile(ctx);
    if (!file) return;
    const row = db.getStorageFileStorage(session.organizationId, file.id);
    if (!row) return jsonError(ctx, 404, 'storage_file_not_found', '文件不存在或无权访问');
    const storagePath = join(storageFileRoot, row.storage_key);
    let info;
    try {
      info = await stat(storagePath);
    } catch (error) {
      if (error?.code === 'ENOENT') return jsonError(ctx, 404, 'storage_file_missing', '文件内容已不存在或已清理');
      throw error;
    }
    const mimeType = String(row.mime_type || 'application/octet-stream').toLowerCase();
    const extension = String(row.extension || '').toLowerCase();
    const isTextPreview = mimeType.startsWith('text/') || ['csv', 'json', 'xml', 'md', 'txt', 'log'].includes(extension);
    if (inline && isTextPreview && info.size > 1024 * 1024) return jsonError(ctx, 413, 'storage_text_preview_too_large', '超过 1MB 的文本文件请下载后查看');
    ctx.type = row.mime_type || 'application/octet-stream';
    ctx.length = info.size;
    if (inline) {
      ctx.remove('Content-Disposition');
      ctx.set('Cache-Control', 'private, no-store');
      ctx.set('Content-Security-Policy', "sandbox; default-src 'none'");
      ctx.set('X-Content-Type-Options', 'nosniff');
    } else {
      ctx.attachment(file.name);
    }
    ctx.body = createReadStream(storagePath);
  };

  router.get('/storage/files/:fileId/download', requireAuth, ctx => serveStorageFile(ctx, false));
  router.get('/storage/files/:fileId/preview', requireAuth, ctx => serveStorageFile(ctx, true));

  router.delete('/storage/files/:fileId', requireAuth, async ctx => {
    const session = ctx.state.session;
    const file = getVisibleStorageFile(ctx, true);
    if (!file) return;
    if (file.scope === 'personal' && file.ownerUserId !== session.userId) return jsonError(ctx, 403, 'storage_file_delete_denied', '个人空间文件只能由上传者删除');
    if (file.scope === 'enterprise' && file.ownerUserId !== session.userId && !enterpriseCan(session, 'storage.enterprise.delete')) return jsonError(ctx, 403, 'storage_file_delete_denied', '需要删除企业公共文件权限');
    const row = db.deleteStorageFile(session.organizationId, file.id);
    if (!row) return jsonError(ctx, 404, 'storage_file_not_found', '文件不存在或已删除');
    await unlink(join(storageFileRoot, row.storage_key)).catch(() => {});
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'storage.file.delete', entityType: 'storage_file', entityId: row.id, metadata: { scope: row.scope, projectId: row.project_id || null, name: row.name, sizeBytes: row.size_bytes } });
    ctx.body = { ok: true };
  });

  router.post('/auth/login', ctx => {
    const username = validString(ctx.request.body?.username, 80);
    const password = String(ctx.request.body?.password ?? '');
    const identity = username && password ? db.authenticate(username, password) : null;
    if (!identity) return jsonError(ctx, 401, 'invalid_credentials', '账号或密码不正确');
    const session = db.createSession(identity.user.id, identity.organization.id);
    db.addAudit({ organizationId: identity.organization.id, userId: identity.user.id, action: 'auth.login', entityType: 'session', entityId: session.token.slice(0, 12), metadata: { userAgent: ctx.get('user-agent') || '' } });
    ctx.body = { token: session.token, ...sessionSnapshot(db.getSession(session.token)) };
  });

  router.post('/auth/logout', requireAuth, ctx => {
    const session = ctx.state.session;
    db.deleteSession(session.token);
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'auth.logout', entityType: 'session', entityId: session.token.slice(0, 12) });
    ctx.body = { ok: true };
  });

  router.get('/me', requireAuth, ctx => { ctx.body = sessionSnapshot(ctx.state.session); });
  router.get('/me/organizations', requireAuth, ctx => {
    const userId = ctx.state.session.userId;
    ctx.body = { organizations: db.listOrganizations().filter(organization => db.getMembership(userId, organization.id)).map(({ id, name, slug }) => ({ id, name, slug, role: db.getMembership(userId, id).role })) };
  });
  router.post('/me/organizations/:organizationId/switch', requireAuth, ctx => {
    const session = ctx.state.session;
    const targetId = ctx.params.organizationId;
    if (!db.getMembership(session.userId, targetId)) return jsonError(ctx, 403, 'organization_access_denied', '当前账号未加入该企业');
    const switched = db.createSession(session.userId, targetId);
    db.addAudit({ organizationId: targetId, userId: session.userId, action: 'organization.switch', entityType: 'organization', entityId: targetId, metadata: { fromOrganizationId: session.organizationId } });
    ctx.body = { token: switched.token, ...sessionSnapshot(db.getSession(switched.token)) };
  });

  // Platform operations use a separate grant set from enterprise membership.
  router.get('/platform/organizations', requireAuth, ctx => {
    if (!requirePlatform(ctx, 'organization.read')) return;
    ctx.body = { organizations: db.listOrganizations().map(organization => ({ ...organization, canEnter: Boolean(db.getMembership(ctx.state.session.userId, organization.id)), owners: db.listMembers(organization.id).filter(member => member.role === 'owner').map(member => ({ id: member.id, displayName: member.displayName })), modules: db.listOrganizationModules(organization.id) })) };
  });
  router.get('/platform/users', requireAuth, ctx => {
    if (!requirePlatform(ctx, 'user.read')) return;
    ctx.body = { users: db.listPlatformUsers() };
  });
  router.put('/platform/organizations/:organizationId/modules', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!requirePlatform(ctx, 'organization.modules.manage')) return;
    const organization = db.listOrganizations().find(item => item.id === ctx.params.organizationId);
    if (!organization) return jsonError(ctx, 404, 'organization_not_found', '企业不存在');
    const modules = db.setOrganizationModules(organization.id, ctx.request.body?.modules || {});
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'organization.modules.update', entityType: 'organization', entityId: organization.id, metadata: { modules } });
    ctx.body = { organization: { ...organization, modules } };
  });
  router.post('/platform/organizations/:organizationId/switch', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!requirePlatform(ctx, 'organization.read')) return;
    const target = db.listOrganizations().find(item => item.id === ctx.params.organizationId);
    if (!target) return jsonError(ctx, 404, 'organization_not_found', '企业不存在');
    const membership = db.getMembership(session.userId, target.id);
    if (!membership) return jsonError(ctx, 403, 'organization_access_denied', '当前账号未被授予该企业访问权限');
    const switched = db.createSession(session.userId, target.id);
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'organization.switch', entityType: 'organization', entityId: target.id, metadata: { fromOrganizationId: session.organizationId } });
    ctx.body = { token: switched.token, ...sessionSnapshot(db.getSession(switched.token)) };
  });
  router.post('/platform/organizations', requireAuth, ctx => {
    const session = ctx.state.session;
    try {
      const organization = db.createPlatformOrganization(session.userId, ctx.request.body);
      ctx.status = 201;
      ctx.body = { organization };
    } catch (error) {
      if (error instanceof PlatformAccessError) return jsonError(ctx, error.status, error.code, error.message);
      if (String(error?.message || '').includes('UNIQUE')) return jsonError(ctx, 409, 'organization_slug_exists', '企业标识已存在');
      throw error;
    }
  });

  router.get('/parts', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!authorize(ctx, 'part.read', { moduleKey: 'parts' })) return;
    ctx.body = { parts: db.listAllParts(session.organizationId).filter(part => hasProjectAccess(session, part.projectId)) };
  });
  router.get('/stats', requireAuth, ctx => {
    if (!authorize(ctx, 'stats.read', { moduleKey: 'stats' })) return;
    ctx.body = { stats: db.getOrganizationStats(ctx.state.session.organizationId) };
  });
  const taskHistoryReport = (ctx, exportAll = false) => {
    if (!authorize(ctx, 'stats.read', { moduleKey: 'stats' })) return null;
    try {
      return db.getTaskHistoryReport(ctx.state.session.organizationId, ctx.query, { exportAll });
    } catch (error) {
      if (String(error?.message || '').startsWith('invalid_history_')) {
        jsonError(ctx, 400, 'invalid_history_filter', '筛选条件无效，请检查日期、类型和分页参数');
        return null;
      }
      throw error;
    }
  };
  router.get('/stats/task-history', requireAuth, ctx => {
    const report = taskHistoryReport(ctx);
    if (report) ctx.body = report;
  });
  router.get('/stats/task-history/export.csv', requireAuth, ctx => {
    const report = taskHistoryReport(ctx, true);
    if (!report) return;
    ctx.set('Content-Type', 'text/csv; charset=utf-8');
    ctx.set('Content-Disposition', 'attachment; filename="task-history.csv"');
    ctx.body = taskHistoryCsv(report.records);
  });
  router.get('/tasks', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!authorize(ctx, 'task.read', { moduleKey: 'tasks' })) return;
    ctx.body = { tasks: db.listTasks(session.organizationId, session.userId).filter(task => !task.projectId || hasProjectAccess(session, task.projectId)) };
  });
  router.post('/tasks', requireAuth, ctx => {
    const session = ctx.state.session;
    const body = ctx.request.body || {};
    const title = validString(body.title);
    if (!title) return jsonError(ctx, 400, 'invalid_task', '任务名称不能为空');
    const projectId = validString(body.projectId, 100);
    if (!authorize(ctx, 'task.create', { moduleKey: 'tasks' })) return;
    if (Object.keys(body).some(key => CUSTOMER_FIELDS.has(key)) && !memberCan(session, 'customer.read')) return jsonError(ctx, 403, 'customer_access_denied', '未获授权查看或修改客户信息');
    if (Object.keys(body).some(key => PROJECT_LIST_FIELDS.has(key)) && !(memberCan(session, 'project.list.read') && memberCan(session, 'project.list.write'))) return jsonError(ctx, 403, 'project_list_access_denied', '未获授权查看或编辑项目清单');
    if (projectId) return jsonError(ctx, 400, 'project_task_creation_removed', '项目只保留创建时生成的根任务，请直接编辑项目任务详情');
    const requestedPriority = body.priority === undefined ? undefined : optionalString(body.priority, 20);
    if (requestedPriority === null) return jsonError(ctx, 400, 'invalid_task_priority', '任务优先级长度不符合要求');
    const priority = requestedPriority || '普通';
    if (!['普通', '高', '紧急'].includes(priority)) return jsonError(ctx, 400, 'invalid_task_priority', '不支持的任务优先级');
    const requestedStatus = body.status === undefined ? undefined : optionalString(body.status, 40);
    if (requestedStatus === null) return jsonError(ctx, 400, 'invalid_task_status', '任务状态长度不符合要求');
    if (requestedStatus && !taskStatusAllowed(requestedStatus)) return jsonError(ctx, 400, 'invalid_task_status', '不支持的任务状态');
    const description = richTextValue(body.description, 200000);
    if (description === INVALID_RICH_TEXT) return jsonError(ctx, 400, 'invalid_task_description', '备注内容过长或格式无效');
    const customerProfile = body.customerProfile === undefined ? undefined : validString(body.customerProfile, 200);
    const customerManagement = body.customerManagement === undefined ? undefined : validString(body.customerManagement, 200);
    const projectList = body.projectList === undefined ? undefined : validString(body.projectList, 200);
    const requestedAssignee = body.assigneeUserId == null ? '' : optionalString(body.assigneeUserId, 100);
    if (requestedAssignee === null) return jsonError(ctx, 400, 'invalid_task_assignee', '负责人标识长度不符合要求');
    const assigneeUserId = requestedAssignee || null;
    const assignee = db.listMembers(session.organizationId).find(member => member.id === assigneeUserId);
    if (assigneeUserId && !assignee) return jsonError(ctx, 404, 'assignee_not_found', '负责人不存在或不属于当前企业');
    if (assigneeUserId && !['owner', 'admin'].includes(session.role) && assigneeUserId !== session.userId) return jsonError(ctx, 403, 'task_access_denied', '当前成员只能创建分配给自己的独立任务');
    const stage = validString(body.stage, 80) || '未分组';
    // When a caller supplies one of the workflow nodes as the task stage and
    // omits status, keep the new task on that same node instead of silently
    // placing it back in the first column.
    const status = requestedStatus || (PROJECT_WORKFLOW_STAGES.includes(stage) ? stage : '立项沟通');
    const task = db.createTask({ organizationId: session.organizationId, projectId: null, userId: session.userId, title, description: description ?? '', customerProfile: customerProfile ?? '', customerManagement: customerManagement ?? '', projectList: projectList ?? '', stage, owner: assignee?.displayName || '', assigneeUserId, progress: body.progress, status, priority, startAt: validString(body.startAt, 40) || null, dueAt: validString(body.dueAt, 40) || null });
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'task.create', entityType: 'task', entityId: task.id, metadata: { title: task.title, projectId: null } });
    ctx.status = 201; ctx.body = { task };
  });
  router.get('/tasks/:taskId/attachments', requireAuth, ctx => {
    const session = ctx.state.session;
    const task = db.getTask(session.organizationId, ctx.params.taskId);
    if (!task) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    if (!authorizeTask(ctx, task)) return;
    if (!requireStandaloneTaskAssignee(ctx, task)) return;
    ctx.body = { attachments: db.listTaskAttachments(session.organizationId, task.id) };
  });
  router.post('/tasks/:taskId/attachments', requireAuth, async ctx => {
    const session = ctx.state.session;
    const task = db.getTask(session.organizationId, ctx.params.taskId);
    if (!task) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    if (!authorizeTask(ctx, task, task.projectId ? false : true)) return;
    if (!requireStandaloneTaskAssignee(ctx, task)) return;
    if (!requireTaskExecutor(ctx, task, 'attachment')) return;
    const name = chatFileName(ctx.get('x-file-name'));
    const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    const mimeType = chatAttachmentTypes[extension];
    if (!name || !mimeType) return jsonError(ctx, 400, 'unsupported_task_attachment', '不支持此附件格式');
    const chunks = []; let size = 0;
    for await (const chunk of ctx.req) {
      size += chunk.length;
      if (size > 50 * 1024 * 1024) return jsonError(ctx, 413, 'task_attachment_too_large', '单个任务附件不能超过 50MB');
      chunks.push(chunk);
    }
    if (!size) return jsonError(ctx, 400, 'empty_task_attachment', '附件内容为空');
    await mkdir(join(taskAttachmentRoot, session.organizationId), { recursive: true });
    const storageKey = join(session.organizationId, `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
    const storagePath = join(taskAttachmentRoot, storageKey);
    let attachment;
    try {
      // Keep the filesystem and database write ordered. If either operation
      // fails, remove a partially written file so retries cannot accumulate
      // orphaned task-attachment blobs.
      await writeFile(storagePath, Buffer.concat(chunks));
      attachment = db.createTaskAttachment({ organizationId: session.organizationId, taskId: task.id, userId: session.userId, name, mimeType, sizeBytes: size, storageKey });
    } catch (error) {
      await unlink(storagePath).catch(() => {});
      throw error;
    }
    if (!attachment) {
      await unlink(storagePath).catch(() => {});
      return jsonError(ctx, 400, 'task_attachment_unavailable', '附件关联的任务不可用');
    }
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'task.attachment.upload', entityType: 'task_attachment', entityId: attachment.id, metadata: { taskId: task.id, projectId: task.projectId, name: attachment.name, sizeBytes: attachment.sizeBytes } });
    ctx.status = 201;
    ctx.body = { attachment };
  });
  router.delete('/tasks/:taskId/attachments/:attachmentId', requireAuth, async ctx => {
    const session = ctx.state.session;
    const task = db.getTask(session.organizationId, ctx.params.taskId);
    if (!task) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    if (!authorizeTask(ctx, task, task.projectId ? false : true)) return;
    if (!requireStandaloneTaskAssignee(ctx, task)) return;
    if (!requireTaskExecutor(ctx, task, 'attachment')) return;
    const source = db.getTaskAttachmentStorage(session.organizationId, task.id, ctx.params.attachmentId);
    if (!source) return jsonError(ctx, 404, 'task_attachment_not_found', '任务附件不存在或无权删除');
    const row = db.deleteTaskAttachment(session.organizationId, task.id, ctx.params.attachmentId);
    if (!row) return jsonError(ctx, 404, 'task_attachment_not_found', '任务附件不存在或无权删除');
    await unlink(join(taskAttachmentRoot, row.storage_key)).catch(() => {});
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'task.attachment.delete', entityType: 'task_attachment', entityId: row.id, metadata: { taskId: task.id, projectId: task.projectId, name: row.name, sizeBytes: row.size_bytes } });
    ctx.body = { ok: true };
  });
  router.get('/tasks/:taskId/attachments/:attachmentId/download', requireAuth, async ctx => {
    const session = ctx.state.session;
    const task = db.getTask(session.organizationId, ctx.params.taskId);
    if (!task) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    if (!authorizeTask(ctx, task)) return;
    if (!requireStandaloneTaskAssignee(ctx, task)) return;
    const row = db.getTaskAttachmentStorage(session.organizationId, task.id, ctx.params.attachmentId);
    if (!row) return jsonError(ctx, 404, 'task_attachment_not_found', '任务附件不存在或无权下载');
    const storagePath = join(taskAttachmentRoot, row.storage_key);
    let info;
    try {
      info = await stat(storagePath);
    } catch (error) {
      if (error?.code === 'ENOENT') return jsonError(ctx, 404, 'task_attachment_file_missing', '附件文件已不存在或已清理');
      throw error;
    }
    ctx.type = row.mime_type || 'application/octet-stream';
    ctx.length = info.size;
    ctx.attachment(row.name);
    ctx.body = createReadStream(storagePath);
  });
  router.get('/tasks/:taskId/attachments/:attachmentId/preview', requireAuth, async ctx => {
    const session = ctx.state.session;
    const task = db.getTask(session.organizationId, ctx.params.taskId);
    if (!task) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    if (!authorizeTask(ctx, task)) return;
    if (!requireStandaloneTaskAssignee(ctx, task)) return;
    const row = db.getTaskAttachmentStorage(session.organizationId, task.id, ctx.params.attachmentId);
    if (!row) return jsonError(ctx, 404, 'task_attachment_not_found', '任务附件不存在或无权预览');
    const mimeType = String(row.mime_type || 'application/octet-stream').toLowerCase();
    const previewable = mimeType.startsWith('image/')
      || mimeType.startsWith('video/')
      || mimeType.startsWith('audio/')
      || mimeType === 'application/pdf'
      || mimeType.startsWith('text/')
      || mimeType === 'application/json'
      || mimeType === 'application/xml';
    if (!previewable) return jsonError(ctx, 415, 'task_attachment_preview_unsupported', '此附件类型不支持在线预览');
    const storagePath = join(taskAttachmentRoot, row.storage_key);
    let info;
    try {
      info = await stat(storagePath);
    } catch (error) {
      if (error?.code === 'ENOENT') return jsonError(ctx, 404, 'task_attachment_file_missing', '附件文件已不存在或已清理');
      throw error;
    }
    if ((mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') && info.size > 1024 * 1024) {
      return jsonError(ctx, 413, 'task_attachment_text_preview_too_large', '超过 1MB 的文本附件请下载后查看');
    }
    ctx.type = row.mime_type || 'application/octet-stream';
    ctx.length = info.size;
    ctx.remove('Content-Disposition');
    ctx.set('Cache-Control', 'private, no-store');
    ctx.set('Content-Security-Policy', "sandbox; default-src 'none'");
    ctx.set('X-Content-Type-Options', 'nosniff');
    ctx.body = createReadStream(storagePath);
  });
  router.get('/tasks/:taskId/detail', requireAuth, ctx => {
    const session = ctx.state.session;
    const task = db.getTask(session.organizationId, ctx.params.taskId);
    if (!task) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    if (!authorizeTask(ctx, task)) return;
    if (!task.projectId && !['owner', 'admin'].includes(session.role) && task.assigneeUserId !== session.userId) return jsonError(ctx, 403, 'task_access_denied', '当前成员未被分配此任务');
    const project = task.projectId ? db.getProject(session.organizationId, task.projectId) : null;
    const projectId = project?.id || '';
    const activities = db.listAudit(session.organizationId).filter(event => {
      if (event.entityId === task.id || event.metadata?.taskId === task.id) return true;
      if (!projectId) return false;
      return event.entityId === projectId || event.metadata?.projectId === projectId;
    });
    const capabilities = taskCapabilities(session, task);
    const subtasks = db.listTaskSubtasks(session.organizationId, task.id)
      .map(subtask => ({ ...subtask, capabilities: subtaskCapabilities(session, task, subtask) }));
    ctx.body = {
      task,
      capabilities,
      // A project root task is the collaboration surface for the whole
      // project. Return both comment streams so project-level notes do not
      // disappear just because the UI is opened from the task card.
      subtasks,
      comments: db.listTaskComments(session.organizationId, task.id),
      projectComments: projectId ? db.listProjectComments(session.organizationId, projectId) : [],
      attachments: db.listTaskAttachments(session.organizationId, task.id),
      activities,
      history: db.listTaskHistory(session.organizationId, task.id)
    };
  });
  router.put('/tasks/:taskId', requireAuth, ctx => {
    const session = ctx.state.session;
    const current = db.getTask(session.organizationId, ctx.params.taskId);
    if (!current) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    const body = ctx.request.body || {};
    const updateKeys = Object.keys(body);
    if (updateKeys.some(key => CUSTOMER_FIELDS.has(key)) && !memberCan(session, 'customer.read')) return jsonError(ctx, 403, 'customer_access_denied', '未获授权查看或修改客户信息');
    if (updateKeys.some(key => PROJECT_LIST_FIELDS.has(key)) && !(memberCan(session, 'project.list.read') && memberCan(session, 'project.list.write'))) return jsonError(ctx, 403, 'project_list_access_denied', '未获授权查看或编辑项目清单');
    const requestedSelfClaim = body.assigneeUserId == null ? '' : String(body.assigneeUserId).trim();
    const isProjectSelfClaim = Boolean(current.projectId)
      && updateKeys.length === 1
      && updateKeys[0] === 'assigneeUserId'
      && requestedSelfClaim === session.userId;
    // Claim is intentionally a separate, single-field operation.  It uses a
    // conditional database update so two project members racing to claim an
    // empty task cannot overwrite each other.
    if (isProjectSelfClaim) {
      if (!authorizeTask(ctx, current, false)) return;
      if (!canClaimProjectTask(session, current)) {
        if (current.assigneeUserId) return jsonError(ctx, 409, 'task_already_claimed', '任务已有负责人，请联系当前负责人交接');
        return jsonError(ctx, 403, 'task_claim_denied', '只有已加入项目的参与者可以认领空任务');
      }
      const claimed = db.claimTask(session.organizationId, current.id, session.userId);
      if (!claimed) return jsonError(ctx, 409, 'task_already_claimed', '任务已有负责人，请联系当前负责人交接');
      const project = db.syncProjectFromRootTask(session.organizationId, claimed);
      db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'task.claim', entityType: 'task', entityId: claimed.id, metadata: { projectId: claimed.projectId, assigneeUserId: claimed.assigneeUserId } });
      return void (ctx.body = { task: claimed, project, capabilities: taskCapabilities(session, claimed) });
    }
    // Project members can read the task, but only its current executor may
    // mutate task fields or hand the executor slot to another member.
    if (!authorizeTask(ctx, current, current.projectId ? false : true)) return;
    if (!requireTaskExecutor(ctx, current)) return;
    const progress = Number(body.progress);
    const status = body.status === undefined ? undefined : optionalString(body.status, 40);
    const priority = body.priority === undefined ? undefined : optionalString(body.priority, 20);
    const hasStartAt = Object.hasOwn(body, 'startAt');
    const hasDueAt = Object.hasOwn(body, 'dueAt');
    const hasText = ['title', 'description', 'customerProfile', 'customerManagement', 'projectList', 'stage', 'assigneeUserId'].some(key => Object.hasOwn(body, key));
    if (status === null) return jsonError(ctx, 400, 'invalid_task_status', '任务状态长度不符合要求');
    if (priority === null) return jsonError(ctx, 400, 'invalid_task_priority', '任务优先级长度不符合要求');
    if (!Number.isFinite(progress) && !status && !priority && !hasStartAt && !hasDueAt && !hasText) return jsonError(ctx, 400, 'invalid_task_update', '请提供任务内容、进度、状态、优先级或时间');
    if (status && !taskStatusAllowed(status)) return jsonError(ctx, 400, 'invalid_task_status', '不支持的任务状态');
    if (priority && !['普通', '高', '紧急'].includes(priority)) return jsonError(ctx, 400, 'invalid_task_priority', '不支持的任务优先级');
    if (body.title !== undefined && !validString(body.title, 160)) return jsonError(ctx, 400, 'invalid_task', '任务名称不能为空');
    const description = body.description === undefined ? undefined : richTextValue(body.description, 200000);
    if (description === INVALID_RICH_TEXT) return jsonError(ctx, 400, 'invalid_task_description', '备注内容过长或格式无效');
    const customerProfile = body.customerProfile === undefined ? undefined : validString(body.customerProfile, 200);
    const customerManagement = body.customerManagement === undefined ? undefined : validString(body.customerManagement, 200);
    const projectList = body.projectList === undefined ? undefined : validString(body.projectList, 200);
    let owner;
    let assigneeUserId;
    if (body.assigneeUserId !== undefined) {
      // Keep an explicit clear (`null`/empty string) distinct from malformed
      // values. `validString()` intentionally returns an empty string for an
      // overlong value, which would otherwise turn a bad request into a
      // destructive executor-clear operation.
      const rawAssignee = body.assigneeUserId;
      const requestedAssignee = rawAssignee == null
        ? ''
        : optionalString(rawAssignee, 100);
      if (requestedAssignee === null) {
        return jsonError(ctx, 400, 'invalid_task_assignee', '负责人标识长度不符合要求');
      }
      // An empty assignee is an explicit clear operation. This is distinct
      // from an omitted field, which preserves the current executor.
      if (!requestedAssignee) {
        if (current.projectId) {
          if (!isTaskExecutor(session, current)) return jsonError(ctx, 403, 'task_assignee_denied', '只有当前负责人可以清空负责人');
        } else if (!['owner', 'admin'].includes(session.role)) {
          return jsonError(ctx, 403, 'task_access_denied', '当前成员无权清空独立任务负责人');
        }
        assigneeUserId = null;
        owner = '';
      } else {
        assigneeUserId = requestedAssignee;
        const assignee = db.listMembers(session.organizationId).find(member => member.id === assigneeUserId);
        if (!assignee) return jsonError(ctx, 404, 'assignee_not_found', '负责人不存在或不属于当前企业');
        if (current.projectId) {
          if (!db.isProjectMember(session.organizationId, current.projectId, assigneeUserId)) {
            return jsonError(ctx, 403, 'project_member_required', '负责人必须先加入项目');
          }
          if (!isTaskExecutor(session, current)) return jsonError(ctx, 403, 'task_assignee_denied', '只有当前负责人可以交接任务');
        } else if (!['owner', 'admin'].includes(session.role) && assigneeUserId !== session.userId) {
          return jsonError(ctx, 403, 'task_access_denied', '当前成员只能将独立任务分配给自己');
        }
        owner = assignee.displayName;
      }
    }
    const task = db.updateTask(session.organizationId, current.id, { title: body.title === undefined ? undefined : validString(body.title, 160), description, customerProfile, customerManagement, projectList, stage: body.stage === undefined ? undefined : validString(body.stage, 80) || '未分组', assigneeUserId, owner, progress: Number.isFinite(progress) ? progress : undefined, status: status || undefined, priority: priority || undefined, startAt: hasStartAt ? validString(body.startAt, 40) : undefined, dueAt: hasDueAt ? validString(body.dueAt, 40) : undefined }, { expectedAssigneeUserId: current.assigneeUserId || null, actorUserId: session.userId });
    if (!task) {
      const latest = db.getTask(session.organizationId, current.id);
      if (!latest) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
      return jsonError(ctx, 409, 'task_execution_conflict', '任务负责人已变化，请刷新后重试');
    }
    const changed = {};
    const previousValues = {
      title: current.title,
      description: current.description || '',
      customerProfile: current.customerProfile || '',
      customerManagement: current.customerManagement || '',
      projectList: current.projectList || '',
      stage: current.stage || '未分组',
      owner: current.owner,
      assigneeUserId: current.assigneeUserId || '',
      progress: current.progress,
      status: current.status,
      priority: current.priority || '普通',
      startAt: current.startAt || '',
      dueAt: current.dueAt || ''
    };
    for (const key of ['title', 'description', 'customerProfile', 'customerManagement', 'projectList', 'stage', 'owner', 'assigneeUserId', 'progress', 'status', 'priority', 'startAt', 'dueAt']) {
      if (previousValues[key] !== task[key]) changed[key] = { from: previousValues[key] ?? '', to: task[key] ?? '' };
    }
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'task.update', entityType: 'task', entityId: task.id, metadata: { projectId: task.projectId, changed } });
    ctx.body = { task, project: db.syncProjectFromRootTask(session.organizationId, task) };
  });
  router.delete('/tasks/:taskId', requireAuth, async ctx => {
    const session = ctx.state.session;
    const current = db.getTask(session.organizationId, ctx.params.taskId);
    if (!current) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    // A project card is the project's canonical root task. Removing it would
    // orphan the project and violate the one-root-task invariant, so callers
    // must archive or move the project itself instead.
    if (current.projectId) {
      const project = db.getProject(session.organizationId, current.projectId);
      if (project?.rootTaskId === current.id) return jsonError(ctx, 409, 'project_root_task_delete_forbidden', '项目根任务暂不支持删除');
    }
    if (!authorizeTask(ctx, current, false)) return;
    if (!requireStandaloneTaskAssignee(ctx, current)) return;
    if (!memberCan(session, 'task.delete')) return jsonError(ctx, 403, 'task_delete_denied', '需要企业所有者授予删除任务权限');
    // Fetch private storage keys before the FK cascade removes the task,
    // including files attached to all nested subtasks.
    const attachmentRows = db.listTaskAttachmentStorage(session.organizationId, current.id);
    const deleted = db.deleteTask(session.organizationId, current.id, { actorUserId: session.userId });
    if (!deleted) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    for (const attachment of attachmentRows) {
      if (attachment?.storage_key) await unlink(join(taskAttachmentRoot, attachment.storage_key)).catch(() => {});
    }
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'task.delete', entityType: 'task', entityId: deleted.id, metadata: { taskId: deleted.id, projectId: deleted.projectId, title: deleted.title } });
    ctx.body = { ok: true, task: deleted };
  });
  router.get('/tasks/:taskId/subtasks', requireAuth, ctx => {
    const session = ctx.state.session;
    const task = db.getTask(session.organizationId, ctx.params.taskId);
    if (!task) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    if (!authorizeSubtaskTask(ctx, task, false)) return;
    const subtasks = db.listTaskSubtasks(session.organizationId, task.id);
    const completed = subtasks.filter(item => item.completed).length;
    ctx.body = { subtasks, summary: { total: subtasks.length, completed, remaining: subtasks.length - completed } };
  });
  router.get('/tasks/:taskId/subtasks/:parentSubtaskId/subtasks', requireAuth, ctx => {
    const session = ctx.state.session;
    const task = db.getTask(session.organizationId, ctx.params.taskId);
    if (!task) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    if (!authorizeSubtaskTask(ctx, task, false)) return;
    const parent = db.getTaskSubtask(session.organizationId, task.id, ctx.params.parentSubtaskId);
    if (!parent) return jsonError(ctx, 404, 'subtask_not_found', '父子任务不存在或无权访问');
    const subtasks = db.listTaskSubtasks(session.organizationId, task.id, parent.id);
    const completed = subtasks.filter(item => item.completed).length;
    ctx.body = { subtasks, summary: { total: subtasks.length, completed, remaining: subtasks.length - completed } };
  });
  router.get('/tasks/:taskId/subtasks/:subtaskId/detail', requireAuth, ctx => {
    const session = ctx.state.session;
    const task = db.getTask(session.organizationId, ctx.params.taskId);
    if (!task) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    if (!authorizeSubtaskTask(ctx, task, false)) return;
    const subtask = db.getTaskSubtask(session.organizationId, task.id, ctx.params.subtaskId);
    if (!subtask) return jsonError(ctx, 404, 'subtask_not_found', '子任务不存在或无权访问');
    const project = task.projectId ? db.getProject(session.organizationId, task.projectId) : null;
    const syntheticTask = {
      id: subtask.id,
      organizationId: task.organizationId,
      projectId: task.projectId,
      title: subtask.title,
      description: subtask.description || '',
      stage: subtask.status || '待处理',
      owner: subtask.assigneeDisplayName || subtask.assigneeUsername || '',
      assigneeUserId: subtask.assigneeUserId || '',
      progress: subtask.completed ? 100 : 0,
      status: subtask.status || (subtask.completed ? '已完成' : '待处理'),
      priority: subtask.priority || '普通',
      startAt: subtask.startAt || '',
      dueAt: subtask.dueAt || '',
      createdAt: subtask.createdAt,
      updatedAt: subtask.updatedAt
    };
    const children = db.listTaskSubtasks(session.organizationId, task.id, subtask.id);
    const activities = db.listAudit(session.organizationId).filter(event => (
      event.entityId === subtask.id
        || event.metadata?.subtaskId === subtask.id
        || (event.metadata?.taskId === task.id && event.metadata?.subtaskId === subtask.id)
    ));
    ctx.body = {
      task: syntheticTask,
      capabilities: subtaskCapabilities(session, task, subtask),
      parentTaskId: task.id,
      parentSubtaskId: subtask.parentSubtaskId || '',
      subtasks: children.map(child => ({ ...child, capabilities: subtaskCapabilities(session, task, child) })),
      comments: db.listTaskComments(session.organizationId, task.id, subtask.id),
      projectComments: [],
      attachments: db.listTaskAttachments(session.organizationId, task.id, subtask.id),
      activities,
      history: db.listTaskHistory(session.organizationId, task.id, subtask.id)
    };
  });
  router.get('/tasks/:taskId/subtasks/:subtaskId/attachments', requireAuth, ctx => {
    const scope = resolveSubtaskScope(ctx, false);
    if (!scope) return;
    ctx.body = { attachments: db.listTaskAttachments(scope.session.organizationId, scope.task.id, scope.subtask.id) };
  });
  router.post('/tasks/:taskId/subtasks/:subtaskId/attachments', requireAuth, async ctx => {
    const scope = resolveSubtaskScope(ctx, true);
    if (!scope) return;
    if (!isSubtaskExecutor(scope.session, scope.task, scope.subtask)) {
      return jsonError(ctx, 403, 'task_executor_required', '只有当前子任务负责人可以修改任务附件');
    }
    await uploadTaskAttachmentForScope(ctx, scope.task, scope.subtask.id);
  });
  router.delete('/tasks/:taskId/subtasks/:subtaskId/attachments/:attachmentId', requireAuth, async ctx => {
    const scope = resolveSubtaskScope(ctx, true);
    if (!scope) return;
    if (!isSubtaskExecutor(scope.session, scope.task, scope.subtask)) {
      return jsonError(ctx, 403, 'task_executor_required', '只有当前子任务负责人可以修改任务附件');
    }
    await deleteTaskAttachmentForScope(ctx, scope.task, ctx.params.attachmentId, scope.subtask.id);
  });
  router.get('/tasks/:taskId/subtasks/:subtaskId/attachments/:attachmentId/download', requireAuth, async ctx => {
    const scope = resolveSubtaskScope(ctx, false);
    if (!scope) return;
    await downloadTaskAttachmentForScope(ctx, scope.task, ctx.params.attachmentId, scope.subtask.id);
  });
  router.get('/tasks/:taskId/subtasks/:subtaskId/attachments/:attachmentId/preview', requireAuth, async ctx => {
    const scope = resolveSubtaskScope(ctx, false);
    if (!scope) return;
    await previewTaskAttachmentForScope(ctx, scope.task, ctx.params.attachmentId, scope.subtask.id);
  });
  router.post('/tasks/:taskId/subtasks/:subtaskId/comments', requireAuth, ctx => {
    const scope = resolveSubtaskScope(ctx, true);
    if (!scope) return;
    const body = validString(ctx.request.body?.body, 4000);
    if (!body) return jsonError(ctx, 400, 'invalid_comment', '评论内容不能为空');
    const comment = db.createTaskComment({ organizationId: scope.session.organizationId, taskId: scope.task.id, subtaskId: scope.subtask.id, userId: scope.session.userId, body });
    if (!comment) return jsonError(ctx, 404, 'subtask_not_found', '子任务不存在或无权访问');
    db.addAudit({ organizationId: scope.session.organizationId, userId: scope.session.userId, action: 'task.comment.create', entityType: 'task_comment', entityId: comment.id, metadata: { taskId: scope.task.id, subtaskId: scope.subtask.id, projectId: scope.task.projectId } });
    ctx.status = 201;
    ctx.body = { comment };
  });
  const createTaskSubtask = ctx => {
    const session = ctx.state.session;
    const task = db.getTask(session.organizationId, ctx.params.taskId);
    if (!task) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    if (!authorizeSubtaskTask(ctx, task, false)) return;
    const parentSubtaskId = ctx.params.parentSubtaskId || null;
    if (parentSubtaskId) {
      const parentSubtask = db.getTaskSubtask(session.organizationId, task.id, parentSubtaskId);
      if (!parentSubtask) return jsonError(ctx, 404, 'subtask_not_found', '父子任务不存在或无权访问');
      if (!isSubtaskExecutor(session, task, parentSubtask)) {
        return jsonError(ctx, 403, 'task_executor_required', '只有当前上级任务负责人可以创建下级子任务');
      }
    } else if (!requireTaskExecutor(ctx, task)) return;
    const body = ctx.request.body && typeof ctx.request.body === 'object' ? ctx.request.body : {};
    const title = validString(body.title, 160);
    if (!title) return jsonError(ctx, 400, 'invalid_subtask', '子任务名称不能为空');
    const description = richTextValue(body.description, 200000);
    if (description === INVALID_RICH_TEXT) return jsonError(ctx, 400, 'invalid_subtask_description', '子任务备注内容过长或格式无效');
    const status = body.status === undefined ? undefined : optionalString(body.status, 40);
    if (status === null) return jsonError(ctx, 400, 'invalid_subtask_status', '子任务状态长度不符合要求');
    if (status && !subtaskStatusAllowed(status)) return jsonError(ctx, 400, 'invalid_subtask_status', '不支持的子任务状态');
    const priority = body.priority === undefined ? undefined : optionalString(body.priority, 20);
    if (priority === null || (priority && !['普通', '高', '紧急'].includes(priority))) return jsonError(ctx, 400, 'invalid_subtask_priority', '不支持的子任务优先级');
    const completed = optionalBoolean(body.completed);
    if (completed === null) return jsonError(ctx, 400, 'invalid_subtask_completed', '子任务完成状态无效');
    const requestedAssigneeUserId = body.assigneeUserId === undefined ? undefined : optionalString(body.assigneeUserId, 100);
    const assigneeUserId = requestedAssigneeUserId;
    if (assigneeUserId === null) return jsonError(ctx, 400, 'invalid_subtask_assignee', '子任务负责人标识长度不符合要求');
    const dueAt = body.dueAt === undefined ? undefined : optionalString(body.dueAt, 40);
    if (dueAt === null) return jsonError(ctx, 400, 'invalid_subtask_due_at', '子任务截止时间长度不符合要求');
    const startAt = body.startAt === undefined ? undefined : optionalString(body.startAt, 40);
    if (startAt === null) return jsonError(ctx, 400, 'invalid_subtask_start_at', '子任务开始时间长度不符合要求');
    let position;
    if (body.position !== undefined) {
      position = Number(body.position);
      if (!Number.isInteger(position) || position < 0 || position > 1000000) return jsonError(ctx, 400, 'invalid_subtask_position', '子任务排序值无效');
    }
    let assignee = null;
    if (assigneeUserId) {
      assignee = db.listMembers(session.organizationId).find(member => member.id === assigneeUserId);
      if (!assignee) return jsonError(ctx, 404, 'assignee_not_found', '负责人不存在或不属于当前企业');
      if (task.projectId) {
        if (!db.isProjectMember(session.organizationId, task.projectId, assigneeUserId)) {
          return jsonError(ctx, 403, 'project_member_required', '子任务负责人必须先加入项目');
        }
      } else if (assigneeUserId !== session.userId && !['owner', 'admin'].includes(session.role)) {
        return jsonError(ctx, 403, 'task_assignee_denied', '当前成员只能将独立子任务分配给自己');
      }
    }
    const isCompleted = completed === true || status === '已完成' || status === '订单结束/已完成';
    const subtask = db.createTaskSubtask({
      organizationId: session.organizationId,
      taskId: task.id,
      parentSubtaskId,
      userId: session.userId,
      title,
      description: description ?? '',
      completed: isCompleted,
      status: status || (isCompleted ? '已完成' : '待处理'),
      priority: priority || '普通',
      assigneeUserId: assigneeUserId === undefined ? undefined : assigneeUserId || null,
      startAt: startAt || null,
      dueAt: dueAt || null,
      position
    });
    if (!subtask) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'task.subtask.create', entityType: 'task_subtask', entityId: subtask.id, metadata: { taskId: task.id, projectId: task.projectId, title: subtask.title, assigneeUserId: subtask.assigneeUserId || null } });
    ctx.status = 201;
    ctx.body = { subtask };
  };
  router.post('/tasks/:taskId/subtasks', requireAuth, createTaskSubtask);
  router.post('/tasks/:taskId/subtasks/:parentSubtaskId/subtasks', requireAuth, createTaskSubtask);
  const updateTaskSubtask = ctx => {
    const session = ctx.state.session;
    const task = db.getTask(session.organizationId, ctx.params.taskId);
    if (!task) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    if (!authorizeSubtaskTask(ctx, task, false)) return;
    const current = db.getTaskSubtask(session.organizationId, task.id, ctx.params.subtaskId);
    if (!current) return jsonError(ctx, 404, 'subtask_not_found', '子任务不存在或无权访问');
    const body = ctx.request.body && typeof ctx.request.body === 'object' ? ctx.request.body : {};
    const recognized = ['title', 'description', 'completed', 'status', 'priority', 'assigneeUserId', 'startAt', 'dueAt', 'position'];
    if (!recognized.some(key => Object.hasOwn(body, key))) return jsonError(ctx, 400, 'invalid_subtask_update', '请提供子任务内容');
    const subtaskExecutor = isSubtaskExecutor(session, task, current);
    const claimOnly = task.projectId
      && Object.keys(body).length === 1
      && Object.hasOwn(body, 'assigneeUserId')
      && String(body.assigneeUserId ?? '').trim() === session.userId;

    if (claimOnly && !current.assigneeUserId) {
      if (!isProjectTaskMember(session, task)) return jsonError(ctx, 403, 'task_claim_denied', '只有已加入项目的参与者可以认领空子任务');
      const claimed = db.claimTaskSubtask(session.organizationId, task.id, current.id, session.userId);
      if (!claimed) return jsonError(ctx, 409, 'task_already_claimed', '子任务已有负责人，请联系当前负责人交接');
      db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'task.subtask.claim', entityType: 'task_subtask', entityId: claimed.id, metadata: { taskId: task.id, projectId: task.projectId, assigneeUserId: claimed.assigneeUserId } });
      return void (ctx.body = { subtask: claimed, capabilities: subtaskCapabilities(session, task, claimed) });
    }

    const statusMutation = Object.hasOwn(body, 'status') || Object.hasOwn(body, 'completed');
    const metadataMutation = ['title', 'description', 'priority', 'startAt', 'dueAt', 'position'].some(key => Object.hasOwn(body, key));
    if (statusMutation && !subtaskExecutor) {
      return jsonError(ctx, 403, 'task_executor_required', '只有当前子任务负责人可以修改状态');
    }
    if (metadataMutation && !subtaskExecutor) {
      return jsonError(ctx, 403, 'task_executor_required', '只有当前子任务负责人可以修改子任务');
    }
    const changes = {};
    if (Object.hasOwn(body, 'title')) {
      const title = optionalString(body.title, 160);
      if (title === null || !title) return jsonError(ctx, 400, 'invalid_subtask', '子任务名称不能为空');
      changes.title = title;
    }
    if (Object.hasOwn(body, 'description')) {
      changes.description = richTextValue(body.description, 200000);
      if (changes.description === INVALID_RICH_TEXT) return jsonError(ctx, 400, 'invalid_subtask_description', '子任务备注内容过长或格式无效');
    }
    if (Object.hasOwn(body, 'completed')) {
      changes.completed = optionalBoolean(body.completed);
      if (changes.completed === null) return jsonError(ctx, 400, 'invalid_subtask_completed', '子任务完成状态无效');
    }
    if (Object.hasOwn(body, 'status')) {
      changes.status = optionalString(body.status, 40);
      if (changes.status === null || (changes.status && !subtaskStatusAllowed(changes.status))) return jsonError(ctx, 400, 'invalid_subtask_status', '不支持的子任务状态');
      if (!changes.status) return jsonError(ctx, 400, 'invalid_subtask_status', '子任务状态不能为空');
    }
    if (Object.hasOwn(body, 'priority')) {
      changes.priority = optionalString(body.priority, 20);
      if (changes.priority === null || !['普通', '高', '紧急'].includes(changes.priority)) return jsonError(ctx, 400, 'invalid_subtask_priority', '不支持的子任务优先级');
    }
    if (Object.hasOwn(body, 'dueAt')) {
      changes.dueAt = optionalString(body.dueAt, 40);
      if (changes.dueAt === null) return jsonError(ctx, 400, 'invalid_subtask_due_at', '子任务截止时间长度不符合要求');
    }
    if (Object.hasOwn(body, 'startAt')) {
      changes.startAt = optionalString(body.startAt, 40);
      if (changes.startAt === null) return jsonError(ctx, 400, 'invalid_subtask_start_at', '子任务开始时间长度不符合要求');
    }
    if (Object.hasOwn(body, 'position')) {
      const position = Number(body.position);
      if (!Number.isInteger(position) || position < 0 || position > 1000000) return jsonError(ctx, 400, 'invalid_subtask_position', '子任务排序值无效');
      changes.position = position;
    }
    if (Object.hasOwn(body, 'assigneeUserId')) {
      const assigneeUserId = optionalString(body.assigneeUserId, 100);
      if (assigneeUserId === null) return jsonError(ctx, 400, 'invalid_subtask_assignee', '子任务负责人标识长度不符合要求');
      if (!assigneeUserId) {
        if (!subtaskExecutor) return jsonError(ctx, 403, 'task_assignee_denied', '只有当前子任务负责人可以清空负责人');
        changes.assigneeUserId = null;
      } else {
        const assignee = db.listMembers(session.organizationId).find(member => member.id === assigneeUserId);
        if (!assignee) return jsonError(ctx, 404, 'assignee_not_found', '负责人不存在或不属于当前企业');
        if (task.projectId && !db.isProjectMember(session.organizationId, task.projectId, assigneeUserId)) {
          return jsonError(ctx, 403, 'project_member_required', '子任务负责人必须先加入项目');
        }
        if (!current.assigneeUserId && assigneeUserId !== session.userId) {
          return jsonError(ctx, 403, 'task_assignee_denied', '空子任务只能由当前成员认领');
        }
        if (current.assigneeUserId && assigneeUserId !== current.assigneeUserId && !subtaskExecutor) return jsonError(ctx, 403, 'task_assignee_denied', '只有当前子任务负责人可以交接');
        if (!current.assigneeUserId && assigneeUserId === session.userId && !isProjectTaskMember(session, task) && task.projectId) return jsonError(ctx, 403, 'task_claim_denied', '只有项目参与者可以认领子任务');
        changes.assigneeUserId = assigneeUserId;
      }
    }
    const subtask = db.updateTaskSubtask(session.organizationId, task.id, current.id, changes, { expectedAssigneeUserId: current.assigneeUserId || null, actorUserId: session.userId });
    if (!subtask) {
      const latest = db.getTaskSubtask(session.organizationId, task.id, current.id);
      if (!latest) return jsonError(ctx, 404, 'subtask_not_found', '子任务不存在或无权访问');
      return jsonError(ctx, 409, 'task_execution_conflict', '子任务负责人已变化，请刷新后重试');
    }
    const changed = {};
    for (const key of ['title', 'description', 'completed', 'status', 'priority', 'assigneeUserId', 'startAt', 'dueAt', 'position']) {
      if (current[key] !== subtask[key]) changed[key] = { from: current[key] ?? '', to: subtask[key] ?? '' };
    }
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'task.subtask.update', entityType: 'task_subtask', entityId: subtask.id, metadata: { taskId: task.id, projectId: task.projectId, changed } });
    ctx.body = { subtask, capabilities: subtaskCapabilities(session, task, subtask) };
  };
  router.put('/tasks/:taskId/subtasks/:subtaskId', requireAuth, updateTaskSubtask);
  router.patch('/tasks/:taskId/subtasks/:subtaskId', requireAuth, updateTaskSubtask);
  router.delete('/tasks/:taskId/subtasks/:subtaskId', requireAuth, async ctx => {
    const session = ctx.state.session;
    const task = db.getTask(session.organizationId, ctx.params.taskId);
    if (!task) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    if (!authorizeSubtaskTask(ctx, task, false)) return;
    const current = db.getTaskSubtask(session.organizationId, task.id, ctx.params.subtaskId);
    if (!current) return jsonError(ctx, 404, 'subtask_not_found', '子任务不存在或无权访问');
    if (!memberCan(session, 'task.delete')) return jsonError(ctx, 403, 'task_delete_denied', '需要企业所有者授予删除任务权限');
    const attachmentRows = db.listTaskAttachmentStorage(session.organizationId, task.id, current.id);
    const subtask = db.deleteTaskSubtask(session.organizationId, task.id, current.id, { actorUserId: session.userId });
    if (!subtask) return jsonError(ctx, 404, 'subtask_not_found', '子任务不存在或无权访问');
    for (const attachment of attachmentRows) {
      if (attachment?.storage_key) await unlink(join(taskAttachmentRoot, attachment.storage_key)).catch(() => {});
    }
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'task.subtask.delete', entityType: 'task_subtask', entityId: subtask.id, metadata: { taskId: task.id, projectId: task.projectId, title: subtask.title } });
    ctx.body = { subtask, ok: true };
  });
  router.post('/tasks/:taskId/comments', requireAuth, ctx => {
    const session = ctx.state.session; const task = db.getTask(session.organizationId, ctx.params.taskId);
    if (!task) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    if (!authorizeTask(ctx, task, false)) return;
    if (!requireStandaloneTaskAssignee(ctx, task)) return;
    if (!requireTaskCommentAccess(ctx, task)) return;
    const body = validString(ctx.request.body?.body, 4000); if (!body) return jsonError(ctx, 400, 'invalid_comment', '评论内容不能为空');
    const comment = db.createTaskComment({ organizationId: session.organizationId, taskId: task.id, userId: session.userId, body });
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'task.comment.create', entityType: 'task_comment', entityId: comment.id, metadata: { taskId: task.id, projectId: task.projectId } });
    ctx.status = 201; ctx.body = { comment };
  });
  router.post('/projects/:projectId/comments', requireAuth, ctx => {
    const session = ctx.state.session; const project = db.getProject(session.organizationId, ctx.params.projectId);
    if (!project) return jsonError(ctx, 404, 'project_not_found', '项目不存在或无权访问');
    // Project participants may collaborate through comments even when their
    // enterprise role does not grant project-wide write access.
    if (!authorize(ctx, 'project.read', { moduleKey: 'projects', projectId: project.id })) return;
    const body = validString(ctx.request.body?.body, 4000); if (!body) return jsonError(ctx, 400, 'invalid_comment', '评论内容不能为空');
    const comment = db.createProjectComment({ organizationId: session.organizationId, projectId: project.id, userId: session.userId, body });
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'project.comment.create', entityType: 'project_comment', entityId: comment.id, metadata: { projectId: project.id } });
    ctx.status = 201; ctx.body = { comment };
  });
  router.get('/conversations', requireAuth, ctx => {
    const session = ctx.state.session;
    const projectId = validString(ctx.query?.projectId, 100) || undefined;
    if (projectId && !authorize(ctx, 'communication.read', { moduleKey: 'communication', projectId })) return;
    const modules = db.listOrganizationModules(session.organizationId);
    const conversations = db.listConversations(session.organizationId, session.userId, projectId).filter(conversation => conversation.projectId
      ? modules.communication && enterpriseCan(session, 'communication.read') && hasProjectAccess(session, conversation.projectId)
      : modules.chat && enterpriseCan(session, 'chat.read'));
    ctx.body = { conversations };
  });
  router.post('/conversations', requireAuth, ctx => {
    const session = ctx.state.session; const title = validString(ctx.request.body?.title);
    if (!title) return jsonError(ctx, 400, 'invalid_conversation', '会话名称不能为空');
    const projectId = validString(ctx.request.body?.projectId, 100) || null;
    if (!authorize(ctx, projectId ? 'communication.write' : 'chat.write', { moduleKey: projectId ? 'communication' : 'chat', projectId })) return;
    const conversation = db.createConversation({ organizationId: session.organizationId, projectId, title });
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'conversation.create', entityType: 'conversation', entityId: conversation.id, metadata: { title, projectId } });
    ctx.status = 201; ctx.body = { conversation };
  });
  router.get('/conversations/:conversationId/messages', requireAuth, ctx => {
    const session = ctx.state.session; const conversation = db.getConversation(session.organizationId, ctx.params.conversationId);
    if (!conversation) return jsonError(ctx, 404, 'conversation_not_found', '会话不存在或无权访问');
    if (!authorizeConversation(ctx, conversation)) return;
    const messages = db.listMessages(session.organizationId, ctx.params.conversationId);
    // Hydration also fetches a small amount of history before the user opens
    // a thread, so read state must be explicit rather than a side effect of
    // every GET.  Active clients opt in with ?markRead=true.
    if (ctx.query?.markRead === 'true' && messages.length) db.updateConversationUserState(session.organizationId, conversation.id, session.userId, { read: true });
    ctx.body = { messages };
  });
  router.post('/conversations/:conversationId/messages', requireAuth, ctx => {
    const session = ctx.state.session;
    const conversation = db.getConversation(session.organizationId, ctx.params.conversationId);
    if (!conversation) return jsonError(ctx, 404, 'conversation_not_found', '会话不存在或无权访问');
    if (!authorizeConversation(ctx, conversation, true)) return;
    const body = String(ctx.request.body?.body ?? '').trim();
    const attachmentIds = Array.isArray(ctx.request.body?.attachmentIds) ? [...new Set(ctx.request.body.attachmentIds.map(value => validString(value, 120)).filter(Boolean))] : [];
    if (body.length > 4000) return jsonError(ctx, 400, 'message_too_long', '消息不能超过 4000 个字符');
    if (attachmentIds.length > 5) return jsonError(ctx, 400, 'too_many_attachments', '每条消息最多发送 5 个附件');
    if (!body && !attachmentIds.length) return jsonError(ctx, 400, 'invalid_message', '请输入消息或添加附件');
    const message = db.createMessage({ organizationId: session.organizationId, conversationId: ctx.params.conversationId, userId: session.userId, body, attachmentIds });
    if (!message) return jsonError(ctx, 400, 'attachment_unavailable', '附件不存在、已发送或无权使用');
    db.updateConversationUserState(session.organizationId, conversation.id, session.userId, { read: true });
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'message.create', entityType: 'message', entityId: message.id, metadata: { conversationId: ctx.params.conversationId, projectId: conversation.projectId, body: body.slice(0, 160), attachmentCount: attachmentIds.length } });
    ctx.status = 201; ctx.body = { message };
  });
  router.put('/conversations/:conversationId/state', requireAuth, ctx => {
    const session = ctx.state.session;
    const conversation = db.getConversation(session.organizationId, ctx.params.conversationId);
    if (!conversation) return jsonError(ctx, 404, 'conversation_not_found', '会话不存在或无权访问');
    if (!authorizeConversation(ctx, conversation)) return;
    const changes = {};
    if (ctx.request.body?.read === true) changes.read = true;
    if (Object.hasOwn(ctx.request.body || {}, 'savedForLater')) changes.savedForLater = Boolean(ctx.request.body.savedForLater);
    if (!Object.keys(changes).length) return jsonError(ctx, 400, 'invalid_conversation_state', '请提供已读或稍后处理状态');
    ctx.body = { state: db.updateConversationUserState(session.organizationId, ctx.params.conversationId, session.userId, changes) };
  });
  router.post('/chat-attachments', requireAuth, async ctx => {
    const session = ctx.state.session;
    // A project conversation belongs to the communication module, which can
    // be enabled independently from enterprise chat.  The client supplies the
    // selected conversation so attachment upload follows the same permission
    // and project-membership rules as sending its message.
    const conversationId = validString(ctx.get('x-conversation-id'), 120);
    let pendingConversation = null;
    if (conversationId) {
      pendingConversation = db.getConversation(session.organizationId, conversationId);
      if (!pendingConversation) return jsonError(ctx, 404, 'conversation_not_found', '会话不存在或无权访问');
      if (!authorizeConversation(ctx, pendingConversation, true)) return;
    } else if (!authorize(ctx, 'chat.write', { moduleKey: 'chat' })) return;
    const name = chatFileName(ctx.get('x-file-name'));
    const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    const mimeType = chatAttachmentTypes[extension];
    if (!name || !mimeType) return jsonError(ctx, 400, 'unsupported_chat_attachment', '不支持此附件格式');
    const chunks = []; let size = 0;
    for await (const chunk of ctx.req) {
      size += chunk.length;
      if (size > 50 * 1024 * 1024) return jsonError(ctx, 413, 'chat_attachment_too_large', '单个附件不能超过 50MB');
      chunks.push(chunk);
    }
    if (!size) return jsonError(ctx, 400, 'empty_chat_attachment', '附件内容为空');
    await mkdir(join(chatAttachmentRoot, session.organizationId), { recursive: true });
    const storageKey = join(session.organizationId, `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
    await writeFile(join(chatAttachmentRoot, storageKey), Buffer.concat(chunks));
    const attachment = db.createChatAttachment({ organizationId: session.organizationId, userId: session.userId, name, mimeType, sizeBytes: size, storageKey, pendingConversationId: pendingConversation?.id || null });
    if (!attachment) {
      await unlink(join(chatAttachmentRoot, storageKey)).catch(() => {});
      return jsonError(ctx, 400, 'attachment_unavailable', '附件关联的会话不可用');
    }
    ctx.status = 201; ctx.body = { attachment };
  });
  router.delete('/chat-attachments/:attachmentId', requireAuth, async ctx => {
    const session = ctx.state.session;
    const pending = db.getPendingChatAttachmentStorage(session.organizationId, session.userId, ctx.params.attachmentId);
    if (!pending) return jsonError(ctx, 404, 'chat_attachment_not_found', '待发送附件不存在或无权删除');
    if (pending.pending_conversation_id) {
      const conversation = db.getConversation(session.organizationId, pending.pending_conversation_id);
      if (!conversation) return jsonError(ctx, 404, 'conversation_not_found', '会话不存在或无权访问');
      if (!authorizeConversation(ctx, conversation, true)) return;
    } else if (!authorize(ctx, 'chat.write', { moduleKey: 'chat' })) return;
    const row = db.deletePendingChatAttachment(session.organizationId, session.userId, ctx.params.attachmentId);
    if (!row) return jsonError(ctx, 404, 'chat_attachment_not_found', '待发送附件不存在或无权删除');
    await unlink(join(chatAttachmentRoot, row.storage_key)).catch(() => {});
    ctx.body = { ok: true };
  });
  router.get('/chat-attachments/:attachmentId/download', requireAuth, async ctx => {
    const session = ctx.state.session;
    const row = db.getChatAttachmentStorage(session.organizationId, ctx.params.attachmentId);
    if (!row || (!row.message_id && row.uploader_user_id !== session.userId)) return jsonError(ctx, 404, 'chat_attachment_not_found', '附件不存在或无权下载');
    if (row.project_id) {
      if (!authorize(ctx, 'communication.read', { moduleKey: 'communication', projectId: row.project_id })) return;
    } else if (!authorize(ctx, 'chat.read', { moduleKey: 'chat' })) return;
    let file;
    try {
      file = await readFile(join(chatAttachmentRoot, row.storage_key));
    } catch (error) {
      if (error?.code === 'ENOENT') return jsonError(ctx, 404, 'chat_attachment_file_missing', '附件文件已不存在或已清理');
      throw error;
    }
    ctx.type = row.mime_type || 'application/octet-stream';
    ctx.attachment(row.name);
    ctx.body = file;
  });

  router.get('/projects', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!authorize(ctx, 'project.read', { moduleKey: 'projects' })) return;
    ctx.body = { organization: session.organization, modules: db.listOrganizationModules(session.organizationId), projects: db.listProjectsForUser(session.organizationId, session.userId, session.role) };
  });
  router.post('/projects', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!authorize(ctx, 'project.create', { moduleKey: 'projects' })) return;
    const body = ctx.request.body || {};
    const title = validString(body.title);
    if (!title) return jsonError(ctx, 400, 'invalid_project', '项目名称不能为空');
    const requestedStage = body.stage === undefined ? undefined : optionalString(body.stage, 80);
    if (requestedStage === null || requestedStage === '') return jsonError(ctx, 400, 'invalid_project_stage', '项目节点不能为空或过长');
    const stage = requestedStage || '立项沟通';
    if (!PROJECT_WORKFLOW_STAGES.includes(stage)) return jsonError(ctx, 400, 'invalid_project_stage', '项目节点必须是预设流程节点');
    const requestedStatus = body.status === undefined ? undefined : optionalString(body.status, 40);
    if (requestedStatus === null) return jsonError(ctx, 400, 'invalid_project_status', '项目任务状态长度不符合要求');
    const status = requestedStatus || (PROJECT_WORKFLOW_STAGES.includes(stage) ? stage : '立项沟通');
    if (!taskStatusAllowed(status)) return jsonError(ctx, 400, 'invalid_project_status', '不支持的项目任务状态');
    let project;
    try {
      project = db.createProject({ organizationId: session.organizationId, userId: session.userId, title, stage, status, owner: session.user.displayName, ownerUserId: session.userId, tag: validString(body.tag, 80), progress: Number(body.progress) || 0, step: validString(body.step, 30) || '0/1' });
    } catch (error) {
      if (String(error?.message || '') === 'invalid_project_stage') return jsonError(ctx, 400, 'invalid_project_stage', '项目节点必须是预设流程节点');
      throw error;
    }
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'project.create', entityType: 'project', entityId: project.id, metadata: { title: project.title, stage: project.stage, rootTaskId: project.rootTaskId } });
    ctx.status = 201;
    ctx.body = { project };
  });
  router.put('/projects/:projectId', requireAuth, ctx => {
    const session = ctx.state.session;
    const projectId = ctx.params.projectId;
    const currentProject = db.getProject(session.organizationId, projectId);
    if (!currentProject) return jsonError(ctx, 404, 'project_not_found', '项目不存在或无权访问');
    const body = ctx.request.body || {};
    const taskFields = ['status', 'tag', 'owner', 'progress', 'step', 'description', 'priority', 'startAt', 'dueAt'];
    if (taskFields.some(field => Object.hasOwn(body, field))) {
      return jsonError(ctx, 400, 'project_task_fields_moved', '项目卡只支持修改名称和看板阶段；任务字段请在任务详情中修改');
    }
    const hasTitle = Object.hasOwn(body, 'title');
    const hasStage = Object.hasOwn(body, 'stage');
    if (!hasTitle && !hasStage) return jsonError(ctx, 400, 'invalid_project_update', '请提供项目名称或流程节点');
    const title = validString(body.title, 160);
    const stage = body.stage === undefined ? undefined : optionalString(body.stage, 80);
    const previousProject = currentProject;
    if (body.title !== undefined && !title) return jsonError(ctx, 400, 'invalid_project', '项目名称不能为空');
    if (stage === null || stage === '') return jsonError(ctx, 400, 'invalid_project_stage', '项目节点不能为空或过长');
    if (stage !== undefined && !PROJECT_WORKFLOW_STAGES.includes(stage)) return jsonError(ctx, 400, 'invalid_project_stage', '项目节点必须是预设流程节点');
    // Title and workflow stage have separate ownership boundaries.  When a
    // client submits both fields in one request, enforce both checks instead
    // of letting the stage executor implicitly rename the project.
    if (hasTitle) {
      if (!authorize(ctx, 'project.write', { moduleKey: 'projects', projectId })) return;
    }
    if (hasStage) {
      const rootTask = currentProject.rootTaskId ? db.getTask(session.organizationId, currentProject.rootTaskId) : null;
      if (!rootTask) return jsonError(ctx, 409, 'project_root_task_missing', '项目根任务不存在，无法切换流程节点');
      if (!authorizeTask(ctx, rootTask, false)) return;
      if (!requireTaskExecutor(ctx, rootTask, 'status')) return;
    }
    const rootTaskForCondition = hasStage && currentProject.rootTaskId
      ? db.getTask(session.organizationId, currentProject.rootTaskId)
      : null;
    const project = db.updateProject(session.organizationId, projectId, { title: body.title === undefined ? undefined : title, stage: body.stage === undefined ? undefined : stage }, hasStage
      ? { expectedAssigneeUserId: rootTaskForCondition?.assigneeUserId || null, actorUserId: session.userId }
      : { actorUserId: session.userId });
    if (!project) {
      const latest = db.getProject(session.organizationId, projectId);
      if (!latest) return jsonError(ctx, 404, 'project_not_found', '项目不存在或无权访问');
      return jsonError(ctx, 409, 'task_execution_conflict', '任务负责人已变化，请刷新后重试');
    }
    const changed = {};
    for (const key of ['title', 'stage']) {
      if (previousProject?.[key] !== project[key]) changed[key] = { from: previousProject?.[key] ?? '', to: project[key] ?? '' };
    }
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'project.update', entityType: 'project', entityId: project.id, metadata: { projectId: project.id, changed } });
    ctx.body = { project };
  });
  router.get('/projects/:projectId', requireAuth, ctx => {
    const session = ctx.state.session;
    const project = authorize(ctx, 'project.read', { moduleKey: 'projects', projectId: ctx.params.projectId });
    if (!project) return;
    ctx.body = { project, parts: db.listParts(session.organizationId, project.id) };
  });
  // The task detail popup needs one consistent, permission-aware snapshot of
  // everything attached to a project. Keep the existing resource endpoints
  // unchanged, while returning empty collections for modules a tenant has
  // disabled (or a role cannot read) instead of leaking their data.
  router.get('/projects/:projectId/related', requireAuth, ctx => {
    const session = ctx.state.session;
    const project = authorize(ctx, 'project.read', { moduleKey: 'projects', projectId: ctx.params.projectId });
    if (!project) return;
    const modules = db.listOrganizationModules(session.organizationId);
    const canRead = (permission, moduleKey) => Boolean(modules[moduleKey] && enterpriseCan(session, permission));
    const parts = canRead('part.read', 'parts') ? db.listParts(session.organizationId, project.id) : [];
    const quotes = canRead('quote.read', 'workspace') ? db.listQuotes(session.organizationId, project.id) : [];
    const fairItems = canRead('fair.read', 'parts') ? db.listFairItems(session.organizationId, project.id) : [];
    const documents = canRead('document.read', 'workspace')
      ? db.listOfficeDocuments(session.organizationId, session.userId, project.id)
        .filter(document => !document.projectId || hasProjectAccess(session, document.projectId))
      : [];
    const conversations = canRead('communication.read', 'communication')
      ? db.listConversations(session.organizationId, session.userId, project.id)
      : [];
    const rootTask = db.getProjectRootTask(session.organizationId, project.id);
    const subtasks = rootTask ? db.listTaskSubtasks(session.organizationId, rootTask.id) : [];
    const completedSubtasks = subtasks.filter(item => item.completed).length;
    // Root-task attachments are part of the project collaboration surface and
    // remain available when the standalone "我的任务" module is disabled.
    const taskAttachments = rootTask ? db.listTaskAttachments(session.organizationId, rootTask.id) : [];
    ctx.body = {
      project,
      parts,
      quotes,
      fairItems,
      documents,
      taskAttachments,
      subtasks,
      subtaskSummary: { total: subtasks.length, completed: completedSubtasks, remaining: subtasks.length - completedSubtasks },
      conversations,
      available: {
        parts: canRead('part.read', 'parts'),
        quotes: canRead('quote.read', 'workspace'),
        fairItems: canRead('fair.read', 'parts'),
        documents: canRead('document.read', 'workspace'),
        taskAttachments: Boolean(rootTask),
        subtasks: Boolean(rootTask),
        conversations: canRead('communication.read', 'communication')
      }
    };
  });
  router.get('/projects/:projectId/members', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!authorize(ctx, 'project.read', { moduleKey: 'projects', projectId: ctx.params.projectId })) return;
    ctx.body = { members: db.listProjectMembers(session.organizationId, ctx.params.projectId) };
  });
  router.post('/projects/:projectId/members', requireAuth, ctx => {
    const session = ctx.state.session;
    const projectId = ctx.params.projectId;
    const project = authorizeProjectMemberManage(ctx, projectId);
    if (!project) return;
    const userId = validString(ctx.request.body?.userId, 100);
    if (!userId) return jsonError(ctx, 400, 'invalid_project_member', '请选择企业成员');
    if (!db.getMembership(userId, session.organizationId)) return jsonError(ctx, 404, 'member_not_found', '成员不存在或不属于当前企业');
    // A project has participants only. Creation is an audit fact, never a
    // project role or a source of member-management authority.
    const projectRole = 'member';
    const row = db.addProjectMember({ organizationId: session.organizationId, projectId, userId, projectRole, createdBy: session.userId });
    const member = { id: row.id, username: row.username, displayName: row.display_name, projectRole: row.project_role, createdAt: row.created_at };
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'project.member.add', entityType: 'project_member', entityId: `${projectId}:${userId}`, metadata: { projectId, userId, userName: member.displayName || member.username, projectRole } });
    ctx.status = 201;
    ctx.body = { member };
  });
  router.delete('/projects/:projectId/members/:userId', requireAuth, ctx => {
    if (!authorizeProjectMemberManage(ctx, ctx.params.projectId)) return;
    try {
      ctx.body = db.removeProjectMember(ctx.state.session.organizationId, ctx.params.projectId, ctx.params.userId, ctx.state.session.userId);
    } catch (error) {
      const failures = {
        project_member_not_found: { status: 404, message: '该成员已不在项目中，请刷新参与者列表' },
        project_member_assigned: { status: 409, message: '该成员仍是任务或子任务负责人，请先交接后再移出项目' }
      };
      const failure = failures[error.message];
      if (!failure) throw error;
      return jsonError(ctx, failure.status, error.message, failure.message);
    }
  });
  router.get('/projects/:projectId/parts', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!authorize(ctx, 'part.read', { moduleKey: 'parts', projectId: ctx.params.projectId })) return;
    ctx.body = { parts: db.listParts(session.organizationId, ctx.params.projectId) };
  });
  router.post('/projects/:projectId/parts', requireAuth, ctx => {
    const session = ctx.state.session;
    const projectId = ctx.params.projectId;
    if (!authorize(ctx, 'part.write', { moduleKey: 'parts', projectId })) return;
    const name = validString(ctx.request.body?.name);
    if (!name) return jsonError(ctx, 400, 'invalid_part', '零件名称不能为空');
    const part = db.createPart({ organizationId: session.organizationId, projectId, name, format: validString(ctx.request.body?.format, 20), material: validString(ctx.request.body?.material, 80), finish: validString(ctx.request.body?.finish, 120), dimensions: validString(ctx.request.body?.dimensions, 120), volume: validString(ctx.request.body?.volume, 60), quantity: ctx.request.body?.quantity });
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'part.create', entityType: 'part', entityId: part.id, metadata: { projectId, name: part.name } });
    ctx.status = 201;
    ctx.body = { part };
  });
  router.put('/parts/:partId', requireAuth, ctx => {
    const session = ctx.state.session;
    const body = ctx.request.body || {};
    const name = optionalString(body.name, 160);
    const format = optionalString(body.format, 20);
    const material = optionalString(body.material, 80);
    const finish = optionalString(body.finish, 120);
    const dimensions = optionalString(body.dimensions, 120);
    const volume = optionalString(body.volume, 60);
    const requestedProjectId = optionalString(body.projectId, 100);
    const current = db.getPart(session.organizationId, ctx.params.partId);
    if (!current) return jsonError(ctx, 404, 'part_not_found', '零件不存在或无权访问');
    if (!authorize(ctx, 'part.write', { moduleKey: 'parts', projectId: current.projectId })) return;
    if (name === null || format === null || material === null || finish === null || dimensions === null || volume === null || requestedProjectId === null) return jsonError(ctx, 400, 'invalid_part', '零件信息长度不符合要求');
    if (name === '') return jsonError(ctx, 400, 'invalid_part', '零件名称不能为空');
    if (requestedProjectId === '') return jsonError(ctx, 400, 'invalid_project', '所属项目不能为空');
    if (requestedProjectId && requestedProjectId !== current.projectId && !authorize(ctx, 'part.write', { moduleKey: 'parts', projectId: requestedProjectId })) return;
    const part = db.updatePart(session.organizationId, ctx.params.partId, { name, format, material, finish, dimensions, volume, quantity: body.quantity, projectId: requestedProjectId });
    if (!part) return jsonError(ctx, 404, 'part_not_found', '零件不存在或无权访问');
    const changed = {};
    for (const key of ['name', 'projectId', 'format', 'material', 'finish', 'size', 'volume', 'quantity']) {
      if (current[key] !== part[key]) changed[key] = { from: current[key] ?? '', to: part[key] ?? '' };
    }
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'part.update', entityType: 'part', entityId: part.id, metadata: { projectId: part.projectId, name: part.name, changed } });
    ctx.body = { part };
  });

  router.get('/projects/:projectId/quotes', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!authorize(ctx, 'quote.read', { moduleKey: 'workspace', projectId: ctx.params.projectId })) return;
    ctx.body = { quotes: db.listQuotes(session.organizationId, ctx.params.projectId) };
  });
  router.post('/projects/:projectId/quotes', requireAuth, ctx => {
    const session = ctx.state.session;
    const projectId = ctx.params.projectId;
    if (!authorize(ctx, 'quote.write', { moduleKey: 'workspace', projectId })) return;
    const lines = Array.isArray(ctx.request.body?.lines) ? ctx.request.body.lines : [];
    if (!lines.length) return jsonError(ctx, 400, 'invalid_quote', '报价至少需要一条 BOM 明细');
    if (lines.some(line => !validString(line.name))) return jsonError(ctx, 400, 'invalid_quote_line', 'BOM 明细名称不能为空');
    const quote = db.createQuote({ organizationId: session.organizationId, projectId, userId: session.userId, quoteNo: validString(ctx.request.body?.quoteNo, 80), currency: validString(ctx.request.body?.currency, 8) || 'CNY', lines });
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'quote.create', entityType: 'quote', entityId: quote.id, metadata: { projectId, quoteNo: quote.quoteNo, totalCents: quote.totalCents } });
    ctx.status = 201;
    ctx.body = { quote };
  });
  router.get('/projects/:projectId/quotes/:quoteId', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!authorize(ctx, 'quote.read', { moduleKey: 'workspace', projectId: ctx.params.projectId })) return;
    const quote = db.getQuote(session.organizationId, ctx.params.projectId, ctx.params.quoteId);
    if (!quote) return jsonError(ctx, 404, 'quote_not_found', '报价不存在或无权访问');
    ctx.body = { quote };
  });
  router.put('/projects/:projectId/quotes/:quoteId', requireAuth, ctx => {
    const session = ctx.state.session; const projectId = ctx.params.projectId;
    if (!authorize(ctx, 'quote.write', { moduleKey: 'workspace', projectId })) return;
    const lines = Array.isArray(ctx.request.body?.lines) ? ctx.request.body.lines : [];
    if (!lines.length || lines.some(line => !validString(line.name))) return jsonError(ctx, 400, 'invalid_quote', '报价至少需要一条有效 BOM 明细');
    const quote = db.updateQuote({ organizationId: session.organizationId, projectId, quoteId: ctx.params.quoteId, userId: session.userId, quoteNo: validString(ctx.request.body?.quoteNo, 80), currency: validString(ctx.request.body?.currency, 8) || 'CNY', lines });
    if (!quote) return jsonError(ctx, 404, 'quote_not_found', '报价不存在或无权访问');
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'quote.update', entityType: 'quote', entityId: quote.id, metadata: { projectId, quoteNo: quote.quoteNo, totalCents: quote.totalCents } });
    ctx.body = { quote };
  });

  router.get('/projects/:projectId/fair-items', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!authorize(ctx, 'fair.read', { moduleKey: 'parts', projectId: ctx.params.projectId })) return;
    ctx.body = { items: db.listFairItems(session.organizationId, ctx.params.projectId) };
  });
  router.post('/projects/:projectId/fair-items', requireAuth, ctx => {
    const session = ctx.state.session;
    const projectId = ctx.params.projectId;
    if (!authorize(ctx, 'fair.write', { moduleKey: 'parts', projectId })) return;
    const characteristic = validString(ctx.request.body?.characteristic);
    if (!characteristic) return jsonError(ctx, 400, 'invalid_fair_item', '检验特性不能为空');
    const item = db.createFairItem({ organizationId: session.organizationId, projectId, partId: validString(ctx.request.body?.partId, 100), characteristic, nominal: validString(ctx.request.body?.nominal, 80), tolerance: validString(ctx.request.body?.tolerance, 80), status: validString(ctx.request.body?.status, 30) || 'pending' });
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'fair.create', entityType: 'fair_item', entityId: item.id, metadata: { projectId, characteristic: item.characteristic } });
    ctx.status = 201;
    ctx.body = { item };
  });
  router.put('/projects/:projectId/fair-items/:itemId', requireAuth, ctx => {
    const session = ctx.state.session; const projectId = ctx.params.projectId; const status = validString(ctx.request.body?.status, 30);
    if (!authorize(ctx, 'fair.write', { moduleKey: 'parts', projectId })) return;
    if (!db.getProject(session.organizationId, projectId)) return jsonError(ctx, 404, 'project_not_found', '项目不存在或无权访问');
    if (!['pending', 'pass', 'fail'].includes(status)) return jsonError(ctx, 400, 'invalid_fair_status', '不支持的 FAIR 状态');
    const item = db.updateFairItem(session.organizationId, projectId, ctx.params.itemId, { status, characteristic: validString(ctx.request.body?.characteristic, 160) || undefined, nominal: validString(ctx.request.body?.nominal, 80) || undefined, tolerance: validString(ctx.request.body?.tolerance, 80) || undefined });
    if (!item) return jsonError(ctx, 404, 'fair_item_not_found', '检验项不存在或无权访问');
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'fair.update', entityType: 'fair_item', entityId: item.id, metadata: { projectId, status, characteristic: item.characteristic } });
    ctx.body = { item };
  });

  router.get('/members', requireAuth, ctx => {
    if (!authorize(ctx, 'member.read')) return;
    ctx.body = { members: db.listMembers(ctx.state.session.organizationId) };
  });
  router.post('/members', requireAuth, ctx => {
    const session = ctx.state.session;
    try {
      const member = db.createOrganizationMember(session.organizationId, session.userId, ctx.request.body);
      ctx.status = 201;
      ctx.body = { member };
    } catch (error) {
      if (error instanceof OrganizationAccessError) return jsonError(ctx, error.status, error.code, error.message);
      if (String(error?.message || '').includes('UNIQUE')) return jsonError(ctx, 409, 'username_exists', '账号已存在');
      throw error;
    }
  });
  router.put('/members/:userId/role', requireAuth, ctx => {
    const session = ctx.state.session;
    try {
      ctx.body = { member: db.updateOrganizationMember(session.organizationId, session.userId, ctx.params.userId, ctx.request.body) };
    } catch (error) {
      if (!(error instanceof OrganizationAccessError)) throw error;
      jsonError(ctx, error.status, error.code, error.message);
    }
  });
  router.get('/audit', requireAuth, ctx => {
    if (!authorize(ctx, 'audit.read')) return;
    ctx.body = { events: db.listAudit(ctx.state.session.organizationId) };
  });
  router.get('/platform/audit', requireAuth, ctx => {
    if (!requirePlatform(ctx, 'audit.read')) return;
    ctx.body = { events: db.listPlatformAudit() };
  });

  app.use(router.routes());
  app.use(router.allowedMethods());
  if (staticDir) app.use(serve(staticDir));
  app.on('close', () => db.close());
  return app;
}

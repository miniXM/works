import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import serve from 'koa-static';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { mkdir, copyFile, stat, readFile, writeFile, unlink } from 'node:fs/promises';
import { createDatabase } from './db.js';

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

const ROLE_PERMISSIONS = {
  owner: ['*'],
  admin: ['*'],
  engineer: [
    'project.read', 'project.create', 'project.write',
    'part.read', 'part.write', 'quote.read', 'quote.write', 'fair.read',
    'task.read', 'task.create', 'task.write',
    'communication.read', 'communication.write', 'chat.read', 'chat.write',
    'document.read', 'document.write', 'member.read'
  ],
  qa: [
    'project.read', 'part.read', 'fair.read', 'fair.write',
    'task.read', 'task.write', 'communication.read', 'communication.write',
    'chat.read', 'chat.write', 'document.read', 'member.read'
  ],
  viewer: [
    'project.read', 'part.read', 'quote.read', 'fair.read', 'task.read',
    'communication.read', 'chat.read', 'document.read', 'member.read'
  ]
};

function roleCan(role, permission) {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes('*') || permissions.includes(permission);
}

const chatAttachmentTypes = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  step: 'model/step', stp: 'model/step', iges: 'model/iges', igs: 'model/iges',
  dxf: 'image/vnd.dxf', dwg: 'image/vnd.dwg', txt: 'text/plain', csv: 'text/csv'
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
  const officeRoot = process.env.ONLYOFFICE_STORAGE_DIR || join(process.cwd(),'data','office-documents');
  const chatAttachmentRoot = process.env.CHAT_ATTACHMENT_STORAGE_DIR || join(process.cwd(), 'data', 'chat-attachments');
  const officeServer = process.env.ONLYOFFICE_SERVER_URL || 'http://43.139.7.28:8080';
  const publicBase = (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4310}/api`).replace(/\/$/, '');
  const jwtSecret = process.env.ONLYOFFICE_JWT_SECRET || 'mfggo-onlyoffice-2026';
  const jwt = payload => { const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url'); const head=enc({alg:'HS256',typ:'JWT'}),body=enc(payload); return `${head}.${body}.${createHmac('sha256',jwtSecret).update(`${head}.${body}`).digest('base64url')}`; };
  const fileSignature = (organizationId,documentId) => createHmac('sha256',jwtSecret).update(`${organizationId}:${documentId}`).digest('hex');
  const hasProjectAccess = (session, projectId) => ['owner', 'admin'].includes(session.role)
    || db.isProjectMember(session.organizationId, projectId, session.userId);
  const authorize = (ctx, permission, { moduleKey = '', projectId = '' } = {}) => {
    const session = ctx.state.session;
    if (!roleCan(session.role, permission)) {
      jsonError(ctx, 403, 'permission_denied', '当前企业角色无权执行此操作');
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
  const canAccessProjectAsUser = (organizationId, projectId, userId) => {
    const membership = db.getMembership(userId, organizationId);
    return Boolean(membership && (['owner', 'admin'].includes(membership.role) || db.isProjectMember(organizationId, projectId, userId)));
  };
  const requireStandaloneTaskAssignee = (ctx, task) => {
    const session = ctx.state.session;
    if (!task.projectId && !['owner', 'admin'].includes(session.role) && task.assigneeUserId !== session.userId) {
      jsonError(ctx, 403, 'task_access_denied', '当前成员未被分配此任务');
      return false;
    }
    return true;
  };

  app.context.db = db;
  app.close = () => db.close();
  app.on('error', error => console.error('[server]', error));
  app.use(async (ctx, next) => {
    try { await next(); } catch (error) { ctx.status = error.status || 500; ctx.body = { error: 'server_error', message: error.expose ? error.message : '服务暂时不可用' }; app.emit('error', error, ctx); }
  });
  app.use(bodyParser({ enableTypes: ['json'], jsonLimit: '2mb' }));

  router.get('/health', ctx => { ctx.body = { ok: true, service: 'mfggo-saas', time: new Date().toISOString() }; });

  router.get('/documents', requireAuth, ctx => {
    const session = ctx.state.session;
    const projectId = validString(ctx.query.projectId, 100) || undefined;
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
    await copyFile(join(process.cwd(), 'templates', `blank.${fileType}`), join(officeRoot, storageKey));
    const info = await stat(join(officeRoot, storageKey));
    const document = db.createOfficeDocument({ organizationId: session.organizationId, projectId, userId: session.userId, title, storageKey, sizeBytes: info.size, fileType });
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
    await writeFile(join(officeRoot, storageKey), Buffer.concat(chunks));
    const document = db.createOfficeDocument({ organizationId: session.organizationId, projectId, userId: session.userId, title, storageKey, sizeBytes: size, fileType });
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
    ctx.body = { document };
  });
  router.delete('/documents/:documentId', requireAuth, ctx => {
    const session = ctx.state.session;
    const source = db.getOfficeDocumentStorage(session.organizationId, ctx.params.documentId);
    if (!source || source.owner_user_id !== session.userId) return jsonError(ctx, 404, 'document_not_found', '文档不存在或无权删除');
    if (!authorizeDocument(ctx, 'document.write', source)) return;
    if (!db.trashOfficeDocument(session.organizationId, session.userId, ctx.params.documentId)) return jsonError(ctx, 404, 'document_not_found', '文档不存在或无权删除');
    ctx.body = { ok: true };
  });
  router.post('/documents/:documentId/restore', requireAuth, ctx => {
    const session = ctx.state.session;
    const source = db.getOfficeDocumentStorage(session.organizationId, ctx.params.documentId);
    if (!source || source.owner_user_id !== session.userId) return jsonError(ctx, 404, 'document_not_found', '回收站中不存在该文档');
    if (!authorizeDocument(ctx, 'document.write', source)) return;
    if (!db.restoreOfficeDocument(session.organizationId, session.userId, ctx.params.documentId)) return jsonError(ctx, 404, 'document_not_found', '回收站中不存在该文档');
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
    const config = { documentServer: officeServer, documentType: type, type: 'desktop', document: { fileType: document.fileType, key: `${document.id}-v${document.version}`, title: document.title, url: `${publicBase}/office-files/${document.id}/${downloadName}?v=${document.version}&organizationId=${encodeURIComponent(session.organizationId)}&signature=${signature}`, permissions: { edit: document.permission === 'edit' && document.fileType !== 'pdf', download: true, print: true } }, editorConfig: { mode: document.permission === 'edit' && document.fileType !== 'pdf' ? 'edit' : 'view', lang: 'zh-CN', callbackUrl: `${publicBase}/onlyoffice/callback/${document.id}?organizationId=${encodeURIComponent(session.organizationId)}&signature=${signature}`, user: { id: session.user.id, name: session.user.displayName } } };
    const tokenPayload = { ...config };
    delete tokenPayload.documentServer;
    config.token = jwt(tokenPayload);
    ctx.body = config;
  });
  router.get('/office-files/:documentId/:fileName', async ctx => { const organizationId=String(ctx.query.organizationId||'');if(ctx.query.signature!==fileSignature(organizationId,ctx.params.documentId))return jsonError(ctx,403,'forbidden','文件签名无效');const row=db.getOfficeDocumentStorage(organizationId,ctx.params.documentId);if(!row)return jsonError(ctx,404,'document_not_found','文档不存在');ctx.type=row.file_type==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':row.file_type==='pptx'?'application/vnd.openxmlformats-officedocument.presentationml.presentation':row.file_type==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';ctx.remove('Content-Disposition');ctx.body=await readFile(join(officeRoot,row.storage_key)); });
  // Keep existing editor sessions alive while clients roll over from the old /api-prefixed URLs.
  router.get('/api/office-files/:documentId', async ctx => { const organizationId=String(ctx.query.organizationId||'');if(ctx.query.signature!==fileSignature(organizationId,ctx.params.documentId))return jsonError(ctx,403,'forbidden','文件签名无效');const row=db.getOfficeDocumentStorage(organizationId,ctx.params.documentId);if(!row)return jsonError(ctx,404,'document_not_found','文档不存在');ctx.type=row.file_type==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':row.file_type==='pptx'?'application/vnd.openxmlformats-officedocument.presentationml.presentation':row.file_type==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';ctx.body=await readFile(join(officeRoot,row.storage_key)); });
  router.post('/onlyoffice/callback/:documentId', async ctx => { const organizationId=String(ctx.query.organizationId||'');if(ctx.query.signature!==fileSignature(organizationId,ctx.params.documentId))return jsonError(ctx,403,'forbidden','回调签名无效');const row=db.getOfficeDocumentStorage(organizationId,ctx.params.documentId);if(!row)return jsonError(ctx,404,'document_not_found','文档不存在');if([2,6].includes(Number(ctx.request.body?.status))&&ctx.request.body?.url){const response=await fetch(ctx.request.body.url);if(!response.ok)throw new Error('ONLYOFFICE save download failed');const data=Buffer.from(await response.arrayBuffer());await writeFile(join(officeRoot,row.storage_key),data);db.touchOfficeDocument(row.id,data.length);}ctx.body={error:0}; });
  router.post('/api/onlyoffice/callback/:documentId', async ctx => { const organizationId=String(ctx.query.organizationId||'');if(ctx.query.signature!==fileSignature(organizationId,ctx.params.documentId))return jsonError(ctx,403,'forbidden','回调签名无效');const row=db.getOfficeDocumentStorage(organizationId,ctx.params.documentId);if(!row)return jsonError(ctx,404,'document_not_found','文档不存在');if([2,6].includes(Number(ctx.request.body?.status))&&ctx.request.body?.url){const response=await fetch(ctx.request.body.url);if(!response.ok)throw new Error('ONLYOFFICE save download failed');const data=Buffer.from(await response.arrayBuffer());await writeFile(join(officeRoot,row.storage_key),data);db.touchOfficeDocument(row.id,data.length);}ctx.body={error:0}; });

  router.post('/auth/login', ctx => {
    const username = validString(ctx.request.body?.username, 80);
    const password = String(ctx.request.body?.password ?? '');
    const identity = username && password ? db.authenticate(username, password) : null;
    if (!identity) return jsonError(ctx, 401, 'invalid_credentials', '账号或密码不正确');
    const session = db.createSession(identity.user.id, identity.organization.id);
    db.addAudit({ organizationId: identity.organization.id, userId: identity.user.id, action: 'auth.login', entityType: 'session', entityId: session.token.slice(0, 12), metadata: { userAgent: ctx.get('user-agent') || '' } });
    ctx.body = { token: session.token, expiresAt: session.expiresAt, user: identity.user, organization: identity.organization, role: identity.role, platformAdmin: db.isPlatformAdmin(identity.user.id) };
  });

  router.post('/auth/logout', requireAuth, ctx => {
    const session = ctx.state.session;
    db.deleteSession(session.token);
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'auth.logout', entityType: 'session', entityId: session.token.slice(0, 12) });
    ctx.body = { ok: true };
  });

  router.get('/me', requireAuth, ctx => { const session = ctx.state.session; ctx.body = { user: session.user, organization: session.organization, role: session.role, platformAdmin: db.isPlatformAdmin(session.userId), modules: db.listOrganizationModules(session.organizationId), expiresAt: session.expiresAt }; });

  // 平台主后台：当前演示 owner 具备平台管理权限；业务数据仍按 session.organizationId 隔离。
  router.get('/platform/organizations', requireAuth, ctx => {
    if (!db.isPlatformAdmin(ctx.state.session.userId)) return jsonError(ctx, 403, 'forbidden', '需要平台管理员权限');
    ctx.body = { organizations: db.listOrganizations().map(organization => ({ ...organization, modules: db.listOrganizationModules(organization.id) })) };
  });
  router.get('/platform/users', requireAuth, ctx => {
    if (!db.isPlatformAdmin(ctx.state.session.userId)) return jsonError(ctx, 403, 'forbidden', '需要平台管理员权限');
    ctx.body = { users: db.listPlatformUsers() };
  });
  router.put('/platform/organizations/:organizationId/modules', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!db.isPlatformAdmin(session.userId)) return jsonError(ctx, 403, 'forbidden', '需要平台管理员权限');
    const organization = db.listOrganizations().find(item => item.id === ctx.params.organizationId);
    if (!organization) return jsonError(ctx, 404, 'organization_not_found', '企业不存在');
    const modules = db.setOrganizationModules(organization.id, ctx.request.body?.modules || {});
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'organization.modules.update', entityType: 'organization', entityId: organization.id, metadata: { modules } });
    ctx.body = { organization: { ...organization, modules } };
  });
  router.post('/platform/organizations/:organizationId/switch', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!db.isPlatformAdmin(session.userId)) return jsonError(ctx, 403, 'forbidden', '需要平台管理员权限');
    const target = db.listOrganizations().find(item => item.id === ctx.params.organizationId);
    if (!target) return jsonError(ctx, 404, 'organization_not_found', '企业不存在');
    const membership = db.getMembership(session.userId, target.id);
    if (!membership) return jsonError(ctx, 403, 'organization_access_denied', '当前账号未被授予该企业访问权限');
    const switched = db.createSession(session.userId, target.id);
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'organization.switch', entityType: 'organization', entityId: target.id, metadata: { fromOrganizationId: session.organizationId } });
    ctx.body = { token: switched.token, expiresAt: switched.expiresAt, organization: target, modules: db.listOrganizationModules(target.id), role: membership.role };
  });
  router.post('/platform/organizations', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!db.isPlatformAdmin(session.userId)) return jsonError(ctx, 403, 'forbidden', '需要平台管理员权限');
    const name = validString(ctx.request.body?.name, 120);
    const slug = validString(ctx.request.body?.slug, 80).toLowerCase();
    if (!name) return jsonError(ctx, 400, 'invalid_organization', '企业名称不能为空');
    if (!/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(slug)) return jsonError(ctx, 400, 'invalid_organization_slug', '企业标识需为 3-80 位小写字母、数字或连字符');
    try {
      const organization = db.createOrganization({ name, slug, ownerUserId: session.userId });
      db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'organization.create', entityType: 'organization', entityId: organization.id, metadata: { name, slug } });
      ctx.status = 201;
      ctx.body = { organization };
    } catch (error) {
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
  router.get('/tasks', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!authorize(ctx, 'task.read', { moduleKey: 'tasks' })) return;
    ctx.body = { tasks: db.listTasks(session.organizationId, session.userId).filter(task => !task.projectId || hasProjectAccess(session, task.projectId)) };
  });
  router.post('/tasks', requireAuth, ctx => {
    const session = ctx.state.session;
    const title = validString(ctx.request.body?.title);
    if (!title) return jsonError(ctx, 400, 'invalid_task', '任务名称不能为空');
    const projectId = validString(ctx.request.body?.projectId, 100) || null;
    if (!authorize(ctx, 'task.create', { moduleKey: 'tasks', projectId })) return;
    const priority = validString(ctx.request.body?.priority, 20) || '普通';
    if (!['普通', '高', '紧急'].includes(priority)) return jsonError(ctx, 400, 'invalid_task_priority', '不支持的任务优先级');
    const assigneeUserId = validString(ctx.request.body?.assigneeUserId, 100) || session.userId;
    const assignee = db.listMembers(session.organizationId).find(member => member.id === assigneeUserId);
    if (!assignee) return jsonError(ctx, 404, 'assignee_not_found', '负责人不存在或不属于当前企业');
    if (projectId && !canAccessProjectAsUser(session.organizationId, projectId, assigneeUserId)) return jsonError(ctx, 400, 'project_assignee_not_authorized', '项目任务负责人必须可访问该项目');
    if (!projectId && !['owner', 'admin'].includes(session.role) && assigneeUserId !== session.userId) return jsonError(ctx, 403, 'task_access_denied', '当前成员只能创建分配给自己的独立任务');
    const task = db.createTask({ organizationId: session.organizationId, projectId, userId: session.userId, title, description: validString(ctx.request.body?.description, 4000), stage: validString(ctx.request.body?.stage, 80) || '未分组', owner: assignee.displayName, assigneeUserId, progress: ctx.request.body?.progress, status: validString(ctx.request.body?.status, 30) || '待处理', priority, startAt: validString(ctx.request.body?.startAt, 40) || null, dueAt: validString(ctx.request.body?.dueAt, 40) || null });
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'task.create', entityType: 'task', entityId: task.id, metadata: { title: task.title, projectId } });
    ctx.status = 201; ctx.body = { task };
  });
  router.get('/tasks/:taskId/detail', requireAuth, ctx => {
    const session = ctx.state.session;
    const task = db.getTask(session.organizationId, ctx.params.taskId);
    if (!task) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    if (!authorize(ctx, 'task.read', { moduleKey: 'tasks', projectId: task.projectId || '' })) return;
    if (!task.projectId && !['owner', 'admin'].includes(session.role) && task.assigneeUserId !== session.userId) return jsonError(ctx, 403, 'task_access_denied', '当前成员未被分配此任务');
    ctx.body = { task, subtasks: db.listTaskSubtasks(session.organizationId, task.id), comments: db.listTaskComments(session.organizationId, task.id), activities: db.listAudit(session.organizationId).filter(event => event.entityId === task.id || event.metadata?.taskId === task.id) };
  });
  router.put('/tasks/:taskId', requireAuth, ctx => {
    const session = ctx.state.session;
    const current = db.getTask(session.organizationId, ctx.params.taskId);
    if (!current) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    if (!authorize(ctx, 'task.write', { moduleKey: 'tasks', projectId: current.projectId || '' })) return;
    if (!current.projectId && !['owner', 'admin'].includes(session.role) && current.assigneeUserId !== session.userId) return jsonError(ctx, 403, 'task_access_denied', '当前成员未被分配此任务');
    const body = ctx.request.body || {}; const progress = Number(body.progress); const status = validString(body.status, 30); const priority = validString(body.priority, 20); const hasStartAt = Object.hasOwn(body, 'startAt'); const hasDueAt = Object.hasOwn(body, 'dueAt'); const hasText = ['title', 'description', 'stage', 'assigneeUserId'].some(key => Object.hasOwn(body, key));
    if (!Number.isFinite(progress) && !status && !priority && !hasStartAt && !hasDueAt && !hasText) return jsonError(ctx, 400, 'invalid_task_update', '请提供任务内容、进度、状态、优先级或时间');
    if (status && !['进行中', '待处理', '已完成', '阻塞'].includes(status)) return jsonError(ctx, 400, 'invalid_task_status', '不支持的任务状态');
    if (priority && !['普通', '高', '紧急'].includes(priority)) return jsonError(ctx, 400, 'invalid_task_priority', '不支持的任务优先级');
    if (body.title !== undefined && !validString(body.title, 160)) return jsonError(ctx, 400, 'invalid_task', '任务名称不能为空');
    let owner; let assigneeUserId;
    if (body.assigneeUserId !== undefined) {
      assigneeUserId = validString(body.assigneeUserId, 100);
      const assignee = db.listMembers(session.organizationId).find(member => member.id === assigneeUserId);
      if (!assignee) return jsonError(ctx, 404, 'assignee_not_found', '负责人不存在或不属于当前企业');
      if (current.projectId && !canAccessProjectAsUser(session.organizationId, current.projectId, assigneeUserId)) return jsonError(ctx, 400, 'project_assignee_not_authorized', '项目任务负责人必须可访问该项目');
      if (!current.projectId && !['owner', 'admin'].includes(session.role) && assigneeUserId !== session.userId) return jsonError(ctx, 403, 'task_access_denied', '当前成员只能将独立任务分配给自己');
      owner = assignee.displayName;
    }
    const task = db.updateTask(session.organizationId, current.id, { title: body.title === undefined ? undefined : validString(body.title, 160), description: body.description === undefined ? undefined : validString(body.description, 4000), stage: body.stage === undefined ? undefined : validString(body.stage, 80) || '未分组', assigneeUserId, owner, progress: Number.isFinite(progress) ? progress : undefined, status: status || undefined, priority: priority || undefined, startAt: hasStartAt ? validString(body.startAt, 40) : undefined, dueAt: hasDueAt ? validString(body.dueAt, 40) : undefined });
    const changed = {};
    for (const key of ['title', 'description', 'stage', 'owner', 'assigneeUserId', 'progress', 'status', 'priority', 'startAt', 'dueAt']) {
      if (current[key] !== task[key]) changed[key] = { from: current[key] ?? '', to: task[key] ?? '' };
    }
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'task.update', entityType: 'task', entityId: task.id, metadata: { projectId: task.projectId, changed } });
    ctx.body = { task };
  });
  router.post('/tasks/:taskId/subtasks', requireAuth, ctx => {
    const session = ctx.state.session; const task = db.getTask(session.organizationId, ctx.params.taskId);
    if (!task) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    if (!authorize(ctx, 'task.write', { moduleKey: 'tasks', projectId: task.projectId || '' })) return;
    if (!requireStandaloneTaskAssignee(ctx, task)) return;
    const title = validString(ctx.request.body?.title, 160); if (!title) return jsonError(ctx, 400, 'invalid_subtask', '子任务名称不能为空');
    const subtask = db.createTaskSubtask({ organizationId: session.organizationId, taskId: task.id, userId: session.userId, title });
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'task.subtask.create', entityType: 'task_subtask', entityId: subtask.id, metadata: { taskId: task.id, projectId: task.projectId, title } });
    ctx.status = 201; ctx.body = { subtask };
  });
  router.put('/tasks/:taskId/subtasks/:subtaskId', requireAuth, ctx => {
    const session = ctx.state.session; const task = db.getTask(session.organizationId, ctx.params.taskId);
    if (!task) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    if (!authorize(ctx, 'task.write', { moduleKey: 'tasks', projectId: task.projectId || '' })) return;
    if (!requireStandaloneTaskAssignee(ctx, task)) return;
    const changes = {}; if (Object.hasOwn(ctx.request.body || {}, 'completed')) changes.completed = Boolean(ctx.request.body.completed); if (Object.hasOwn(ctx.request.body || {}, 'title')) { changes.title = validString(ctx.request.body.title, 160); if (!changes.title) return jsonError(ctx, 400, 'invalid_subtask', '子任务名称不能为空'); }
    const subtask = db.updateTaskSubtask(session.organizationId, task.id, ctx.params.subtaskId, changes);
    if (!subtask) return jsonError(ctx, 404, 'subtask_not_found', '子任务不存在');
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'task.subtask.update', entityType: 'task_subtask', entityId: subtask.id, metadata: { taskId: task.id, completed: subtask.completed } });
    ctx.body = { subtask };
  });
  router.post('/tasks/:taskId/comments', requireAuth, ctx => {
    const session = ctx.state.session; const task = db.getTask(session.organizationId, ctx.params.taskId);
    if (!task) return jsonError(ctx, 404, 'task_not_found', '任务不存在或无权访问');
    if (!authorize(ctx, 'task.write', { moduleKey: 'tasks', projectId: task.projectId || '' })) return;
    if (!requireStandaloneTaskAssignee(ctx, task)) return;
    const body = validString(ctx.request.body?.body, 4000); if (!body) return jsonError(ctx, 400, 'invalid_comment', '评论内容不能为空');
    const comment = db.createTaskComment({ organizationId: session.organizationId, taskId: task.id, userId: session.userId, body });
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'task.comment.create', entityType: 'task_comment', entityId: comment.id, metadata: { taskId: task.id, projectId: task.projectId } });
    ctx.status = 201; ctx.body = { comment };
  });
  router.post('/projects/:projectId/comments', requireAuth, ctx => {
    const session = ctx.state.session; const project = db.getProject(session.organizationId, ctx.params.projectId);
    if (!project) return jsonError(ctx, 404, 'project_not_found', '项目不存在或无权访问');
    if (!authorize(ctx, 'project.write', { moduleKey: 'projects', projectId: project.id })) return;
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
      ? modules.communication && roleCan(session.role, 'communication.read') && hasProjectAccess(session, conversation.projectId)
      : modules.chat && roleCan(session.role, 'chat.read'));
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
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'message.create', entityType: 'message', entityId: message.id, metadata: { conversationId: ctx.params.conversationId, projectId: conversation.projectId, attachmentCount: attachmentIds.length } });
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
    const title = validString(ctx.request.body?.title);
    if (!title) return jsonError(ctx, 400, 'invalid_project', '项目名称不能为空');
    const project = db.createProject({ organizationId: session.organizationId, userId: session.userId, title, stage: validString(ctx.request.body?.stage, 80) || '立项沟通', owner: validString(ctx.request.body?.owner, 80) || session.user.displayName, tag: validString(ctx.request.body?.tag, 80), progress: Number(ctx.request.body?.progress) || 0, step: validString(ctx.request.body?.step, 30) || '0/1' });
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'project.create', entityType: 'project', entityId: project.id, metadata: { title: project.title, stage: project.stage } });
    ctx.status = 201;
    ctx.body = { project };
  });
  router.put('/projects/:projectId', requireAuth, ctx => {
    const session = ctx.state.session;
    const projectId = ctx.params.projectId;
    if (!authorize(ctx, 'project.write', { moduleKey: 'projects', projectId })) return;
    const title = validString(ctx.request.body?.title, 160);
    const stage = validString(ctx.request.body?.stage, 80);
    const tag = validString(ctx.request.body?.tag, 80);
    const owner = validString(ctx.request.body?.owner, 80);
    const previousProject = db.getProject(session.organizationId, projectId);
    if (ctx.request.body?.title !== undefined && !title) return jsonError(ctx, 400, 'invalid_project', '项目名称不能为空');
    if (ctx.request.body?.stage !== undefined && !stage) return jsonError(ctx, 400, 'invalid_project_stage', '项目阶段不能为空');
    const project = db.updateProject(session.organizationId, projectId, { title: ctx.request.body?.title === undefined ? undefined : title, stage: ctx.request.body?.stage === undefined ? undefined : stage, tag: ctx.request.body?.tag === undefined ? undefined : tag, owner: ctx.request.body?.owner === undefined ? undefined : owner, progress: ctx.request.body?.progress, step: validString(ctx.request.body?.step, 30) || undefined, description: ctx.request.body?.description === undefined ? undefined : validString(ctx.request.body.description, 4000), priority: ctx.request.body?.priority === undefined ? undefined : validString(ctx.request.body.priority, 20), startAt: ctx.request.body?.startAt === undefined ? undefined : validString(ctx.request.body.startAt, 40), dueAt: ctx.request.body?.dueAt === undefined ? undefined : validString(ctx.request.body.dueAt, 40) });
    if (!project) return jsonError(ctx, 404, 'project_not_found', '项目不存在或无权访问');
    const changed = {};
    for (const key of ['title', 'stage', 'tag', 'owner', 'progress', 'step', 'description', 'priority', 'startAt', 'dueAt']) {
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
  router.get('/projects/:projectId/members', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!authorize(ctx, 'project.read', { moduleKey: 'projects', projectId: ctx.params.projectId })) return;
    ctx.body = { members: db.listProjectMembers(session.organizationId, ctx.params.projectId) };
  });
  router.post('/projects/:projectId/members', requireAuth, ctx => {
    const session = ctx.state.session;
    const projectId = ctx.params.projectId;
    if (!authorize(ctx, 'project.member.manage', { moduleKey: 'projects', projectId })) return;
    const userId = validString(ctx.request.body?.userId, 100);
    const projectRole = validString(ctx.request.body?.projectRole, 30) || 'member';
    if (!userId) return jsonError(ctx, 400, 'invalid_project_member', '请选择企业成员');
    if (!['owner', 'manager', 'member'].includes(projectRole)) return jsonError(ctx, 400, 'invalid_project_role', '不支持的项目角色');
    if (!db.getMembership(userId, session.organizationId)) return jsonError(ctx, 404, 'member_not_found', '成员不存在或不属于当前企业');
    const row = db.addProjectMember({ organizationId: session.organizationId, projectId, userId, projectRole, createdBy: session.userId });
    const member = { id: row.id, username: row.username, displayName: row.display_name, projectRole: row.project_role, createdAt: row.created_at };
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'project.member.add', entityType: 'project_member', entityId: `${projectId}:${userId}`, metadata: { projectId, userId, projectRole } });
    ctx.status = 201;
    ctx.body = { member };
  });
  router.get('/projects/:projectId/workspace', requireAuth, ctx => {
    const session = ctx.state.session;
    const project = authorize(ctx, 'project.read', { moduleKey: 'workspace', projectId: ctx.params.projectId });
    if (!project) return;
    const modules = db.listOrganizationModules(session.organizationId);
    const canRead = (permission, moduleKey) => modules[moduleKey] && roleCan(session.role, permission);
    ctx.body = {
      project,
      tasks: canRead('task.read', 'tasks') ? db.listProjectTasks(session.organizationId, project.id) : [],
      parts: canRead('part.read', 'parts') ? db.listParts(session.organizationId, project.id) : [],
      quotes: canRead('quote.read', 'bom') ? db.listQuotes(session.organizationId, project.id) : [],
      fairItems: canRead('fair.read', 'parts') ? db.listFairItems(session.organizationId, project.id) : [],
      documents: canRead('document.read', 'workspace') ? db.listOfficeDocuments(session.organizationId, session.userId, project.id) : [],
      conversations: canRead('communication.read', 'communication') ? db.listProjectConversations(session.organizationId, session.userId, project.id) : [],
      comments: canRead('project.read', 'projects') ? db.listProjectComments(session.organizationId, project.id) : [],
      activities: roleCan(session.role, 'audit.read') ? db.listProjectActivity(session.organizationId, project.id) : []
    };
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
    const session = ctx.state.session; const name = validString(ctx.request.body?.name, 160);
    const current = db.getPart(session.organizationId, ctx.params.partId);
    if (!current) return jsonError(ctx, 404, 'part_not_found', '零件不存在或无权访问');
    if (!authorize(ctx, 'part.write', { moduleKey: 'parts', projectId: current.projectId })) return;
    if (ctx.request.body?.name !== undefined && !name) return jsonError(ctx, 400, 'invalid_part', '零件名称不能为空');
    const part = db.updatePart(session.organizationId, ctx.params.partId, { name: ctx.request.body?.name === undefined ? undefined : name, format: validString(ctx.request.body?.format, 20) || undefined, material: validString(ctx.request.body?.material, 80) || undefined, finish: validString(ctx.request.body?.finish, 120) || undefined, dimensions: validString(ctx.request.body?.dimensions, 120) || undefined, volume: validString(ctx.request.body?.volume, 60) || undefined, quantity: ctx.request.body?.quantity });
    if (!part) return jsonError(ctx, 404, 'part_not_found', '零件不存在或无权访问');
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'part.update', entityType: 'part', entityId: part.id, metadata: { name: part.name, quantity: part.quantity } });
    ctx.body = { part };
  });

  router.get('/projects/:projectId/quotes', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!authorize(ctx, 'quote.read', { moduleKey: 'bom', projectId: ctx.params.projectId })) return;
    ctx.body = { quotes: db.listQuotes(session.organizationId, ctx.params.projectId) };
  });
  router.post('/projects/:projectId/quotes', requireAuth, ctx => {
    const session = ctx.state.session;
    const projectId = ctx.params.projectId;
    if (!authorize(ctx, 'quote.write', { moduleKey: 'bom', projectId })) return;
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
    if (!authorize(ctx, 'quote.read', { moduleKey: 'bom', projectId: ctx.params.projectId })) return;
    const quote = db.getQuote(session.organizationId, ctx.params.projectId, ctx.params.quoteId);
    if (!quote) return jsonError(ctx, 404, 'quote_not_found', '报价不存在或无权访问');
    ctx.body = { quote };
  });
  router.put('/projects/:projectId/quotes/:quoteId', requireAuth, ctx => {
    const session = ctx.state.session; const projectId = ctx.params.projectId;
    if (!authorize(ctx, 'quote.write', { moduleKey: 'bom', projectId })) return;
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
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'fair.update', entityType: 'fair_item', entityId: item.id, metadata: { projectId, status } });
    ctx.body = { item };
  });

  router.get('/members', requireAuth, ctx => {
    if (!authorize(ctx, 'member.read')) return;
    ctx.body = { members: db.listMembers(ctx.state.session.organizationId) };
  });
  router.post('/members', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!authorize(ctx, 'member.manage')) return;
    const username = validString(ctx.request.body?.username, 80).toLowerCase();
    const displayName = validString(ctx.request.body?.displayName, 120) || username;
    const password = String(ctx.request.body?.temporaryPassword || '');
    const role = validString(ctx.request.body?.role, 30) || 'viewer';
    if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(username)) return jsonError(ctx, 400, 'invalid_username', '账号需为 3-80 位小写字母、数字、点、下划线或连字符');
    if (password.length < 8) return jsonError(ctx, 400, 'invalid_password', '临时密码至少 8 位');
    if (!['admin', 'engineer', 'qa', 'viewer'].includes(role)) return jsonError(ctx, 400, 'invalid_role', '邀请成员不能直接创建 owner');
    try {
      const member = db.createMember({ organizationId: session.organizationId, username, displayName, password, role });
      db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'member.invite', entityType: 'membership', entityId: `${session.organizationId}:${member.id}`, metadata: { username, role } });
      ctx.status = 201;
      ctx.body = { member };
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) return jsonError(ctx, 409, 'username_exists', '账号已存在');
      throw error;
    }
  });
  router.put('/members/:userId/role', requireAuth, ctx => {
    const session = ctx.state.session;
    if (!authorize(ctx, 'member.manage')) return;
    const userId = ctx.params.userId;
    const role = validString(ctx.request.body?.role, 30);
    if (!['owner', 'admin', 'engineer', 'qa', 'viewer'].includes(role)) return jsonError(ctx, 400, 'invalid_role', '不支持的成员角色');
    const member = db.getMembership(userId, session.organizationId);
    if (!member) return jsonError(ctx, 404, 'member_not_found', '成员不存在');
    if (userId === session.userId && role !== 'owner') return jsonError(ctx, 400, 'self_role_change_denied', '不能降低当前登录账号的角色');
    if (member.role === 'owner' && role !== 'owner' && db.countOwners(session.organizationId) <= 1) return jsonError(ctx, 400, 'last_owner', '企业至少需要保留一位所有者');
    const updated = db.updateMemberRole(session.organizationId, userId, role);
    db.addAudit({ organizationId: session.organizationId, userId: session.userId, action: 'member.role.update', entityType: 'membership', entityId: `${session.organizationId}:${userId}`, metadata: { userId, role } });
    ctx.body = { member: { id: updated.id, username: updated.username, displayName: updated.display_name, role: updated.role, createdAt: updated.created_at } };
  });
  router.get('/audit', requireAuth, ctx => {
    if (!authorize(ctx, 'audit.read')) return;
    ctx.body = { events: db.listAudit(ctx.state.session.organizationId) };
  });
  router.get('/platform/audit', requireAuth, ctx => {
    if (!db.isPlatformAdmin(ctx.state.session.userId)) return jsonError(ctx, 403, 'forbidden', '需要平台管理员权限');
    ctx.body = { events: db.listPlatformAudit() };
  });

  app.use(router.routes());
  app.use(router.allowedMethods());
  if (staticDir) app.use(serve(staticDir));
  app.on('close', () => db.close());
  return app;
}

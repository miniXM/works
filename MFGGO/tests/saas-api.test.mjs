import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

let fixture;
let address;
let previousInitialAdminPassword;
let previousChatAttachmentStorage;

test.before(async () => {
  previousInitialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'admin123';
  fixture = { path: await mkdtemp(join(tmpdir(), 'machquote-saas-')) };
  process.env.ONLYOFFICE_STORAGE_DIR = join(fixture.path, 'office-documents');
  previousChatAttachmentStorage = process.env.CHAT_ATTACHMENT_STORAGE_DIR;
  process.env.CHAT_ATTACHMENT_STORAGE_DIR = join(fixture.path, 'chat-attachments');
  const app = await createApp({ dbPath: join(fixture.path, 'test.sqlite') });
  fixture.app = app;
  fixture.server = createServer(app.callback());
  await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
  const port = fixture.server.address().port;
  address = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise(resolve => fixture.server.close(resolve));
  fixture.app.close();
  await rm(fixture.path, { recursive: true, force: true });
  if (previousInitialAdminPassword === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
  else process.env.INITIAL_ADMIN_PASSWORD = previousInitialAdminPassword;
  if (previousChatAttachmentStorage === undefined) delete process.env.CHAT_ATTACHMENT_STORAGE_DIR;
  else process.env.CHAT_ATTACHMENT_STORAGE_DIR = previousChatAttachmentStorage;
});

async function request(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(`${address}${path}`, { ...rest, headers: { 'content-type': 'application/json', ...headers } });
  const body = await response.json();
  return { response, body };
}

test('logs in the seeded admin and returns organization context', async () => {
  const { response, body } = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  assert.equal(response.status, 200);
  assert.ok(body.token);
  assert.equal(body.user.username, 'admin');
  assert.equal(body.organization.slug, 'mfggo-demo');
});

test('scopes project reads and writes to the logged-in organization', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const list = await request('/api/projects', { headers });
  assert.equal(list.response.status, 200);
  assert.ok(Array.isArray(list.body.projects));
  assert.ok(list.body.projects.every(project => project.organizationId === login.body.organization.id));

  const created = await request('/api/projects', { method: 'POST', headers, body: JSON.stringify({ title: 'SaaS 验收项目', owner: 'admin', stage: '立项沟通' }) });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.project.title, 'SaaS 验收项目');

  const detail = await request(`/api/projects/${created.body.project.id}`, { headers });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.project.title, 'SaaS 验收项目');
});

test('records tenant-scoped audit events for business actions', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  await request('/api/projects', { method: 'POST', headers, body: JSON.stringify({ title: '审计记录项目', stage: '询盘发布' }) });
  const audit = await request('/api/audit', { headers });
  assert.equal(audit.response.status, 200);
  assert.ok(audit.body.events.some(event => event.action === 'project.create'));
  assert.ok(audit.body.events.every(event => event.organizationId === login.body.organization.id));
});

test('lists organization parts and persists a part under its selected project', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const projects = await request('/api/projects', { headers });
  let projectId = projects.body.projects[0]?.id;
  if (!projectId) {
    const project = await request('/api/projects', { method: 'POST', headers, body: JSON.stringify({ title: '零件验收项目', stage: '立项沟通' }) });
    projectId = project.body.project.id;
  }
  const before = await request('/api/parts', { headers });
  assert.equal(before.response.status, 200);
  assert.ok(Array.isArray(before.body.parts));

  const created = await request(`/api/projects/${projectId}/parts`, { method: 'POST', headers, body: JSON.stringify({ name: 'SaaS 测试零件', format: 'STEP', material: 'Aluminum 6061', quantity: 3 }) });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.part.projectId, projectId);

  const detail = await request(`/api/projects/${projectId}/parts`, { headers });
  assert.ok(detail.body.parts.some(part => part.name === 'SaaS 测试零件'));
});

test('returns tenant membership roles to an authenticated user', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const members = await request('/api/members', { headers: { authorization: `Bearer ${login.body.token}` } });
  assert.equal(members.response.status, 200);
  assert.ok(members.body.members.some(member => member.username === 'admin' && member.role === 'owner'));
});

test('updates member roles while protecting the last owner', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const members = await request('/api/members', { headers });
  const admin = members.body.members.find(member => member.username === 'admin');
  const denied = await request(`/api/members/${admin.id}/role`, { method: 'PUT', headers, body: JSON.stringify({ role: 'viewer' }) });
  assert.equal(denied.response.status, 400);
  assert.equal(denied.body.error, 'self_role_change_denied');
  const invalid = await request(`/api/members/${admin.id}/role`, { method: 'PUT', headers, body: JSON.stringify({ role: 'nope' }) });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error, 'invalid_role');
});

test('invites a tenant member with a non-owner role', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const created = await request('/api/members', { method: 'POST', headers, body: JSON.stringify({ username: 'qa_invited', displayName: '测试质检员', temporaryPassword: 'qa-pass-123', role: 'qa' }) });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.member.role, 'qa');
  const members = await request('/api/members', { headers });
  assert.ok(members.body.members.some(member => member.username === 'qa_invited' && member.role === 'qa'));
  const duplicate = await request('/api/members', { method: 'POST', headers, body: JSON.stringify({ username: 'qa_invited', displayName: '重复', temporaryPassword: 'qa-pass-123', role: 'viewer' }) });
  assert.equal(duplicate.response.status, 409);
});

test('lists and creates tasks inside the current organization', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const before = await request('/api/tasks', { headers });
  assert.equal(before.response.status, 200);
  assert.equal(before.body.tasks.length, 0);
  const projects = await request('/api/projects', { headers });
  const created = await request('/api/tasks', { method: 'POST', headers, body: JSON.stringify({ title: '确认任务 API', projectId: projects.body.projects[0].id }) });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.task.organizationId, login.body.organization.id);
  assert.equal(created.body.task.stage, '未分组');
  assert.equal(created.body.task.status, '待处理');
  const after = await request('/api/tasks', { headers });
  assert.ok(after.body.tasks.some(task => task.title === '确认任务 API'));
});

test('exposes platform audit only to platform admins', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const audit = await request('/api/platform/audit', { headers });
  assert.equal(audit.response.status, 200);
  assert.ok(Array.isArray(audit.body.events));
  assert.ok(audit.body.events.some(event => event.action === 'task.create' || event.action === 'project.create'));
});

test('exposes a true cross-organization platform user directory', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const response = await request('/api/platform/users', { headers });
  assert.equal(response.response.status, 200);
  assert.ok(Array.isArray(response.body.users));
  assert.ok(response.body.users.some(user => user.username === 'admin'));
  assert.ok(response.body.users.every(user => Array.isArray(user.organizations) && Array.isArray(user.roles)));
});

test('creates tenant conversations and sends isolated messages', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const project = (await request('/api/projects', { method: 'POST', headers, body: JSON.stringify({ title: '项目沟通验收', stage: '立项沟通' }) })).body.project;
  const created = await request('/api/conversations', { method: 'POST', headers, body: JSON.stringify({ title: '报价协作群', projectId: project.id }) });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.conversation.projectId, project.id);
  assert.equal(created.body.conversation.projectTitle, project.title);
  const sent = await request(`/api/conversations/${created.body.conversation.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ body: '请确认交期' }) });
  assert.equal(sent.response.status, 201);
  assert.equal(sent.body.message.displayName, login.body.user.displayName);
  const messages = await request(`/api/conversations/${created.body.conversation.id}/messages`, { headers });
  assert.equal(messages.body.messages[0].body, '请确认交期');
  const projectConversations = await request(`/api/conversations?projectId=${encodeURIComponent(project.id)}`, { headers });
  const summary = projectConversations.body.conversations.find(item => item.id === created.body.conversation.id);
  assert.equal(summary.preview, '请确认交期');
  assert.equal(summary.lastSender, login.body.user.displayName);
  assert.equal(summary.messageCount, 1);
  assert.ok(summary.lastMessageAt);
  assert.ok(projectConversations.body.conversations.every(item => item.projectId === project.id));
});

test('persists unread, mentions, later state and tenant-scoped chat attachments', async () => {
  const adminLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const adminHeaders = { authorization: `Bearer ${adminLogin.body.token}` };
  const memberName = `chat_worker_${Date.now()}`;
  const memberCreated = await request('/api/members', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ username: memberName, displayName: '聊天协作员', temporaryPassword: 'chat-pass-123', role: 'engineer' }) });
  assert.equal(memberCreated.response.status, 201);
  const memberLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: memberName, password: 'chat-pass-123' }) });
  const memberHeaders = { authorization: `Bearer ${memberLogin.body.token}` };

  const conversation = await request('/api/conversations', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ title: '生产交期协作' }) });
  assert.equal(conversation.response.status, 201);
  const conversationId = conversation.body.conversation.id;
  const attachment = await request('/api/chat-attachments', {
    method: 'POST',
    headers: { ...memberHeaders, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('fixture.step') },
    body: Buffer.from('ISO-10303-21; CHAT ATTACHMENT; END-ISO-10303-21;')
  });
  assert.equal(attachment.response.status, 201);
  assert.equal(attachment.body.attachment.name, 'fixture.step');

  const sent = await request(`/api/conversations/${conversationId}/messages`, { method: 'POST', headers: memberHeaders, body: JSON.stringify({ body: '@admin 请确认加工图纸', attachmentIds: [attachment.body.attachment.id] }) });
  assert.equal(sent.response.status, 201);
  assert.equal(sent.body.message.attachments.length, 1);
  assert.equal(sent.body.message.attachments[0].messageId, sent.body.message.id);

  const unreadList = await request('/api/conversations', { headers: adminHeaders });
  const unreadSummary = unreadList.body.conversations.find(item => item.id === conversationId);
  assert.equal(unreadSummary.unreadCount, 1);
  assert.equal(unreadSummary.mentionCount, 1);
  assert.equal(unreadSummary.savedForLater, false);

  // A passive history prefetch must not clear unread state.  The active
  // thread request opts into the server-side update explicitly.
  const prefetchedMessages = await request(`/api/conversations/${conversationId}/messages`, { headers: adminHeaders });
  assert.equal(prefetchedMessages.body.messages[0].attachments[0].name, 'fixture.step');
  const stillUnread = await request('/api/conversations', { headers: adminHeaders });
  assert.equal(stillUnread.body.conversations.find(item => item.id === conversationId).unreadCount, 1);
  const messages = await request(`/api/conversations/${conversationId}/messages?markRead=true`, { headers: adminHeaders });
  assert.equal(messages.body.messages[0].attachments[0].name, 'fixture.step');
  const readByOpening = await request('/api/conversations', { headers: adminHeaders });
  const readSummary = readByOpening.body.conversations.find(item => item.id === conversationId);
  assert.equal(readSummary.unreadCount, 0);
  assert.equal(readSummary.mentionCount, 0);

  const saved = await request(`/api/conversations/${conversationId}/state`, { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ savedForLater: true }) });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.state.savedForLater, true);
  const markedRead = await request(`/api/conversations/${conversationId}/state`, { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ read: true }) });
  assert.equal(markedRead.response.status, 200);
  const persistedList = await request('/api/conversations', { headers: adminHeaders });
  const persistedSummary = persistedList.body.conversations.find(item => item.id === conversationId);
  assert.equal(persistedSummary.unreadCount, 0);
  assert.equal(persistedSummary.mentionCount, 0);
  assert.equal(persistedSummary.savedForLater, true);

  const download = await fetch(`${address}/api/chat-attachments/${attachment.body.attachment.id}/download`, { headers: adminHeaders });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition') || '', /fixture\.step/);
  assert.match(await download.text(), /CHAT ATTACHMENT/);

  const otherOrganization = await request('/api/platform/organizations', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ name: '聊天隔离企业', slug: `chat-isolation-${Date.now()}` }) });
  assert.equal(otherOrganization.response.status, 201);
  const switched = await request(`/api/platform/organizations/${otherOrganization.body.organization.id}/switch`, { method: 'POST', headers: adminHeaders });
  assert.equal(switched.response.status, 200);
  const isolatedDownload = await request(`/api/chat-attachments/${attachment.body.attachment.id}/download`, { headers: { authorization: `Bearer ${switched.body.token}` } });
  assert.equal(isolatedDownload.response.status, 404);

  const removed = await request(`/api/conversations/${conversationId}/state`, { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ savedForLater: false }) });
  assert.equal(removed.body.state.savedForLater, false);
  const finalList = await request('/api/conversations', { headers: adminHeaders });
  assert.equal(finalList.body.conversations.find(item => item.id === conversationId).savedForLater, false);
});

test('allows project-conversation attachments when enterprise chat is disabled and handles a missing stored file', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const project = (await request('/api/projects', { method: 'POST', headers, body: JSON.stringify({ title: `项目附件授权-${suffix}`, stage: '立项沟通' }) })).body.project;
  const conversation = (await request('/api/conversations', { method: 'POST', headers, body: JSON.stringify({ projectId: project.id, title: '项目文件确认' }) })).body.conversation;
  const otherConversation = (await request('/api/conversations', { method: 'POST', headers, body: JSON.stringify({ projectId: project.id, title: '项目文件复核' }) })).body.conversation;
  const beforeModules = (await request('/api/me', { headers })).body.modules;

  try {
    const modulesResult = await request(`/api/platform/organizations/${login.body.organization.id}/modules`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ modules: { ...beforeModules, communication: true, chat: false } })
    });
    assert.equal(modulesResult.response.status, 200);

    const attachment = await request('/api/chat-attachments', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('project-fixture.step'), 'x-conversation-id': conversation.id },
      body: Buffer.from('ISO-10303-21; PROJECT CHAT ATTACHMENT; END-ISO-10303-21;')
    });
    assert.equal(attachment.response.status, 201);
    assert.equal(attachment.body.attachment.pendingConversationId, conversation.id);

    const wrongConversation = await request(`/api/conversations/${otherConversation.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body: '不应跨会话挂载附件', attachmentIds: [attachment.body.attachment.id] })
    });
    assert.equal(wrongConversation.response.status, 400);
    assert.equal(wrongConversation.body.error, 'attachment_unavailable');

    const sent = await request(`/api/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body: '请确认附件中的项目图纸', attachmentIds: [attachment.body.attachment.id] })
    });
    assert.equal(sent.response.status, 201);

    const download = await fetch(`${address}/api/chat-attachments/${attachment.body.attachment.id}/download`, { headers });
    assert.equal(download.status, 200);
    assert.match(await download.text(), /PROJECT CHAT ATTACHMENT/);

    const pendingAttachment = await request('/api/chat-attachments', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('remove-project-fixture.step'), 'x-conversation-id': conversation.id },
      body: Buffer.from('remove me')
    });
    assert.equal(pendingAttachment.response.status, 201);
    const removedPending = await request(`/api/chat-attachments/${pendingAttachment.body.attachment.id}`, { method: 'DELETE', headers });
    assert.equal(removedPending.response.status, 200);

    const storage = fixture.app.context.db.getChatAttachmentStorage(login.body.organization.id, attachment.body.attachment.id);
    assert.ok(storage?.storage_key);
    await unlink(join(process.env.CHAT_ATTACHMENT_STORAGE_DIR, storage.storage_key));
    const missing = await request(`/api/chat-attachments/${attachment.body.attachment.id}/download`, { headers });
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.error, 'chat_attachment_file_missing');
  } finally {
    await request(`/api/platform/organizations/${login.body.organization.id}/modules`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ modules: beforeModules })
    });
  }
});

test('returns organization-scoped live statistics', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const [stats, projects, parts] = await Promise.all([
    request('/api/stats', { headers }),
    request('/api/projects', { headers }),
    request('/api/parts', { headers })
  ]);
  assert.equal(stats.response.status, 200);
  assert.equal(stats.body.stats.projects, projects.body.projects.length);
  assert.equal(stats.body.stats.parts, parts.body.parts.length);
  assert.ok(Number.isFinite(stats.body.stats.completionRate));
});

test('updates a project within the current organization', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const projects = await request('/api/projects', { headers });
  const project = projects.body.projects[0];
  const updated = await request(`/api/projects/${project.id}`, { method: 'PUT', headers, body: JSON.stringify({ title: '项目更新验收', stage: '内部报价', tag: 'QA', progress: 55, owner: 'admin', description: '完整项目详情', priority: '高', startAt: '2026-08-26', dueAt: '2026-09-01' }) });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.project.title, '项目更新验收');
  assert.equal(updated.body.project.progress, 55);
  assert.equal(updated.body.project.description, '完整项目详情');
  assert.equal(updated.body.project.priority, '高');
  assert.equal(updated.body.project.startAt, '2026-08-26');
  assert.equal(updated.body.project.dueAt, '2026-09-01');
  const comment = await request(`/api/projects/${project.id}/comments`, { method: 'POST', headers, body: JSON.stringify({ body: '项目评论闭环' }) });
  assert.equal(comment.response.status, 201);
  const detail = await request(`/api/projects/${project.id}`, { headers });
  assert.equal(detail.body.project.stage, '内部报价');
  const workspace = await request(`/api/projects/${project.id}/workspace`, { headers });
  assert.ok(workspace.body.comments.some(item => item.body === '项目评论闭环'));
});

test('updates a part within the current organization', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const projects = await request('/api/projects', { headers });
  let projectId = projects.body.projects[0]?.id;
  if (!projectId) {
    const project = await request('/api/projects', { method: 'POST', headers, body: JSON.stringify({ title: '零件更新项目', stage: '立项沟通' }) });
    projectId = project.body.project.id;
  }
  const created = await request(`/api/projects/${projectId}/parts`, { method: 'POST', headers, body: JSON.stringify({ name: '待更新零件', format: 'STEP', quantity: 1 }) });
  const part = created.body.part;
  const updated = await request(`/api/parts/${part.id}`, { method: 'PUT', headers, body: JSON.stringify({ material: 'Titanium Grade 5', quantity: 7 }) });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.part.material, 'Titanium Grade 5');
  assert.equal(updated.body.part.quantity, 7);
});

test('updates task progress and status within the current organization', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const created = await request('/api/tasks', { method: 'POST', headers, body: JSON.stringify({ title: '可更新任务', stage: '询盘发布' }) });
  const updated = await request(`/api/tasks/${created.body.task.id}`, { method: 'PUT', headers, body: JSON.stringify({ progress: 100, status: '已完成' }) });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.task.progress, 100);
  assert.equal(updated.body.task.status, '已完成');
});

test('loads a task detail and persists properties, subtasks and comments', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const projectId = (await request('/api/projects', { headers })).body.projects[0].id;
  const created = await request('/api/tasks', { method: 'POST', headers, body: JSON.stringify({ title: '任务详情验收', projectId, description: '初始说明', startAt: '2026-08-25', dueAt: '2026-08-30' }) });
  const taskId = created.body.task.id;
  assert.equal(created.body.task.startAt, '2026-08-25');

  const updated = await request(`/api/tasks/${taskId}`, { method: 'PUT', headers, body: JSON.stringify({ description: '更新后的说明', stage: '客户沟通', priority: '高' }) });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.task.description, '更新后的说明');

  const subtask = await request(`/api/tasks/${taskId}/subtasks`, { method: 'POST', headers, body: JSON.stringify({ title: '确认验收标准' }) });
  assert.equal(subtask.response.status, 201);
  const completed = await request(`/api/tasks/${taskId}/subtasks/${subtask.body.subtask.id}`, { method: 'PUT', headers, body: JSON.stringify({ completed: true }) });
  assert.equal(completed.body.subtask.completed, true);

  const comment = await request(`/api/tasks/${taskId}/comments`, { method: 'POST', headers, body: JSON.stringify({ body: '已同步项目成员' }) });
  assert.equal(comment.response.status, 201);
  const detail = await request(`/api/tasks/${taskId}/detail`, { headers });
  assert.equal(detail.response.status, 200);
  assert.ok(detail.body.subtasks.some(item => item.title === '确认验收标准' && item.completed));
  assert.ok(detail.body.comments.some(item => item.body === '已同步项目成员'));
  assert.ok(detail.body.activities.some(item => item.metadata?.taskId === taskId));
});

test('platform owner configures modules per organization without affecting another tenant', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const organizations = await request('/api/platform/organizations', { headers });
  assert.equal(organizations.response.status, 200);
  const current = organizations.body.organizations.find(item => item.id === login.body.organization.id);
  assert.equal(current.modules.workspace, true);
  const updated = await request(`/api/platform/organizations/${current.id}/modules`, { method: 'PUT', headers, body: JSON.stringify({ modules: { projects: true, workspace: false, parts: false, communication: true, chat: false, tasks: true, stats: false } }) });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.organization.modules.workspace, false);
  const me = await request('/api/me', { headers });
  assert.equal(me.body.modules.workspace, false);
  assert.equal(me.body.modules.projects, true);
  // Restore the seeded tenant modules so later API tests exercise their
  // intended capabilities rather than inheriting this test's feature toggles.
  const restored = await request(`/api/platform/organizations/${current.id}/modules`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      modules: {
        projects: true, workspace: true, bom: true, parts: true,
        communication: true, chat: true, tasks: true, stats: true
      }
    })
  });
  assert.equal(restored.response.status, 200);
});

test('platform admin creates and switches into an organization-scoped session', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  assert.equal(login.body.platformAdmin, true);
  const headers = { authorization: `Bearer ${login.body.token}` };
  const created = await request('/api/platform/organizations', { method: 'POST', headers, body: JSON.stringify({ name: '切换测试企业', slug: 'switch-test-org' }) });
  assert.equal(created.response.status, 201);
  const switched = await request(`/api/platform/organizations/${created.body.organization.id}/switch`, { method: 'POST', headers });
  assert.equal(switched.response.status, 200);
  assert.equal(switched.body.organization.slug, 'switch-test-org');
  const targetHeaders = { authorization: `Bearer ${switched.body.token}` };
  const projects = await request('/api/projects', { headers: targetHeaders });
  assert.equal(projects.body.organization.id, created.body.organization.id);
  assert.equal(projects.body.projects.length, 0);
  assert.equal(projects.body.modules.projects, true);
});

test('rejects malformed document upload names without a server error', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}`, 'content-type': 'application/octet-stream', 'x-file-name': '%E0%A4%A' };
  const response = await request('/api/documents/upload', { method: 'POST', headers, body: Buffer.from('fixture') });
  assert.equal(response.response.status, 400);
  assert.equal(response.body.error, 'invalid_document_name');
});

test('creates and reads a project quotation draft with BOM lines', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const projectId = (await request('/api/projects', { headers })).body.projects[0].id;
  const created = await request(`/api/projects/${projectId}/quotes`, { method: 'POST', headers, body: JSON.stringify({ quoteNo: 'QT-SaaS-001', currency: 'CNY', lines: [{ name: 'Fibula Plate', quantity: 2, unitPriceCents: 12500, material: 'Aluminum 6061', process: 'CNC' }] }) });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.quote.quoteNo, 'QT-SaaS-001');
  assert.equal(created.body.quote.totalCents, 25000);
  const detail = await request(`/api/projects/${projectId}/quotes/${created.body.quote.id}`, { headers });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.quote.lines[0].quantity, 2);
  const updated = await request(`/api/projects/${projectId}/quotes/${created.body.quote.id}`, { method: 'PUT', headers, body: JSON.stringify({ quoteNo: 'QT-SaaS-001-REV2', currency: 'CNY', lines: [{ name: 'Fibula Plate', quantity: 3, unitPriceCents: 10000, material: 'Aluminum 6061', process: 'CNC' }] }) });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.quote.quoteNo, 'QT-SaaS-001-REV2');
  assert.equal(updated.body.quote.totalCents, 30000);
});

test('creates and reads FAIR inspection characteristics under a project', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const projectId = (await request('/api/projects', { headers })).body.projects[0].id;
  const created = await request(`/api/projects/${projectId}/fair-items`, { method: 'POST', headers, body: JSON.stringify({ characteristic: '孔径', nominal: 'Ø19', tolerance: '±0.2', status: 'pending' }) });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.item.characteristic, '孔径');
  const list = await request(`/api/projects/${projectId}/fair-items`, { headers });
  assert.ok(list.body.items.some(item => item.characteristic === '孔径'));
  const item = list.body.items.find(item => item.characteristic === '孔径');
  const updated = await request(`/api/projects/${projectId}/fair-items/${item.id}`, { method: 'PUT', headers, body: JSON.stringify({ status: 'pass' }) });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.item.status, 'pass');
});

test('loads a project workspace with project-scoped tasks, documents, business data and activity', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const createdProject = await request('/api/projects', { method: 'POST', headers, body: JSON.stringify({ title: '项目工作台验收', stage: '内部报价', tag: 'QT-WORKSPACE-001' }) });
  const projectId = createdProject.body.project.id;
  const task = await request('/api/tasks', { method: 'POST', headers, body: JSON.stringify({ title: '确认项目图纸版本', projectId, stage: '内部报价', priority: '紧急', dueAt: '2026-08-30', status: '待处理' }) });
  assert.equal(task.response.status, 201);
  assert.equal(task.body.task.priority, '紧急');
  assert.equal(task.body.task.dueAt, '2026-08-30');
  const document = await request('/api/documents', { method: 'POST', headers, body: JSON.stringify({ projectId, fileType: 'xlsx', title: '项目成本核算.xlsx' }) });
  assert.equal(document.response.status, 201);
  assert.equal(document.body.document.projectId, projectId);
  const conversation = await request('/api/conversations', { method: 'POST', headers, body: JSON.stringify({ projectId, title: '项目图纸确认' }) });
  const message = await request(`/api/conversations/${conversation.body.conversation.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ body: '请在今天下班前确认图纸版本' }) });
  assert.equal(message.response.status, 201);

  const workspace = await request(`/api/projects/${projectId}/workspace`, { headers });
  assert.equal(workspace.response.status, 200);
  assert.equal(workspace.body.project.id, projectId);
  assert.ok(workspace.body.tasks.some(item => item.id === task.body.task.id));
  assert.ok(workspace.body.documents.some(item => item.id === document.body.document.id));
  assert.ok(Array.isArray(workspace.body.parts));
  assert.ok(Array.isArray(workspace.body.quotes));
  assert.ok(Array.isArray(workspace.body.fairItems));
  assert.ok(workspace.body.conversations.some(item => item.id === conversation.body.conversation.id && item.preview === '请在今天下班前确认图纸版本'));
  assert.ok(workspace.body.activities.some(item => item.action === 'task.create'));
  assert.ok(workspace.body.activities.some(item => item.action === 'document.create'));
  assert.ok(workspace.body.activities.some(item => item.action === 'message.create'));
});

test('enforces role, module, and project scope across business APIs', async () => {
  const ownerLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const ownerHeaders = { authorization: `Bearer ${ownerLogin.body.token}` };
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const project = (await request('/api/projects', { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ title: `权限收口项目-${suffix}`, stage: '内部报价' }) })).body.project;
  const invited = await Promise.all([
    request('/api/members', { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ username: `authz_engineer_${suffix}`, displayName: '权限报价工程师', temporaryPassword: 'engineer-pass-123', role: 'engineer' }) }),
    request('/api/members', { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ username: `authz_qa_${suffix}`, displayName: '权限质检员', temporaryPassword: 'qa-pass-123', role: 'qa' }) }),
    request('/api/members', { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ username: `authz_viewer_${suffix}`, displayName: '权限访客', temporaryPassword: 'viewer-pass-123', role: 'viewer' }) })
  ]);
  for (const response of invited) assert.equal(response.response.status, 201);
  const [engineerLogin, qaLogin, viewerLogin] = await Promise.all([
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: `authz_engineer_${suffix}`, password: 'engineer-pass-123' }) }),
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: `authz_qa_${suffix}`, password: 'qa-pass-123' }) }),
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: `authz_viewer_${suffix}`, password: 'viewer-pass-123' }) })
  ]);
  const engineerHeaders = { authorization: `Bearer ${engineerLogin.body.token}` };
  const qaHeaders = { authorization: `Bearer ${qaLogin.body.token}` };
  const viewerHeaders = { authorization: `Bearer ${viewerLogin.body.token}` };
  const conversation = await request('/api/conversations', { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ projectId: project.id, title: '权限收口沟通' }) });
  assert.equal(conversation.response.status, 201);

  const deniedProject = await request(`/api/projects/${project.id}`, { headers: engineerHeaders });
  assert.equal(deniedProject.response.status, 403);
  assert.equal(deniedProject.body.error, 'project_access_denied');
  const deniedDocument = await request('/api/documents', { method: 'POST', headers: engineerHeaders, body: JSON.stringify({ projectId: project.id, fileType: 'xlsx', title: '越权文档.xlsx' }) });
  assert.equal(deniedDocument.response.status, 403);
  assert.equal(deniedDocument.body.error, 'project_access_denied');
  const deniedMessages = await request(`/api/conversations/${conversation.body.conversation.id}/messages`, { headers: engineerHeaders });
  assert.equal(deniedMessages.response.status, 403);
  assert.equal(deniedMessages.body.error, 'project_access_denied');

  const engineerMember = await request(`/api/projects/${project.id}/members`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ userId: invited[0].body.member.id, projectRole: 'member' }) });
  assert.equal(engineerMember.response.status, 201);
  const members = await request(`/api/projects/${project.id}/members`, { headers: engineerHeaders });
  assert.ok(members.body.members.some(member => member.id === invited[0].body.member.id));
  const readableMessages = await request(`/api/conversations/${conversation.body.conversation.id}/messages`, { headers: engineerHeaders });
  assert.equal(readableMessages.response.status, 200);
  const quote = await request(`/api/projects/${project.id}/quotes`, { method: 'POST', headers: engineerHeaders, body: JSON.stringify({ quoteNo: `QT-AUTHZ-${suffix}`, currency: 'CNY', lines: [{ name: '授权测试件', quantity: 1, unitPriceCents: 10000, material: 'Aluminum 6061', process: 'CNC' }] }) });
  assert.equal(quote.response.status, 201);
  const deniedFair = await request(`/api/projects/${project.id}/fair-items`, { method: 'POST', headers: engineerHeaders, body: JSON.stringify({ characteristic: '孔径', nominal: '10', tolerance: '±0.1' }) });
  assert.equal(deniedFair.response.status, 403);
  assert.equal(deniedFair.body.error, 'permission_denied');

  const qaMember = await request(`/api/projects/${project.id}/members`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ userId: invited[1].body.member.id, projectRole: 'member' }) });
  assert.equal(qaMember.response.status, 201);
  const fair = await request(`/api/projects/${project.id}/fair-items`, { method: 'POST', headers: qaHeaders, body: JSON.stringify({ characteristic: '孔径', nominal: '10', tolerance: '±0.1' }) });
  assert.equal(fair.response.status, 201);
  const qaWorkspace = await request(`/api/projects/${project.id}/workspace`, { headers: qaHeaders });
  assert.equal(qaWorkspace.response.status, 200);
  assert.deepEqual(qaWorkspace.body.quotes, []);

  const viewerMember = await request(`/api/projects/${project.id}/members`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ userId: invited[2].body.member.id, projectRole: 'member' }) });
  assert.equal(viewerMember.response.status, 201);
  const viewerProject = await request(`/api/projects/${project.id}`, { headers: viewerHeaders });
  assert.equal(viewerProject.response.status, 200);
  const deniedPart = await request(`/api/projects/${project.id}/parts`, { method: 'POST', headers: viewerHeaders, body: JSON.stringify({ name: '访客不应创建的零件' }) });
  assert.equal(deniedPart.response.status, 403);
  assert.equal(deniedPart.body.error, 'permission_denied');
  const deniedAudit = await request('/api/audit', { headers: viewerHeaders });
  assert.equal(deniedAudit.response.status, 403);
  assert.equal(deniedAudit.body.error, 'permission_denied');

  const beforeModules = (await request('/api/me', { headers: ownerHeaders })).body.modules;
  try {
    const disabled = await request(`/api/platform/organizations/${ownerLogin.body.organization.id}/modules`, { method: 'PUT', headers: ownerHeaders, body: JSON.stringify({ modules: { ...beforeModules, bom: false } }) });
    assert.equal(disabled.response.status, 200);
    const deniedQuote = await request(`/api/projects/${project.id}/quotes`, { method: 'POST', headers: engineerHeaders, body: JSON.stringify({ quoteNo: `QT-AUTHZ-DISABLED-${suffix}`, lines: [{ name: '模块关闭测试件', quantity: 1, unitPriceCents: 100 }] }) });
    assert.equal(deniedQuote.response.status, 403);
    assert.equal(deniedQuote.body.error, 'module_disabled');
  } finally {
    await request(`/api/platform/organizations/${ownerLogin.body.organization.id}/modules`, { method: 'PUT', headers: ownerHeaders, body: JSON.stringify({ modules: beforeModules }) });
  }
});

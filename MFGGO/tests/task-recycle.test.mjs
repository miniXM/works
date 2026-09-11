import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { createDatabase } from '../server/db.js';

let app, db, server, directory, address, owner, sql, previousPassword, previousOfficeRoot;
let sequence = 0;
async function request(path, actor = owner, method = 'GET', data) {
  const response = await fetch(`${address}/api${path}`, {
    method, headers: { 'content-type': 'application/json', ...(actor?.token ? { authorization: `Bearer ${actor.token}` } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });
  return { status: response.status, body: await response.json() };
}
async function member(role = 'member') {
  const username = `recycle_worker_${++sequence}`;
  const created = await request('/members', owner, 'POST', { username, displayName: username, temporaryPassword: 'recycle-worker-123', role });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return (await request('/auth/login', null, 'POST', { username, password: 'recycle-worker-123' })).body;
}
async function grant(actor, permissions) {
  const response = await request(`/organization/members/${actor.user.id}`, owner, 'PUT', { permissions });
  assert.equal(response.status, 200, JSON.stringify(response.body));
}
function project(title = `Recycle project ${++sequence}`) {
  return db.createProject({ organizationId: owner.organization.id, userId: owner.user.id, title, stage: '立项沟通' });
}
function addParticipant(target, actor) {
  return db.addProjectMember({ organizationId: owner.organization.id, projectId: target.id, userId: actor.user.id, createdBy: owner.user.id });
}
const rootPath = target => `/tasks/${target.rootTaskId}`;

test.before(async () => {
  previousPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'recycle-owner-123';
  directory = await mkdtemp(join(tmpdir(), 'mfggo-recycle-'));
  previousOfficeRoot = process.env.ONLYOFFICE_STORAGE_DIR;
  process.env.ONLYOFFICE_STORAGE_DIR = join(directory, 'office');
  await mkdir(process.env.ONLYOFFICE_STORAGE_DIR);
  app = await createApp({ dbPath: join(directory, 'test.sqlite') });
  db = app.context.db;
  sql = new DatabaseSync(join(directory, 'test.sqlite'));
  server = createServer(app.callback());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${server.address().port}`;
  owner = (await request('/auth/login', null, 'POST', { username: 'admin', password: 'recycle-owner-123' })).body;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  sql.close(); app.close();
  await rm(directory, { recursive: true, force: true });
  if (previousPassword === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
  else process.env.INITIAL_ADMIN_PASSWORD = previousPassword;
  if (previousOfficeRoot === undefined) delete process.env.ONLYOFFICE_STORAGE_DIR;
  else process.env.ONLYOFFICE_STORAGE_DIR = previousOfficeRoot;
});

test('project recycling is a distinct grant and respects scope without requiring the executor', async () => {
  const authorized = await member();
  const outsider = await member();
  const deputy = await member('admin');
  const target = project();
  addParticipant(target, authorized);
  await grant(authorized, { 'task.delete': true });
  assert.equal((await request(`/projects/${target.id}/recycle`, authorized, 'POST')).status, 403);
  assert.equal((await request(`/projects/${target.id}/recycle`, deputy, 'POST')).status, 403);
  await grant(authorized, { 'project.delete': true });
  await grant(outsider, { 'project.delete': true });
  assert.equal((await request(`/projects/${target.id}/recycle`, outsider, 'POST')).status, 403);
  const detail = await request(`${rootPath(target)}/detail`, authorized);
  assert.equal(detail.body.capabilities.canEdit, false);
  assert.equal(detail.body.capabilities.canDelete, false);
  assert.equal(detail.body.capabilities.canRecycle, true);
  const recycled = await request(`/projects/${target.id}/recycle`, authorized, 'POST');
  assert.equal(recycled.status, 201, JSON.stringify(recycled.body));
  assert.equal(recycled.body.item.resourceType, 'project');
  assert.equal((await request(`/projects/${target.id}/recycle`, authorized, 'POST')).status, 409);
  assert.ok((await request('/recycle-bin', authorized)).body.items.some(item => item.id === recycled.body.item.id));
  assert.ok(!(await request('/recycle-bin', outsider)).body.items.some(item => item.id === recycled.body.item.id));
  await grant(authorized, { 'project.delete': false });
  assert.equal((await request(`/recycle-bin/${recycled.body.item.id}/restore`, authorized, 'POST')).status, 403);
  assert.equal((await request('/recycle-bin', authorized)).body.items.length, 0);
  assert.equal((await request(`/recycle-bin/${recycled.body.item.id}/restore`, owner, 'POST')).status, 200);
});

test('recycled project hides all related active resources and restores the retained graph and files', async () => {
  const target = project('Full preserved graph');
  const organizationId = owner.organization.id, userId = owner.user.id;
  const taskId = target.rootTaskId, projectId = target.id;
  const subtask = db.createTaskSubtask({ organizationId, taskId, userId, assigneeUserId: userId, title: 'Preserved subtask' });
  const nested = db.createTaskSubtask({ organizationId, taskId, parentSubtaskId: subtask.id, userId, assigneeUserId: userId, title: 'Preserved nested subtask' });
  db.createTaskComment({ organizationId, taskId, subtaskId: nested.id, userId, body: 'Preserved task comment' });
  db.createProjectComment({ organizationId, projectId, userId, body: 'Preserved project comment' });
  const attachment = db.createTaskAttachment({ organizationId, taskId, subtaskId: nested.id, userId, name: 'preserved.txt', mimeType: 'text/plain', sizeBytes: 10, storageKey: 'retained-task-file' });
  const document = db.createOfficeDocument({ organizationId, projectId, userId, title: 'Preserved document', storageKey: 'retained-office-file', fileType: 'xlsx' });
  const part = db.createPart({ organizationId, projectId, name: 'Preserved part', format: 'STEP', material: 'Steel', finish: '', dimensions: '', volume: 1, quantity: 1 });
  const quote = db.createQuote({ organizationId, projectId, userId, quoteNo: 'RECYCLE-Q-1', currency: 'CNY', lines: [{ description: 'Line', quantity: 2, unitPriceCents: 50 }] });
  const conversation = db.createConversation({ organizationId, projectId, title: 'Preserved communication' });
  const chatAttachment = db.createChatAttachment({ organizationId, userId, pendingConversationId: conversation.id, name: 'chat.txt', mimeType: 'text/plain', sizeBytes: 10, storageKey: 'retained-chat-file' });
  db.createMessage({ organizationId, conversationId: conversation.id, userId, body: 'Preserved message', attachmentIds: [chatAttachment.id] });
  const beforeStats = db.getOrganizationStats(organizationId);
  const result = await request(`/projects/${projectId}/recycle`, owner, 'POST');
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const paths = [
    `/projects/${projectId}`, `/projects/${projectId}/related`, `/projects/${projectId}/members`, `/projects/${projectId}/parts`,
    `/projects/${projectId}/quotes/${quote.id}`, `${rootPath(target)}/detail`, `${rootPath(target)}/subtasks`,
    `${rootPath(target)}/subtasks/${nested.id}/detail`, `${rootPath(target)}/subtasks/${nested.id}/attachments/${attachment.id}/download`,
    `/documents/${document.id}/config`, `/documents/${document.id}/download`, `/conversations/${conversation.id}/messages`,
    `/chat-attachments/${chatAttachment.id}/download`
  ];
  for (const path of paths) assert.equal((await request(path)).status, 404, path);
  assert.equal((await request(`/parts/${part.id}`, owner, 'PUT', { name: 'Denied' })).status, 404);
  assert.equal((await request(`${rootPath(target)}`, owner, 'PUT', { title: 'Denied' })).status, 404);
  assert.equal((await request(`/projects/${projectId}/parts`, owner, 'POST', { name: 'Denied', format: 'STEP' })).status, 404);
  const signature = createHmac('sha256', process.env.ONLYOFFICE_JWT_SECRET || 'mfggo-onlyoffice-2026').update(`${organizationId}:${document.id}`).digest('hex');
  for (const path of [`/office-files/${document.id}/document.xlsx`, `/api/office-files/${document.id}`]) {
    assert.equal((await request(`${path}?organizationId=${organizationId}&signature=${signature}`, null)).status, 404);
  }
  assert.equal((await request(`/onlyoffice/callback/${document.id}?organizationId=${organizationId}&signature=${signature}`, null, 'POST', { status: 2, url: 'http://127.0.0.1:1/never' })).status, 404);
  for (const [path, key, absentId] of [['/projects', 'projects', projectId], ['/tasks', 'tasks', taskId], ['/parts', 'parts', part.id], ['/documents', 'documents', document.id], ['/conversations', 'conversations', conversation.id]]) {
    const list = await request(path);
    assert.equal(list.status, 200);
    assert.ok(!list.body[key].some(item => item.id === absentId), path);
  }
  assert.equal(db.getOfficeDocumentStorage(organizationId, document.id), null);
  assert.equal(db.getTaskAttachmentStorage(organizationId, taskId, attachment.id, nested.id), null);
  assert.equal(db.createTaskComment({ organizationId, taskId, userId, body: 'Denied direct mutation' }), null);
  assert.equal(db.updatePart(organizationId, part.id, { name: 'Denied direct mutation' }), null);
  assert.equal(db.getOrganizationStats(organizationId).projects, beforeStats.projects - 1);
  assert.equal(db.getOrganizationStats(organizationId).parts, beforeStats.parts - 1);
  assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM task_subtasks WHERE task_id = ?').get(taskId).count, 2);
  assert.equal(sql.prepare('SELECT storage_key FROM task_attachments WHERE id = ?').get(attachment.id).storage_key, 'retained-task-file');
  const restored = await request(`/recycle-bin/${result.body.item.id}/restore`, owner, 'POST');
  assert.equal(restored.status, 200);
  assert.equal((await request(`/recycle-bin/${result.body.item.id}/restore`, owner, 'POST')).status, 409);
  assert.equal((await request(`/projects/${projectId}`)).status, 200);
  assert.equal(db.getTaskSubtask(organizationId, taskId, nested.id).title, 'Preserved nested subtask');
  assert.equal(db.listTaskComments(organizationId, taskId, nested.id)[0].body, 'Preserved task comment');
  assert.equal(db.listMessages(organizationId, conversation.id)[0].body, 'Preserved message');
  assert.equal(db.getOfficeDocumentStorage(organizationId, document.id).storage_key, 'retained-office-file');
  assert.equal(db.getTaskAttachmentStorage(organizationId, taskId, attachment.id, nested.id).storage_key, 'retained-task-file');
  assert.deepEqual(db.getOrganizationStats(organizationId), beforeStats);
});

test('document creation and upload clean their file if the project is recycled during I/O', async () => {
  for (const upload of [false, true]) {
    const target = project(`Document creation race ${upload}`);
    const original = db.createOfficeDocument;
    let storageKey;
    db.createOfficeDocument = function (input) {
      storageKey = input.storageKey;
      db.recycleResource(owner.organization.id, owner.user.id, 'project', target.id);
      return original.call(db, input);
    };
    try {
      const response = await fetch(`${address}/api/documents${upload ? '/upload' : ''}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${owner.token}`, 'content-type': upload ? 'application/octet-stream' : 'application/json',
          ...(upload ? { 'x-file-name': 'race.xlsx', 'x-project-id': target.id } : {}) },
        body: upload ? Buffer.from('race payload') : JSON.stringify({ projectId: target.id, fileType: 'xlsx', title: 'Race blank document' })
      });
      assert.equal(response.status, 404, JSON.stringify(await response.json()));
      assert.ok(storageKey);
      await assert.rejects(readFile(join(process.env.ONLYOFFICE_STORAGE_DIR, storageKey)), { code: 'ENOENT' });
      assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM office_documents WHERE project_id = ?').get(target.id).count, 0);
    } finally { db.createOfficeDocument = original; }
  }
});

test('standalone visibility and tenant boundaries remain enforced for recycling and restoring', async () => {
  const employee = await member();
  const other = await member();
  const deputy = await member('admin');
  await grant(employee, { 'task.delete': true });
  await grant(other, { 'task.delete': true });
  await grant(deputy, { 'task.delete': true });
  const organizationId = owner.organization.id;
  const task = db.createTask({ organizationId, userId: owner.user.id, title: 'Scoped standalone', assigneeUserId: employee.user.id });
  assert.equal((await request(`/tasks/${task.id}/recycle`, other, 'POST')).status, 403);
  assert.equal((await request(`/tasks/${task.id}`, deputy, 'PUT', { title: 'Denied edit' })).status, 403);
  const recycled = await request(`/tasks/${task.id}/recycle`, deputy, 'POST');
  assert.equal(recycled.status, 201);
  assert.equal((await request(`/tasks/${task.id}/detail`, employee)).status, 404);
  assert.equal((await request(`/recycle-bin/${recycled.body.item.id}/restore`, other, 'POST')).status, 403);
  assert.equal((await request(`/recycle-bin/${recycled.body.item.id}/restore`, employee, 'POST')).status, 200);
  const otherOrganization = db.createOrganization({ name: 'Other recycle tenant', slug: `recycle-tenant-${++sequence}`, ownerUserId: owner.user.id });
  const alternate = { token: db.createSession(owner.user.id, otherOrganization.id).token };
  assert.equal((await request(`/tasks/${task.id}/recycle`, alternate, 'POST')).status, 404);
  assert.equal((await request(`/recycle-bin/${recycled.body.item.id}/restore`, alternate, 'POST')).status, 404);
  assert.deepEqual((await request('/recycle-bin', alternate)).body.items, []);
});

test('an editor callback already fetching cannot overwrite a document after its project is recycled', async () => {
  const target = project('Callback race');
  const organizationId = owner.organization.id, userId = owner.user.id;
  const storageKey = 'callback-race.xlsx';
  const filePath = join(process.env.ONLYOFFICE_STORAGE_DIR, storageKey);
  await writeFile(filePath, 'original retained bytes');
  const document = db.createOfficeDocument({ organizationId, projectId: target.id, userId, title: 'Callback document', storageKey, sizeBytes: 23 });
  let payloadResponse, signalRequest;
  const requested = new Promise(resolve => { signalRequest = resolve; });
  const payloadServer = createServer((_req, response) => { payloadResponse = response; signalRequest(); });
  await new Promise(resolve => payloadServer.listen(0, '127.0.0.1', resolve));
  const signature = createHmac('sha256', process.env.ONLYOFFICE_JWT_SECRET || 'mfggo-onlyoffice-2026').update(`${organizationId}:${document.id}`).digest('hex');
  const pending = request(`/onlyoffice/callback/${document.id}?organizationId=${organizationId}&signature=${signature}`, null, 'POST', {
    status: 2, url: `http://127.0.0.1:${payloadServer.address().port}/save`
  });
  try {
    await requested;
    db.recycleResource(organizationId, userId, 'project', target.id);
    payloadResponse.end('late edited bytes');
    assert.equal((await pending).status, 404);
    assert.equal(await readFile(filePath, 'utf8'), 'original retained bytes');
    assert.equal(sql.prepare('SELECT version FROM office_documents WHERE id = ?').get(document.id).version, 1);
    assert.deepEqual((await readdir(process.env.ONLYOFFICE_STORAGE_DIR)).filter(name => name.endsWith('.tmp')), []);
  } finally {
    payloadResponse?.end();
    await new Promise(resolve => payloadServer.close(resolve));
  }
});

test('recycling closes assignment periods and restore records lifecycle without duplicate completion credit', async () => {
  const target = project('Retained lifecycle');
  const organizationId = owner.organization.id, userId = owner.user.id;
  assert.equal(target.executorUserId, '');
  const claimed = await request(rootPath(target), owner, 'PUT', { assigneeUserId: userId });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
  assert.equal(claimed.body.task.assigneeUserId, userId);
  db.updateTask(organizationId, target.rootTaskId, { status: '订单结束/已完成' }, { actorUserId: userId });
  const subtask = db.createTaskSubtask({ organizationId, taskId: target.rootTaskId, userId, assigneeUserId: userId, title: 'Completed child', completed: true });
  const completedBefore = db.getTaskHistoryReport(organizationId).summary.completedCount;
  const entry = db.recycleResource(organizationId, userId, 'project', target.id);
  for (const id of [target.rootTaskId, subtask.id]) {
    assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM task_assignment_periods WHERE entity_id = ? AND ended_at IS NULL').get(id).count, 0);
    assert.equal(sql.prepare('SELECT end_reason FROM task_assignment_periods WHERE entity_id = ? ORDER BY observed_at DESC').get(id).end_reason, 'recycled');
  }
  db.restoreRecycledResource(organizationId, userId, entry.id);
  for (const id of [target.rootTaskId, subtask.id]) assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM task_assignment_periods WHERE entity_id = ? AND ended_at IS NULL').get(id).count, 1);
  assert.equal(db.getTaskHistoryReport(organizationId).summary.completedCount, completedBefore);
  assert.deepEqual(db.listTaskHistory(organizationId, target.rootTaskId).slice(0, 2).map(item => item.eventType), ['restored', 'recycled']);
  const audits = db.listAudit(organizationId).filter(item => item.entityId === target.id).map(item => item.action);
  assert.ok(audits.includes('project.recycle'));
  assert.ok(audits.includes('project.restore'));
});

test('audit failures roll back archive state and assignment history atomically', () => {
  const target = project('Atomic recycle');
  const organizationId = owner.organization.id, userId = owner.user.id;
  const originalAudit = db.addAudit;
  const before = db.listTaskHistory(organizationId, target.rootTaskId);
  db.addAudit = () => { throw new Error('simulated audit failure'); };
  try { assert.throws(() => db.recycleResource(organizationId, userId, 'project', target.id), /simulated audit failure/); }
  finally { db.addAudit = originalAudit; }
  assert.ok(db.getProject(organizationId, target.id));
  assert.deepEqual(db.listTaskHistory(organizationId, target.rootTaskId), before);
  const entry = db.recycleResource(organizationId, userId, 'project', target.id);
  db.addAudit = () => { throw new Error('simulated restore audit failure'); };
  try { assert.throws(() => db.restoreRecycledResource(organizationId, userId, entry.id), /simulated restore audit failure/); }
  finally { db.addAudit = originalAudit; }
  assert.equal(db.getProject(organizationId, target.id), null);
  assert.ok(db.listRecycleBin(organizationId, userId).some(item => item.id === entry.id));
  assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM task_assignment_periods WHERE entity_id = ? AND ended_at IS NULL').get(target.rootTaskId).count, 0);
  db.restoreRecycledResource(organizationId, userId, entry.id);
});

test('recycle migration and reopened databases retain archive state and do not reopen assignment periods', async () => {
  const path = join(directory, 'restart.sqlite');
  let reopened = await createDatabase({ dbPath: path });
  const admin = reopened.authenticate('admin', 'recycle-owner-123');
  const organizationId = admin.organization.id, userId = admin.user.id;
  const target = reopened.createProject({ organizationId, userId, title: 'Restart survivor', stage: '立项沟通' });
  const entry = reopened.recycleResource(organizationId, userId, 'project', target.id);
  reopened.close();
  reopened = await createDatabase({ dbPath: path });
  try {
    assert.equal(reopened.getProject(organizationId, target.id), null);
    assert.equal(reopened.getTask(organizationId, target.rootTaskId), null);
    assert.ok(reopened.listRecycleBin(organizationId, userId).some(item => item.id === entry.id));
    const inspect = new DatabaseSync(path);
    assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM task_assignment_periods WHERE entity_id = ? AND ended_at IS NULL').get(target.rootTaskId).count, 0);
    assert.equal(inspect.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(), []);
    inspect.close();
    reopened.restoreRecycledResource(organizationId, userId, entry.id);
    assert.equal(reopened.getProject(organizationId, target.id).title, 'Restart survivor');
    assert.deepEqual(reopened.listTaskHistory(organizationId, target.rootTaskId).slice(0, 2).map(item => item.eventType), ['restored', 'recycled']);
  } finally { reopened.close(); }
});

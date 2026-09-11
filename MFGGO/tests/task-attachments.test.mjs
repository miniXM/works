import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

let fixture;
let address;
let previousInitialAdminPassword;
let previousTaskAttachmentStorage;

test.before(async () => {
  previousInitialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'admin123';
  previousTaskAttachmentStorage = process.env.TASK_ATTACHMENT_STORAGE_DIR;
  fixture = { path: await mkdtemp(join(tmpdir(), 'machquote-task-attachments-')) };
  process.env.TASK_ATTACHMENT_STORAGE_DIR = join(fixture.path, 'task-attachments');
  fixture.app = await createApp({ dbPath: join(fixture.path, 'test.sqlite') });
  fixture.server = createServer(fixture.app.callback());
  await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${fixture.server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => fixture.server.close(resolve));
  fixture.app.close();
  await rm(fixture.path, { recursive: true, force: true });
  if (previousInitialAdminPassword === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
  else process.env.INITIAL_ADMIN_PASSWORD = previousInitialAdminPassword;
  if (previousTaskAttachmentStorage === undefined) delete process.env.TASK_ATTACHMENT_STORAGE_DIR;
  else process.env.TASK_ATTACHMENT_STORAGE_DIR = previousTaskAttachmentStorage;
});

async function request(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(`${address}${path}`, { ...rest, headers: { 'content-type': 'application/json', ...headers } });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, body };
}

async function claimProjectRootTask(project, headers, userId) {
  assert.ok(project?.rootTaskId, '项目必须有根任务');
  assert.equal(project.executorUserId, '', '新建项目不应自动指定负责人');
  const claimed = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ assigneeUserId: userId })
  });
  assert.equal(claimed.response.status, 200);
  assert.equal(claimed.body.task.assigneeUserId, userId);
  return claimed.body.task;
}

async function listStorageFiles(directory) {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

test('任务附件支持上传、详情回显、下载、删除，并写入审计', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  assert.equal(login.response.status, 200);
  const headers = { authorization: `Bearer ${login.body.token}` };
  const projectResult = await request('/api/projects', {
    method: 'POST', headers,
    body: JSON.stringify({ title: `附件任务-${Date.now()}`, stage: '立项沟通' })
  });
  assert.equal(projectResult.response.status, 201);
  const task = await claimProjectRootTask(projectResult.body.project, headers, login.body.user.id);
  const taskId = task.id;

  const invalidType = await request(`/api/tasks/${taskId}/attachments`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('malware.exe') },
    body: Buffer.from('blocked')
  });
  assert.equal(invalidType.response.status, 400);
  assert.equal(invalidType.body.error, 'unsupported_task_attachment');

  const uploaded = await request(`/api/tasks/${taskId}/attachments`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('客户图纸.step') },
    body: Buffer.from('ISO-10303-21; TASK ATTACHMENT; END-ISO-10303-21;')
  });
  assert.equal(uploaded.response.status, 201);
  const attachment = uploaded.body.attachment;
  assert.equal(attachment.name, '客户图纸.step');
  assert.equal(attachment.taskId, taskId);
  assert.equal(attachment.sizeBytes, 48);
  assert.equal(attachment.uploaderDisplayName, 'admin');
  assert.equal(Object.hasOwn(attachment, 'storageKey'), false);

  const listed = await request(`/api/tasks/${taskId}/attachments`, { headers });
  assert.equal(listed.response.status, 200);
  assert.deepEqual(listed.body.attachments.map(item => item.id), [attachment.id]);

  const detail = await request(`/api/tasks/${taskId}/detail`, { headers });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.attachments[0].id, attachment.id);

  const download = await fetch(`${address}/api/tasks/${taskId}/attachments/${attachment.id}/download`, { headers });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'model/step');
  assert.match(download.headers.get('content-disposition') || '', /filename\*=UTF-8''%E5%AE%A2%E6%88%B7%E5%9B%BE%E7%BA%B8\.step/);
  assert.match(await download.text(), /TASK ATTACHMENT/);

  const imageUpload = await request(`/api/tasks/${taskId}/attachments`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('预览图.png') },
    body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
  });
  assert.equal(imageUpload.response.status, 201);
  const imagePreview = await fetch(`${address}/api/tasks/${taskId}/attachments/${imageUpload.body.attachment.id}/preview`, { headers });
  assert.equal(imagePreview.status, 200);
  assert.equal(imagePreview.headers.get('content-type'), 'image/png');
  assert.equal(imagePreview.headers.get('content-disposition'), null);
  assert.equal(imagePreview.headers.get('cache-control'), 'private, no-store');
  assert.equal(imagePreview.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await imagePreview.arrayBuffer()), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]));

  const pdfUpload = await request(`/api/tasks/${taskId}/attachments`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('说明.pdf') },
    body: Buffer.from('%PDF-1.7\ninline preview')
  });
  assert.equal(pdfUpload.response.status, 201);
  const pdfPreview = await fetch(`${address}/api/tasks/${taskId}/attachments/${pdfUpload.body.attachment.id}/preview`, { headers });
  assert.equal(pdfPreview.status, 200);
  assert.equal(pdfPreview.headers.get('content-type'), 'application/pdf');
  assert.match(Buffer.from(await pdfPreview.arrayBuffer()).toString(), /inline preview/);

  const textUpload = await request(`/api/tasks/${taskId}/attachments`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('变更记录.txt') },
    body: Buffer.from('任务附件预览内容', 'utf8')
  });
  assert.equal(textUpload.response.status, 201);
  const textPreview = await fetch(`${address}/api/tasks/${taskId}/attachments/${textUpload.body.attachment.id}/preview`, { headers });
  assert.equal(textPreview.status, 200);
  assert.match(textPreview.headers.get('content-type') || '', /^text\/plain(?:;|$)/);
  assert.equal(await textPreview.text(), '任务附件预览内容');

  const largeTextUpload = await request(`/api/tasks/${taskId}/attachments`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('大型日志.txt') },
    body: Buffer.alloc(1024 * 1024 + 1, 97)
  });
  assert.equal(largeTextUpload.response.status, 201);
  const largeTextPreview = await fetch(`${address}/api/tasks/${taskId}/attachments/${largeTextUpload.body.attachment.id}/preview`, { headers });
  assert.equal(largeTextPreview.status, 413);
  assert.equal((await largeTextPreview.json()).error, 'task_attachment_text_preview_too_large');
  const largeTextDownload = await fetch(`${address}/api/tasks/${taskId}/attachments/${largeTextUpload.body.attachment.id}/download`, { headers });
  assert.equal(largeTextDownload.status, 200);
  assert.equal((await largeTextDownload.arrayBuffer()).byteLength, 1024 * 1024 + 1);

  const unsupportedPreview = await fetch(`${address}/api/tasks/${taskId}/attachments/${attachment.id}/preview`, { headers });
  assert.equal(unsupportedPreview.status, 415);
  const unsupportedBody = await unsupportedPreview.json();
  assert.equal(unsupportedBody.error, 'task_attachment_preview_unsupported');

  const audit = await request('/api/audit', { headers });
  assert.ok(audit.body.events.some(event => event.action === 'task.attachment.upload' && event.entityId === attachment.id));

  const deleted = await request(`/api/tasks/${taskId}/attachments/${attachment.id}`, { method: 'DELETE', headers });
  assert.equal(deleted.response.status, 200);
  const afterDelete = await request(`/api/tasks/${taskId}/attachments`, { headers });
  assert.deepEqual(
    afterDelete.body.attachments.map(item => item.id),
    [imageUpload.body.attachment.id, pdfUpload.body.attachment.id, textUpload.body.attachment.id, largeTextUpload.body.attachment.id]
  );
  const unavailable = await request(`/api/tasks/${taskId}/attachments/${attachment.id}/download`, { headers });
  assert.equal(unavailable.response.status, 404);
  const deleteAudit = await request('/api/audit', { headers });
  assert.ok(deleteAudit.body.events.some(event => event.action === 'task.attachment.delete' && event.entityId === attachment.id));
});

test('任务附件严格按企业和任务隔离，空文件被拒绝', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const projectResult = await request('/api/projects', {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: `附件隔离-${Date.now()}` })
  });
  assert.equal(projectResult.response.status, 201);
  const task = await claimProjectRootTask(projectResult.body.project, headers, login.body.user.id);
  const empty = await request(`/api/tasks/${task.id}/attachments`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('empty.pdf') },
    body: Buffer.alloc(0)
  });
  assert.equal(empty.response.status, 400);
  assert.equal(empty.body.error, 'empty_task_attachment');

  const missingTask = await request('/api/tasks/task_does_not_exist/attachments', { headers });
  assert.equal(missingTask.response.status, 404);
  assert.equal(missingTask.body.error, 'task_not_found');
});

test('任务附件预览沿用项目成员权限，数据库写入失败时不残留文件', async () => {
  const ownerLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const ownerHeaders = { authorization: `Bearer ${ownerLogin.body.token}` };
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const invited = await request('/api/members', {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ username: `preview_viewer_${suffix}`, displayName: '预览访客', temporaryPassword: 'preview-pass-123', role: 'viewer' })
  });
  assert.equal(invited.response.status, 201);
  const viewerLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: invited.body.member.username, password: 'preview-pass-123' }) });
  assert.equal(viewerLogin.response.status, 200);
  const viewerHeaders = { authorization: `Bearer ${viewerLogin.body.token}` };

  const projectResult = await request('/api/projects', {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ title: `预览权限-${suffix}` })
  });
  assert.equal(projectResult.response.status, 201);
  const task = await claimProjectRootTask(projectResult.body.project, ownerHeaders, ownerLogin.body.user.id);
  const taskId = task.id;
  const uploaded = await request(`/api/tasks/${taskId}/attachments`, {
    method: 'POST',
    headers: { ...ownerHeaders, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('权限预览.txt') },
    body: Buffer.from('仅项目成员可见')
  });
  assert.equal(uploaded.response.status, 201);
  const denied = await fetch(`${address}/api/tasks/${taskId}/attachments/${uploaded.body.attachment.id}/preview`, { headers: viewerHeaders });
  assert.equal(denied.status, 403);
  const deniedBody = await denied.json();
  assert.equal(deniedBody.error, 'project_access_denied');

  const storageDirectory = join(fixture.path, 'task-attachments', ownerLogin.body.organization.id);
  const filesBeforeFailure = (await readdir(storageDirectory)).sort();
  const originalCreateTaskAttachment = fixture.app.context.db.createTaskAttachment;
  fixture.app.context.db.createTaskAttachment = () => { throw new Error('simulated task attachment database failure'); };
  try {
    const failed = await request(`/api/tasks/${taskId}/attachments`, {
      method: 'POST',
      headers: { ...ownerHeaders, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('应清理.txt') },
      body: Buffer.from('写盘后数据库失败')
    });
    assert.equal(failed.response.status, 500);
  } finally {
    fixture.app.context.db.createTaskAttachment = originalCreateTaskAttachment;
  }
  const filesAfterFailure = (await readdir(storageDirectory)).sort();
  assert.deepEqual(filesAfterFailure, filesBeforeFailure, '失败上传不应留下孤儿文件');
  const listed = await request(`/api/tasks/${taskId}/attachments`, { headers: ownerHeaders });
  assert.deepEqual(listed.body.attachments.map(item => item.id), [uploaded.body.attachment.id]);
});

test('删除独立父任务时清理根、子任务和孙任务附件文件', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const headers = { authorization: `Bearer ${login.body.token}` };
  const created = await request('/api/tasks', {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: `附件级联清理-${Date.now()}`, stage: '未分组' })
  });
  assert.equal(created.response.status, 201);
  const taskId = created.body.task.id;
  const childResult = await request(`/api/tasks/${taskId}/subtasks`, {
    method: 'POST', headers, body: JSON.stringify({ title: '子任务附件节点' })
  });
  assert.equal(childResult.response.status, 201);
  const childId = childResult.body.subtask.id;
  const grandchildResult = await request(`/api/tasks/${taskId}/subtasks/${childId}/subtasks`, {
    method: 'POST', headers, body: JSON.stringify({ title: '孙任务附件节点' })
  });
  assert.equal(grandchildResult.response.status, 201);
  const grandchildId = grandchildResult.body.subtask.id;

  const upload = async (path, name) => {
    const result = await request(path, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) },
      body: Buffer.from(name)
    });
    assert.equal(result.response.status, 201, `${name} 上传失败: ${JSON.stringify(result.body)}`);
    return result.body.attachment;
  };
  const storageDirectory = join(fixture.path, 'task-attachments', login.body.organization.id);
  const filesBefore = new Set(await listStorageFiles(storageDirectory));
  await upload(`/api/tasks/${taskId}/attachments`, 'cascade-root.txt');
  await upload(`/api/tasks/${taskId}/subtasks/${childId}/attachments`, 'cascade-child.txt');
  await upload(`/api/tasks/${taskId}/subtasks/${grandchildId}/attachments`, 'cascade-grandchild.txt');

  const before = await listStorageFiles(storageDirectory);
  assert.equal(before.length - filesBefore.size, 3);

  const deleted = await request(`/api/tasks/${taskId}`, { method: 'DELETE', headers });
  assert.equal(deleted.response.status, 200, JSON.stringify(deleted.body));
  const after = await listStorageFiles(storageDirectory);
  assert.deepEqual(after.sort(), [...filesBefore].sort(), '父任务级联删除后不应留下任何子任务附件文件');
  assert.equal(fixture.app.context.db.getTask(login.body.organization.id, taskId), null);
  assert.equal(fixture.app.context.db.listTaskAttachmentStorage(login.body.organization.id, taskId).length, 0);
});

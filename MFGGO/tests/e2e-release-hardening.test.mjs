import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

let fixture;
let address;
let previousInitialAdminPassword;
let previousOnlyOfficeStorage;
let previousChatAttachmentStorage;

test.before(async () => {
  previousInitialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'admin123';
  fixture = { path: await mkdtemp(join(tmpdir(), 'machquote-release-e2e-')) };
  previousOnlyOfficeStorage = process.env.ONLYOFFICE_STORAGE_DIR;
  process.env.ONLYOFFICE_STORAGE_DIR = join(fixture.path, 'office-documents');
  previousChatAttachmentStorage = process.env.CHAT_ATTACHMENT_STORAGE_DIR;
  process.env.CHAT_ATTACHMENT_STORAGE_DIR = join(fixture.path, 'chat-attachments');
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
  if (previousOnlyOfficeStorage === undefined) delete process.env.ONLYOFFICE_STORAGE_DIR;
  else process.env.ONLYOFFICE_STORAGE_DIR = previousOnlyOfficeStorage;
  if (previousChatAttachmentStorage === undefined) delete process.env.CHAT_ATTACHMENT_STORAGE_DIR;
  else process.env.CHAT_ATTACHMENT_STORAGE_DIR = previousChatAttachmentStorage;
});

async function request(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(`${address}${path}`, { ...rest, headers: { 'content-type': 'application/json', ...headers } });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, body };
}

async function login(username = 'admin', password = 'admin123') {
  const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  assert.equal(result.response.status, 200);
  return { ...result.body, headers: { authorization: `Bearer ${result.body.token}` } };
}

test('发布门禁：健康检查、认证会话和登出都具备明确状态码', async () => {
  const health = await request('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);

  const unauthenticated = await request('/api/me');
  assert.equal(unauthenticated.response.status, 401);
  assert.equal(unauthenticated.body.error, 'unauthorized');

  const invalidLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'wrong-password' }) });
  assert.equal(invalidLogin.response.status, 401);
  assert.equal(invalidLogin.body.error, 'invalid_credentials');

  const admin = await login();
  const me = await request('/api/me', { headers: admin.headers });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.user.username, 'admin');
  assert.equal(me.body.organization.slug, 'mfggo-demo');
  assert.ok(me.body.expiresAt);

  const logout = await request('/api/auth/logout', { method: 'POST', headers: admin.headers });
  assert.equal(logout.response.status, 200);
  const afterLogout = await request('/api/me', { headers: admin.headers });
  assert.equal(afterLogout.response.status, 401);
});

test('文档中心闭环：创建、上传、下载、配置、回收站恢复和永久删除', async () => {
  const admin = await login();
  const project = (await request('/api/projects', {
    method: 'POST', headers: admin.headers,
    body: JSON.stringify({ title: `文档生命周期-${Date.now()}`, stage: '立项沟通' })
  })).body.project;

  const created = await request('/api/documents', {
    method: 'POST', headers: admin.headers,
    body: JSON.stringify({ projectId: project.id, fileType: 'xlsx', title: '成本核算.xlsx' })
  });
  assert.equal(created.response.status, 201);
  const document = created.body.document;
  assert.equal(document.projectId, project.id);
  assert.equal(document.fileType, 'xlsx');

  const config = await request(`/api/documents/${document.id}/config`, { headers: admin.headers });
  assert.equal(config.response.status, 200);
  assert.equal(config.body.document.fileType, 'xlsx');
  assert.equal(config.body.documentType, 'cell');
  assert.match(config.body.document.url, new RegExp(`signature=`));
  assert.match(config.body.editorConfig.callbackUrl, /signature=/);
  assert.ok(config.body.token);

  const download = await fetch(`${address}/api/documents/${document.id}/download`, { headers: admin.headers });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition') || '', /filename\*=UTF-8''%E6%88%90%E6%9C%AC%E6%A0%B8%E7%AE%97\.xlsx/);
  assert.ok((await download.arrayBuffer()).byteLength > 10);

  const uploaded = await request('/api/documents/upload', {
    method: 'POST',
    headers: { ...admin.headers, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('客户图纸.pdf'), 'x-project-id': project.id },
    body: Buffer.from('%PDF-1.7 E2E fixture')
  });
  assert.equal(uploaded.response.status, 201);
  assert.equal(uploaded.body.document.fileType, 'pdf');

  const renamed = await request(`/api/documents/${document.id}`, {
    method: 'PUT', headers: admin.headers, body: JSON.stringify({ title: '成本核算-修订.xlsx' })
  });
  assert.equal(renamed.response.status, 200);
  assert.equal(renamed.body.document.title, '成本核算-修订.xlsx');

  const trashed = await request(`/api/documents/${document.id}`, { method: 'DELETE', headers: admin.headers });
  assert.equal(trashed.response.status, 200);
  const trash = await request('/api/documents/trash', { headers: admin.headers });
  assert.ok(trash.body.documents.some(item => item.id === document.id));
  const unavailable = await request(`/api/documents/${document.id}/download`, { headers: admin.headers });
  assert.equal(unavailable.response.status, 404);

  const restored = await request(`/api/documents/${document.id}/restore`, { method: 'POST', headers: admin.headers });
  assert.equal(restored.response.status, 200);
  const restoredDownload = await request(`/api/documents/${document.id}/download`, { headers: admin.headers });
  assert.equal(restoredDownload.response.status, 200);

  const permanentlyDeleted = await request(`/api/documents/${document.id}`, { method: 'DELETE', headers: admin.headers });
  assert.equal(permanentlyDeleted.response.status, 200);
  const permanent = await request(`/api/documents/${document.id}/permanent`, { method: 'DELETE', headers: admin.headers });
  assert.equal(permanent.response.status, 200);
  const missing = await request(`/api/documents/${document.id}/config`, { headers: admin.headers });
  assert.equal(missing.response.status, 404);

  const badSignature = await request(`/api/office-files/${uploaded.body.document.id}/document.pdf?organizationId=${encodeURIComponent(admin.organization.id)}&signature=bad`);
  assert.equal(badSignature.response.status, 403);
});

test('业务输入门禁与租户隔离：拒绝空数据、非法状态和跨企业资源访问', async () => {
  const admin = await login();
  const emptyProject = await request('/api/projects', { method: 'POST', headers: admin.headers, body: JSON.stringify({ title: '   ' }) });
  assert.equal(emptyProject.response.status, 400);
  assert.equal(emptyProject.body.error, 'invalid_project');
  const emptyTask = await request('/api/tasks', { method: 'POST', headers: admin.headers, body: JSON.stringify({ title: '' }) });
  assert.equal(emptyTask.response.status, 400);
  assert.equal(emptyTask.body.error, 'invalid_task');

  const project = (await request('/api/projects', {
    method: 'POST', headers: admin.headers,
    body: JSON.stringify({ title: `隔离与校验-${Date.now()}` })
  })).body.project;
  const emptyQuote = await request(`/api/projects/${project.id}/quotes`, { method: 'POST', headers: admin.headers, body: JSON.stringify({ lines: [] }) });
  assert.equal(emptyQuote.response.status, 400);
  assert.equal(emptyQuote.body.error, 'invalid_quote');
  const invalidFair = await request(`/api/projects/${project.id}/fair-items`, { method: 'POST', headers: admin.headers, body: JSON.stringify({ characteristic: '' }) });
  assert.equal(invalidFair.response.status, 400);
  assert.equal(invalidFair.body.error, 'invalid_fair_item');
  const invalidMessage = await request('/api/conversations', { method: 'POST', headers: admin.headers, body: JSON.stringify({ title: '   ' }) });
  assert.equal(invalidMessage.response.status, 400);
  assert.equal(invalidMessage.body.error, 'invalid_conversation');

  const otherOrg = await request('/api/platform/organizations', {
    method: 'POST', headers: admin.headers,
    body: JSON.stringify({ name: `隔离企业-${Date.now()}`, slug: `isolation-${Date.now()}`, ownerUserId: admin.user.id })
  });
  assert.equal(otherOrg.response.status, 201);
  const switched = await request(`/api/platform/organizations/${otherOrg.body.organization.id}/switch`, { method: 'POST', headers: admin.headers });
  assert.equal(switched.response.status, 200);
  const otherHeaders = { authorization: `Bearer ${switched.body.token}` };
  const otherProjects = await request('/api/projects', { headers: otherHeaders });
  assert.equal(otherProjects.response.status, 200);
  assert.equal(otherProjects.body.projects.length, 0);
  const crossTenantProject = await request(`/api/projects/${project.id}`, { headers: otherHeaders });
  assert.equal(crossTenantProject.response.status, 404);
  const crossTenantParts = await request(`/api/projects/${project.id}/parts`, { headers: otherHeaders });
  assert.equal(crossTenantParts.response.status, 404);
});

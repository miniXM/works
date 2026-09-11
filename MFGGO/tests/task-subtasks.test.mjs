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

test.before(async () => {
  previousInitialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'admin123';
  fixture = { path: await mkdtemp(join(tmpdir(), 'machquote-task-subtasks-')) };
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
});

async function request(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(`${address}${path}`, { ...rest, headers: { 'content-type': 'application/json', ...headers } });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, body };
}

async function login(username, password = 'admin123') {
  const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  assert.equal(result.response.status, 200);
  return { ...result.body, headers: { authorization: `Bearer ${result.body.token}` } };
}

async function claimProjectRootTask(project, member) {
  assert.ok(project?.rootTaskId, '项目必须有根任务');
  assert.equal(project.executorUserId, '', '新建项目不应自动指定负责人');
  const claimed = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT',
    headers: member.headers,
    body: JSON.stringify({ assigneeUserId: member.user.id })
  });
  assert.equal(claimed.response.status, 200, `认领项目根任务失败: ${JSON.stringify(claimed.body)}`);
  assert.equal(claimed.body.task.assigneeUserId, member.user.id);
  return claimed.body.task;
}

test('任务子任务支持项目成员读取、创建、更新完成状态和删除，并按租户隔离', async () => {
  const admin = await login('admin');
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const invited = await request('/api/members', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({ username: `subtask_worker_${suffix}`, displayName: '子任务工程师', temporaryPassword: 'subtask-pass-123', role: 'engineer' })
  });
  assert.equal(invited.response.status, 201);
  const worker = await login(`subtask_worker_${suffix}`, 'subtask-pass-123');

  const projectResult = await request('/api/projects', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({ title: `子任务权限验收-${suffix}`, stage: '内部报价' })
  });
  assert.equal(projectResult.response.status, 201);
  const project = projectResult.body.project;
  await claimProjectRootTask(project, admin);
  const taskId = project.rootTaskId;
  const memberResult = await request(`/api/projects/${project.id}/members`, {
    method: 'POST', headers: admin.headers,
    body: JSON.stringify({ userId: worker.user.id, projectRole: 'member' })
  });
  assert.equal(memberResult.response.status, 201);

  const initial = await request(`/api/tasks/${taskId}/detail`, { headers: admin.headers });
  assert.equal(initial.response.status, 200);
  assert.deepEqual(initial.body.subtasks, []);

  const created = await request(`/api/tasks/${taskId}/subtasks`, {
    method: 'POST', headers: admin.headers,
    body: JSON.stringify({
      title: '确认报价资料',
      description: { type: 'doc', content: [{ type: 'text', text: '检查客户图纸与数量' }] },
      assigneeUserId: worker.user.id,
      dueAt: '2026-09-15',
      priority: '高',
      position: 3
    })
  });
  assert.equal(created.response.status, 201);
  const subtask = created.body.subtask;
  assert.equal(subtask.taskId, taskId);
  assert.equal(subtask.title, '确认报价资料');
  assert.equal(subtask.completed, false);
  assert.equal(subtask.status, '待处理');
  assert.equal(subtask.assigneeUserId, worker.user.id);
  assert.equal(subtask.dueAt, '2026-09-15');
  assert.equal(subtask.position, 3);
  assert.deepEqual(JSON.parse(subtask.description), { type: 'doc', content: [{ type: 'text', text: '检查客户图纸与数量' }] });

  const listed = await request(`/api/tasks/${taskId}/subtasks`, { headers: worker.headers });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.summary.total, 1);
  assert.equal(listed.body.summary.remaining, 1);

  const completed = await request(`/api/tasks/${taskId}/subtasks/${subtask.id}`, {
    method: 'PUT', headers: worker.headers, body: JSON.stringify({ completed: true })
  });
  assert.equal(completed.response.status, 200);
  assert.equal(completed.body.subtask.completed, true);
  assert.equal(completed.body.subtask.status, '已完成');

  const renamed = await request(`/api/tasks/${taskId}/subtasks/${subtask.id}`, {
    method: 'PATCH', headers: worker.headers, body: JSON.stringify({ title: '确认最终报价资料', dueAt: '' })
  });
  assert.equal(renamed.response.status, 200);
  assert.equal(renamed.body.subtask.title, '确认最终报价资料');
  assert.equal(renamed.body.subtask.dueAt, '');

  const detail = await request(`/api/tasks/${taskId}/detail`, { headers: admin.headers });
  assert.equal(detail.body.subtasks.length, 1);
  assert.equal(detail.body.subtasks[0].id, subtask.id);
  assert.equal(detail.body.subtasks[0].completed, true);

  const deniedDeletion = await request(`/api/tasks/${taskId}/subtasks/${subtask.id}`, { method: 'DELETE', headers: worker.headers });
  assert.equal(deniedDeletion.response.status, 403);
  const grantedDeletion = await request(`/api/organization/members/${worker.user.id}`, {
    method: 'PUT', headers: admin.headers,
    body: JSON.stringify({ permissions: { 'task.delete': true } })
  });
  assert.equal(grantedDeletion.response.status, 200);
  const removed = await request(`/api/tasks/${taskId}/subtasks/${subtask.id}`, { method: 'DELETE', headers: worker.headers });
  assert.equal(removed.response.status, 200);
  assert.equal(removed.body.ok, true);
  const afterDelete = await request(`/api/tasks/${taskId}/subtasks`, { headers: admin.headers });
  assert.deepEqual(afterDelete.body.subtasks, []);

  const outsiderInvite = await request('/api/members', {
    method: 'POST', headers: admin.headers,
    body: JSON.stringify({ username: `subtask_outsider_${suffix}`, displayName: '项目外成员', temporaryPassword: 'subtask-pass-123', role: 'engineer' })
  });
  assert.equal(outsiderInvite.response.status, 201);
  const outsider = await login(`subtask_outsider_${suffix}`, 'subtask-pass-123');
  const deniedRead = await request(`/api/tasks/${taskId}/subtasks`, { headers: outsider.headers });
  assert.equal(deniedRead.response.status, 403);
  const deniedCreate = await request(`/api/tasks/${taskId}/subtasks`, {
    method: 'POST', headers: outsider.headers, body: JSON.stringify({ title: '越权子任务' })
  });
  assert.equal(deniedCreate.response.status, 403);
});

test('创建子任务省略执行者时默认由创建者执行', async () => {
  const admin = await login('admin');
  const projectResult = await request('/api/projects', {
    method: 'POST', headers: admin.headers,
    body: JSON.stringify({ title: `子任务默认执行者-${Date.now()}`, stage: '立项沟通' })
  });
  assert.equal(projectResult.response.status, 201);
  const task = await claimProjectRootTask(projectResult.body.project, admin);
  const taskId = task.id;

  const created = await request(`/api/tasks/${taskId}/subtasks`, {
    method: 'POST', headers: admin.headers,
    body: JSON.stringify({ title: '创建者默认负责' })
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.subtask.assigneeUserId, admin.user.id);
  assert.equal(created.body.subtask.assigneeDisplayName, admin.user.displayName);
});

test('任务详情和项目关联内容同时返回子任务及汇总', async () => {
  const admin = await login('admin');
  const projectResult = await request('/api/projects', {
    method: 'POST', headers: admin.headers,
    body: JSON.stringify({ title: `子任务关联验收-${Date.now()}`, stage: '立项沟通' })
  });
  assert.equal(projectResult.response.status, 201);
  const project = projectResult.body.project;
  await claimProjectRootTask(project, admin);
  const created = await request(`/api/tasks/${project.rootTaskId}/subtasks`, {
    method: 'POST', headers: admin.headers, body: JSON.stringify({ title: '关联内容上方显示' })
  });
  assert.equal(created.response.status, 201);
  const related = await request(`/api/projects/${project.id}/related`, { headers: admin.headers });
  assert.equal(related.response.status, 200);
  assert.equal(related.body.subtasks.length, 1);
  assert.deepEqual(related.body.subtaskSummary, { total: 1, completed: 0, remaining: 1 });
  assert.equal(related.body.available.subtasks, true);
});

test('子任务详情使用主任务模板功能但评论和附件独立作用域', async () => {
  const admin = await login('admin');
  const projectResult = await request('/api/projects', {
    method: 'POST', headers: admin.headers,
    body: JSON.stringify({ title: `子任务模板功能-${Date.now()}`, stage: '立项沟通' })
  });
  assert.equal(projectResult.response.status, 201);
  const project = projectResult.body.project;
  const task = await claimProjectRootTask(project, admin);
  const taskId = task.id;

  const created = await request(`/api/tasks/${taskId}/subtasks`, {
    method: 'POST', headers: admin.headers,
    body: JSON.stringify({ title: '子任务也要完整模板', assigneeUserId: admin.user.id })
  });
  assert.equal(created.response.status, 201);
  const subtask = created.body.subtask;

  const rootComment = await request(`/api/tasks/${taskId}/comments`, {
    method: 'POST', headers: admin.headers, body: JSON.stringify({ body: '主任务评论' })
  });
  assert.equal(rootComment.response.status, 201);
  assert.equal(rootComment.body.comment.subtaskId, '');

  const subtaskComment = await request(`/api/tasks/${taskId}/subtasks/${subtask.id}/comments`, {
    method: 'POST', headers: admin.headers, body: JSON.stringify({ body: '子任务自己的评论' })
  });
  assert.equal(subtaskComment.response.status, 201);
  assert.equal(subtaskComment.body.comment.subtaskId, subtask.id);

  const rootAttachment = await request(`/api/tasks/${taskId}/attachments`, {
    method: 'POST',
    headers: { ...admin.headers, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('root-note.txt') },
    body: 'root attachment'
  });
  assert.equal(rootAttachment.response.status, 201);
  assert.equal(rootAttachment.body.attachment.subtaskId, '');

  const subtaskAttachment = await request(`/api/tasks/${taskId}/subtasks/${subtask.id}/attachments`, {
    method: 'POST',
    headers: { ...admin.headers, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('subtask-note.txt') },
    body: 'subtask attachment'
  });
  assert.equal(subtaskAttachment.response.status, 201);
  assert.equal(subtaskAttachment.body.attachment.subtaskId, subtask.id);

  const rootDetail = await request(`/api/tasks/${taskId}/detail`, { headers: admin.headers });
  assert.equal(rootDetail.response.status, 200);
  assert.deepEqual(rootDetail.body.comments.map(item => item.body), ['主任务评论']);
  assert.deepEqual(rootDetail.body.attachments.map(item => item.name), ['root-note.txt']);

  const subtaskDetail = await request(`/api/tasks/${taskId}/subtasks/${subtask.id}/detail`, { headers: admin.headers });
  assert.equal(subtaskDetail.response.status, 200);
  assert.deepEqual(subtaskDetail.body.comments.map(item => item.body), ['子任务自己的评论']);
  assert.deepEqual(subtaskDetail.body.attachments.map(item => item.name), ['subtask-note.txt']);
  assert.deepEqual(subtaskDetail.body.projectComments, []);
  assert.ok(subtaskDetail.body.activities.some(item => item.metadata?.subtaskId === subtask.id));

  const subtaskPreview = await fetch(`${address}/api/tasks/${taskId}/subtasks/${subtask.id}/attachments/${subtaskAttachment.body.attachment.id}/preview`, {
    headers: admin.headers
  });
  assert.equal(subtaskPreview.status, 200);
  assert.equal(await subtaskPreview.text(), 'subtask attachment');

  const rootCannotDownloadSubtaskAttachment = await request(`/api/tasks/${taskId}/attachments/${subtaskAttachment.body.attachment.id}/download`, {
    headers: admin.headers
  });
  assert.equal(rootCannotDownloadSubtaskAttachment.response.status, 404);
});

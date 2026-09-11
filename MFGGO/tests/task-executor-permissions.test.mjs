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
  fixture = { path: await mkdtemp(join(tmpdir(), 'machquote-task-executor-')) };
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
  const response = await fetch(`${address}${path}`, {
    ...rest,
    headers: { 'content-type': 'application/json', ...headers }
  });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await response.json() : await response.text();
  return { response, body };
}

async function login(username, password = 'admin123') {
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  assert.equal(result.response.status, 200, `登录 ${username} 失败: ${JSON.stringify(result.body)}`);
  return { ...result.body, headers: { authorization: `Bearer ${result.body.token}` } };
}

async function createMember(owner, label) {
  const username = `executor_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const password = 'executor-pass-123';
  const created = await request('/api/members', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ username, displayName: username, temporaryPassword: password, role: 'engineer' })
  });
  assert.equal(created.response.status, 201, `创建成员失败: ${JSON.stringify(created.body)}`);
  return login(username, password);
}

async function createProject(owner, title) {
  const created = await request('/api/projects', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ title, stage: '立项沟通' })
  });
  assert.equal(created.response.status, 201, `创建项目失败: ${JSON.stringify(created.body)}`);
  return created.body.project;
}

async function addProjectMember(owner, projectId, member, projectRole = 'member') {
  const added = await request(`/api/projects/${projectId}/members`, {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ userId: member.user.id, projectRole })
  });
  assert.equal(added.response.status, 201, `加入项目失败: ${JSON.stringify(added.body)}`);
  return added.body.member;
}

async function claimProjectRoot(member, project) {
  const claimed = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT', headers: member.headers, body: JSON.stringify({ assigneeUserId: member.user.id })
  });
  assert.equal(claimed.response.status, 200, `认领项目根任务失败: ${JSON.stringify(claimed.body)}`);
  return claimed.body;
}

async function releaseProjectRoot(member, project) {
  const released = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT', headers: member.headers, body: JSON.stringify({ assigneeUserId: '' })
  });
  assert.equal(released.response.status, 200, `释放项目根任务失败: ${JSON.stringify(released.body)}`);
  return released.body;
}

test('项目创建者不会自动成为根任务负责人', async () => {
  const owner = await login('admin');
  const project = await createProject(owner, `创建者默认执行者-${Date.now()}`);

  assert.equal(project.ownerUserId, owner.user.id);
  assert.equal(project.executorUserId, '');
  const detail = await request(`/api/tasks/${project.rootTaskId}/detail`, { headers: owner.headers });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.task.assigneeUserId, '');
  assert.equal(detail.body.capabilities.isExecutor, false);
  assert.equal(detail.body.capabilities.canClaim, true);
});

test('当前负责人可以交接，非负责人不能修改根任务', async () => {
  const owner = await login('admin');
  const worker = await createMember(owner, 'handoff');
  const project = await createProject(owner, `执行者交接-${Date.now()}`);
  await claimProjectRoot(owner, project);
  await addProjectMember(owner, project.id, worker);
  const assigned = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT', headers: owner.headers, body: JSON.stringify({ assigneeUserId: worker.user.id })
  });
  assert.equal(assigned.response.status, 200);
  assert.equal(assigned.body.task.assigneeUserId, worker.user.id);

  const handedOff = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT',
    headers: worker.headers,
    body: JSON.stringify({ assigneeUserId: owner.user.id })
  });
  assert.equal(handedOff.response.status, 200);
  assert.equal(handedOff.body.task.assigneeUserId, owner.user.id);

  const denied = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT',
    headers: worker.headers,
    body: JSON.stringify({ status: '进行中' })
  });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.body.error, 'task_executor_required');

  const updated = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT',
    headers: owner.headers,
    body: JSON.stringify({ status: '进行中' })
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.task.status, '进行中');
});

test('项目成员可以认领被释放的空根任务', async () => {
  const owner = await login('admin');
  const worker = await createMember(owner, 'claim');
  const project = await createProject(owner, `成员认领-${Date.now()}`);
  await claimProjectRoot(owner, project);
  await addProjectMember(owner, project.id, worker);
  await releaseProjectRoot(owner, project);

  const claimed = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT',
    headers: worker.headers,
    body: JSON.stringify({ assigneeUserId: worker.user.id })
  });
  assert.equal(claimed.response.status, 200);
  assert.equal(claimed.body.task.assigneeUserId, worker.user.id);
  assert.equal(claimed.body.project.executorUserId, worker.user.id);
});

test('空根任务的并发认领只允许一个成员成功', async () => {
  const owner = await login('admin');
  const [first, second] = await Promise.all([
    createMember(owner, 'race_a'),
    createMember(owner, 'race_b')
  ]);
  const project = await createProject(owner, `并发认领-${Date.now()}`);
  await claimProjectRoot(owner, project);
  await Promise.all([
    addProjectMember(owner, project.id, first),
    addProjectMember(owner, project.id, second)
  ]);
  await releaseProjectRoot(owner, project);
  const results = await Promise.all([first, second].map(member => request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT',
    headers: member.headers,
    body: JSON.stringify({ assigneeUserId: member.user.id })
  })));
  assert.deepEqual(results.map(result => result.response.status).sort((a, b) => a - b), [200, 409]);
  const winner = results.find(result => result.response.status === 200);
  const detail = await request(`/api/tasks/${project.rootTaskId}/detail`, { headers: owner.headers });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.task.assigneeUserId, winner.body.task.assigneeUserId);
  assert.ok([first.user.id, second.user.id].includes(detail.body.task.assigneeUserId));
});

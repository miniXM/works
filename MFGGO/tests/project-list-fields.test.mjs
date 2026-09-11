import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

test('legacy task list fields and list audit records obey current list read and write grants', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'project-list-fields-'));
  const previousPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'list-fields-owner-123';
  const app = await createApp({ dbPath: join(directory, 'test.sqlite') });
  const server = createServer(app.callback());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, actor, method = 'GET', body) {
    const response = await fetch(address + path, { method, headers: { 'content-type': 'application/json', ...(actor?.token ? { authorization: `Bearer ${actor.token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  try {
    const owner = (await request('/auth/login', null, 'POST', { username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD })).body;
    const member = (await request('/members', owner, 'POST', { username: 'list.worker', displayName: 'List worker', temporaryPassword: 'list-worker-123', role: 'member' })).body.member;
    const worker = (await request('/auth/login', null, 'POST', { username: 'list.worker', password: 'list-worker-123' })).body;
    const project = (await request('/projects', owner, 'POST', { title: 'List scope' })).body.project;
    const claimed = await request(`/tasks/${project.rootTaskId}`, owner, 'PUT', { assigneeUserId: owner.user.id });
    assert.equal(claimed.status, 200);
    const added = await request(`/projects/${project.id}/members`, owner, 'POST', { userId: member.id });
    assert.equal(added.status, 201);
    const handedOff = await request(`/tasks/${project.rootTaskId}`, owner, 'PUT', { projectList: 'PRIVATE-LIST-TEXT', assigneeUserId: member.id });
    assert.equal(handedOff.status, 200);
    const list = (await request(`/projects/${project.id}/lists`, owner, 'POST', { title: 'PRIVATE-LIST-NAME', items: [] })).body.list;
    const second = (await request(`/projects/${project.id}/lists`, owner, 'POST', { title: 'Second list', items: [] })).body.list;
    await request(`/projects/${project.id}/lists/selection`, owner, 'PUT', { listId: list.id });
    const grant = permissions => request(`/organization/members/${member.id}`, owner, 'PUT', { permissions });
    await grant({ 'audit.read': true, 'task.create': true });
    for (const path of ['/tasks', `/tasks/${project.rootTaskId}/detail`, '/audit']) {
      const result = await request(path, worker);
      assert.equal(result.status, 200, path);
      const serialized = JSON.stringify(result.body);
      assert.equal(serialized.includes('PRIVATE-LIST'), false, path);
      assert.equal(serialized.includes('projectList'), false, path);
      assert.equal(serialized.includes(list.id), false, path);
      assert.equal(serialized.includes(second.id), false, path);
    }
    assert.equal((await request(`/tasks/${project.rootTaskId}`, worker, 'PUT', { projectList: 'Denied' })).status, 403);
    assert.equal((await request('/tasks', worker, 'POST', { title: 'Denied create', projectList: 'Denied' })).status, 403);
    await grant({ 'project.list.read': true });
    const visible = await request(`/tasks/${project.rootTaskId}/detail`, worker);
    assert.equal(visible.body.task.projectList, 'PRIVATE-LIST-TEXT');
    assert.equal((await request(`/tasks/${project.rootTaskId}`, worker, 'PUT', { projectList: 'Denied readonly' })).status, 403);
    await grant({ 'project.list.write': true });
    assert.equal((await request(`/tasks/${project.rootTaskId}`, worker, 'PUT', { projectList: 'Authorized' })).status, 200);
    await grant({ 'project.list.read': false });
    assert.equal(JSON.stringify((await request(`/tasks/${project.rootTaskId}/detail`, worker)).body).includes('Authorized'), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    app.close();
    await rm(directory, { recursive: true, force: true });
    if (previousPassword === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
    else process.env.INITIAL_ADMIN_PASSWORD = previousPassword;
  }
});

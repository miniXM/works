import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

let app, server, directory, address, owner, previousPassword;
let sequence = 0;
async function request(path, actor = owner, method = 'GET', data) {
  const response = await fetch(`${address}/api${path}`, {
    method, headers: { 'content-type': 'application/json', ...(actor?.token ? { authorization: `Bearer ${actor.token}` } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });
  return { status: response.status, body: await response.json() };
}
async function member(role = 'engineer') {
  const username = `org_business_${++sequence}`;
  const created = await request('/members', owner, 'POST', { username, displayName: username, temporaryPassword: 'organization-pass-123', role });
  assert.equal(created.status, 201);
  const result = await request('/auth/login', null, 'POST', { username, password: 'organization-pass-123' });
  assert.equal(result.status, 200);
  return result.body;
}
async function grant(actor, permissions) {
  const result = await request(`/organization/members/${actor.user.id}`, owner, 'PUT', { permissions });
  assert.equal(result.status, 200, JSON.stringify(result.body));
}
async function project(actor = owner) {
  const result = await request('/projects', actor, 'POST', { title: `Organization authorization ${++sequence}`, stage: '立项沟通' });
  assert.equal(result.status, 201);
  return result.body.project;
}
async function addParticipant(target, actor) {
  const result = await request(`/projects/${target.id}/members`, owner, 'POST', { userId: actor.user.id, projectRole: 'member' });
  assert.equal(result.status, 201);
}

test.before(async () => {
  previousPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'organization-owner-123';
  directory = await mkdtemp(join(tmpdir(), 'mfggo-org-business-'));
  app = await createApp({ dbPath: join(directory, 'test.sqlite') });
  server = createServer(app.callback());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${server.address().port}`;
  owner = (await request('/auth/login', null, 'POST', { username: 'admin', password: 'organization-owner-123' })).body;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  app.close();
  await rm(directory, { recursive: true, force: true });
  if (previousPassword === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
  else process.env.INITIAL_ADMIN_PASSWORD = previousPassword;
});

test('ungranted deputies may inspect structure but cannot administer employees through either endpoint', async () => {
  const admin = await member('admin');
  const creator = await member();
  await project(creator);
  for (const actor of [admin, creator]) {
    assert.equal((await request('/organization/structure', actor)).status, actor === admin ? 200 : 403);
    assert.equal((await request('/organization/departments', actor, 'POST', { name: 'Unauthorized' })).status, 403);
    assert.equal((await request(`/organization/members/${actor.user.id}`, actor, 'PUT', { role: 'owner', permissions: { 'task.delete': true } })).status, 403);
    assert.equal((await request(`/members/${creator.user.id}/role`, actor, 'PUT', { role: 'admin' })).status, 403);
    assert.equal((await request('/members', actor, 'POST', { username: `forbidden_${++sequence}`, temporaryPassword: 'forbidden-pass', role: 'engineer' })).status, 403);
  }
  const structure = await request('/organization/structure');
  assert.equal(structure.status, 200);
  assert.ok(structure.body.permissionDefinitions.some(item => item.key === 'member.manage'));
  const permissions = (await request('/me', creator)).body.permissions;
  for (const key of ['task.delete', 'customer.read', 'project.members.manage', 'member.manage']) assert.equal(permissions[key], false);
});

test('project creation does not grant participant administration; granting and revoking affect the same session', async () => {
  const creator = await member();
  const worker = await member();
  const target = await project(creator);
  const path = `/projects/${target.id}/members`;
  const payload = { userId: worker.user.id, projectRole: 'member' };
  assert.equal((await request(path, creator, 'POST', payload)).status, 403);
  await grant(creator, { 'project.members.manage': true });
  assert.equal((await request(path, creator, 'POST', payload)).status, 201);
  await grant(creator, { 'project.members.manage': false });
  assert.equal((await request(path, creator, 'POST', payload)).status, 403);
  assert.equal((await request(`/tasks/${target.rootTaskId}/detail`, creator)).body.capabilities.canManageProjectMembers, false);
});

test('customer fields and audit values are filtered from reads and mutations without affecting stored data', async () => {
  const worker = await member();
  const admin = await member('admin');
  await grant(admin, { 'audit.read': true });
  await grant(worker, { 'customer.read': true });
  const result = await request('/tasks', owner, 'POST', {
    title: 'Customer boundary', assigneeUserId: worker.user.id,
    customerProfile: 'PRIVATE-PROFILE-OLD', customerManagement: 'PRIVATE-CUSTOMER-OLD'
  });
  assert.equal(result.status, 201);
  const id = result.body.task.id;
  assert.equal((await request(`/tasks/${id}`, owner, 'PUT', { title: 'Denied administrative edit' })).status, 403);
  assert.equal((await request(`/tasks/${id}`, worker, 'PUT', {
    customerProfile: 'PRIVATE-PROFILE-NEW', customerManagement: 'PRIVATE-CUSTOMER-NEW'
  })).status, 200);
  await grant(worker, { 'customer.read': false });
  for (const actor of [worker, admin]) {
    for (const path of [`/tasks/${id}/detail`, '/tasks', ...(actor === admin ? ['/audit'] : [])]) {
      const response = await request(path, actor);
      assert.equal(response.status, 200);
      assert.equal(JSON.stringify(response.body).includes('PRIVATE-'), false, path);
    }
  }
  const change = await request(`/tasks/${id}`, worker, 'PUT', { title: 'Still editable without customers' });
  assert.equal(change.status, 200);
  assert.equal(Object.hasOwn(change.body.task, 'customerProfile'), false);
  assert.equal((await request(`/tasks/${id}`, worker, 'PUT', { customerProfile: 'OVERWRITE' })).status, 403);
  assert.equal((await request('/tasks', worker, 'POST', { title: 'Denied write', customerManagement: 'OVERWRITE' })).status, 403);
  await grant(worker, { 'customer.read': true });
  const visible = await request(`/tasks/${id}/detail`, worker);
  assert.equal(visible.body.task.customerProfile, 'PRIVATE-PROFILE-NEW');
  assert.ok(JSON.stringify(visible.body.activities).includes('PRIVATE-PROFILE-OLD'));
  await grant(worker, { 'customer.read': false });
  const hiddenAgain = await request(`/tasks/${id}/detail`, worker);
  assert.equal(JSON.stringify(hiddenAgain.body).includes('PRIVATE-'), false);
  assert.equal(hiddenAgain.body.capabilities.canViewCustomers, false);
  assert.equal((await request(`/tasks/${id}/detail`)).body.task.customerManagement, 'PRIVATE-CUSTOMER-NEW');
});

test('deletion is separately delegated and preserves project access boundaries and editing rules', async () => {
  const executor = await member();
  const deleter = await member();
  const outsider = await member();
  const target = await project();
  const claimed = await request(`/tasks/${target.rootTaskId}`, owner, 'PUT', { assigneeUserId: owner.user.id });
  assert.equal(claimed.status, 200);
  await addParticipant(target, executor);
  await addParticipant(target, deleter);
  const created = await request(`/tasks/${target.rootTaskId}/subtasks`, owner, 'POST', { title: 'Delegated deletion', assigneeUserId: executor.user.id });
  assert.equal(created.status, 201);
  const path = `/tasks/${target.rootTaskId}/subtasks/${created.body.subtask.id}`;
  assert.equal((await request(path, executor, 'DELETE')).status, 403);
  await grant(deleter, { 'task.delete': true });
  await grant(outsider, { 'task.delete': true });
  assert.equal((await request(path, outsider, 'DELETE')).status, 403);
  const detail = await request(`${path}/detail`, deleter);
  assert.equal(detail.body.capabilities.canDelete, true);
  assert.equal(detail.body.capabilities.canEdit, false);
  assert.equal((await request(path, deleter, 'PUT', { title: 'Cannot edit' })).status, 403);
  await grant(deleter, { 'task.delete': false });
  assert.equal((await request(path, deleter, 'DELETE')).status, 403);
  await grant(deleter, { 'task.delete': true });
  assert.equal((await request(path, deleter, 'DELETE')).status, 200);
  const standalone = await request('/tasks', executor, 'POST', { title: 'Own task is not own deletion grant' });
  assert.equal(standalone.status, 201);
  const standalonePath = `/tasks/${standalone.body.task.id}`;
  assert.equal((await request(standalonePath, executor, 'DELETE')).status, 403);
  await grant(executor, { 'task.delete': true });
  assert.equal((await request(standalonePath, executor, 'DELETE')).status, 200);
});

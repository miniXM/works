import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

let fixture;
let address;
let owner;
let previousInitialAdminPassword;
let memberSequence = 0;

test.before(async () => {
  previousInitialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'admin123';
  fixture = { path: await mkdtemp(join(tmpdir(), 'machquote-member-roles-')) };
  fixture.app = await createApp({ dbPath: join(fixture.path, 'test.sqlite') });
  fixture.server = createServer(fixture.app.callback());
  await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${fixture.server.address().port}`;
  owner = await login('admin', 'admin123');
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
  return { response, body: await response.json() };
}

async function login(username, password = 'member-role-pass-123') {
  const result = await request('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password })
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return { ...result.body, headers: { authorization: `Bearer ${result.body.token}` } };
}

async function createMember(role, actor = owner) {
  const username = `role_boundary_${++memberSequence}`;
  const result = await request('/api/members', {
    method: 'POST', headers: actor.headers,
    body: JSON.stringify({ username, displayName: username, temporaryPassword: 'member-role-pass-123', role })
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  return login(username);
}

async function updateRole(actor, userId, role) {
  return request(`/api/members/${userId}/role`, {
    method: 'PUT', headers: actor.headers, body: JSON.stringify({ role })
  });
}

async function expectRole(actor, expectedRole) {
  const result = await request('/api/me', { headers: actor.headers });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.role, ['engineer', 'qa', 'viewer'].includes(expectedRole) ? 'member' : expectedRole);
}

test('admin cannot promote itself or another member to owner', async () => {
  const admin = await createMember('admin');
  const engineer = await createMember('engineer');
  for (const target of [admin, engineer]) {
    const result = await updateRole(admin, target.user.id, 'owner');
    assert.equal(result.response.status, 403);
    assert.equal(result.body.error, 'organization_permission_denied');
  }
  await expectRole(admin, 'admin');
  await expectRole(engineer, 'engineer');
});

test('admin cannot change an owner even when another owner remains', async () => {
  const admin = await createMember('admin');
  const secondOwner = await createMember('engineer');
  assert.equal((await updateRole(owner, secondOwner.user.id, 'owner')).response.status, 200);
  try {
    for (const role of ['admin', 'engineer', 'viewer', 'owner']) {
      const result = await updateRole(admin, owner.user.id, role);
      assert.equal(result.response.status, 403);
      assert.equal(result.body.error, 'organization_permission_denied');
    }
    await expectRole(owner, 'owner');
  } finally {
    assert.equal((await updateRole(owner, secondOwner.user.id, 'engineer')).response.status, 200);
  }
});

test('owner can appoint another owner and adjust its role later', async () => {
  const member = await createMember('admin');
  const promoted = await updateRole(owner, member.user.id, 'owner');
  assert.equal(promoted.response.status, 200);
  assert.equal(promoted.body.member.role, 'owner');
  await expectRole(member, 'owner');
  const demoted = await updateRole(owner, member.user.id, 'engineer');
  assert.equal(demoted.response.status, 200);
  await expectRole(member, 'engineer');
});

test('admin cannot manage member roles, including its own role', async () => {
  const admin = await createMember('admin');
  const engineer = await createMember('engineer');
  const updated = await updateRole(admin, engineer.user.id, 'qa');
  assert.equal(updated.response.status, 403);
  await expectRole(engineer, 'engineer');
  const denied = await updateRole(admin, admin.user.id, 'viewer');
  assert.equal(denied.response.status, 403);
  assert.equal(denied.body.error, 'organization_permission_denied');
  await expectRole(admin, 'admin');
});

test('owner cannot lower its own role or remove the sole owner', async () => {
  const result = await updateRole(owner, owner.user.id, 'admin');
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, 'self_role_change_denied');
  await expectRole(owner, 'owner');
});

test('ordinary members cannot manage roles', async () => {
  const target = await createMember('engineer');
  for (const role of ['engineer', 'qa', 'viewer']) {
    const actor = await createMember(role);
    for (const requestedRole of ['admin', 'owner']) {
      const result = await updateRole(actor, target.user.id, requestedRole);
      assert.equal(result.response.status, 403);
      assert.equal(result.body.error, 'organization_permission_denied');
    }
  }
  await expectRole(target, 'engineer');
});

test('member role changes remain isolated to the active organization', async () => {
  const created = await request('/api/platform/organizations', {
    method: 'POST', headers: owner.headers,
    body: JSON.stringify({ name: 'Member boundary organization', slug: 'member-role-boundaries', ownerUserId: owner.user.id })
  });
  assert.equal(created.response.status, 201);
  const switched = await request(`/api/platform/organizations/${created.body.organization.id}/switch`, {
    method: 'POST', headers: owner.headers
  });
  assert.equal(switched.response.status, 200);
  const otherOwner = { headers: { authorization: `Bearer ${switched.body.token}` } };
  const otherMember = await createMember('engineer', otherOwner);
  const localAdmin = await createMember('admin');
  for (const actor of [owner, localAdmin]) {
    const denied = await updateRole(actor, otherMember.user.id, 'admin');
    assert.equal(denied.response.status, actor === owner ? 404 : 403);
    assert.equal(denied.body.error, actor === owner ? 'member_not_found' : 'organization_permission_denied');
  }
  await expectRole(otherMember, 'engineer');
  const localMember = await createMember('engineer');
  const reverseDenied = await updateRole(otherOwner, localMember.user.id, 'admin');
  assert.equal(reverseDenied.response.status, 404);
  assert.equal(reverseDenied.body.error, 'member_not_found');
  await expectRole(localMember, 'engineer');
});

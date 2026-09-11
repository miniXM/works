import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { createDatabase } from '../server/db.js';
import { registerOrganizationRoutes } from '../server/organization-routes.js';
import { ENTERPRISE_PERMISSION_DEFINITIONS, LEGACY_ROLE_PERMISSIONS } from '../access-policy.js';

const deniedPermissions = Object.fromEntries(ENTERPRISE_PERMISSION_DEFINITIONS.map(item => [item.key, false]));
const ownerPermissions = Object.fromEntries(ENTERPRISE_PERMISSION_DEFINITIONS.map(item => [item.key, true]));
let fixture;
let previousPassword;
let memberNumber = 0;

test.before(async () => {
  previousPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'organization-test-123';
  const directory = await mkdtemp(join(tmpdir(), 'machquote-organization-'));
  fixture = { directory, dbPath: join(directory, 'test.sqlite') };
  fixture.db = await createDatabase({ dbPath: fixture.dbPath });
  fixture.ownerId = 'user_admin';
  fixture.orgId = 'org_demo';
  fixture.ownerToken = fixture.db.createSession(fixture.ownerId, fixture.orgId).token;
  const app = new Koa();
  const router = new Router({ prefix: '/api' });
  app.use(bodyParser());
  registerOrganizationRoutes(router, { db: fixture.db, requireAuth: async (ctx, next) => {
    const session = fixture.db.getSession(ctx.get('authorization').replace(/^Bearer /, ''));
    if (!session) { ctx.status = 401; ctx.body = { error: 'unauthorized' }; return; }
    ctx.state.session = session;
    await next();
  } });
  app.use(router.routes());
  app.use(router.allowedMethods());
  fixture.server = createServer(app.callback());
  await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
  fixture.address = `http://127.0.0.1:${fixture.server.address().port}/api`;
});

test.after(async () => {
  await new Promise(resolve => fixture.server.close(resolve));
  fixture.db.close();
  await rm(fixture.directory, { recursive: true, force: true });
  if (previousPassword === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
  else process.env.INITIAL_ADMIN_PASSWORD = previousPassword;
});

function member(role = 'member', organizationId = fixture.orgId) {
  const username = `organization_member_${++memberNumber}`;
  const result = fixture.db.createMember({ organizationId, username, displayName: username, password: 'test-pass-123', role });
  return { ...result, token: fixture.db.createSession(result.id, organizationId).token };
}

function department(name, parentId = null, organizationId = fixture.orgId) {
  return fixture.db.createOrganizationDepartment(organizationId, fixture.ownerId, { name, parentId });
}

async function request(path, { method = 'GET', body, token = fixture.ownerToken } = {}) {
  const response = await fetch(`${fixture.address}${path}`, {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

test('owners have implicit capabilities and management identity alone gives no business grants', () => {
  assert.deepEqual(fixture.db.getMemberPermissions(fixture.orgId, fixture.ownerId), ownerPermissions);
  assert.deepEqual(fixture.db.getMemberPermissions(fixture.orgId, 'missing-user'), deniedPermissions);
  for (const role of ['admin', 'member']) {
    const actor = member(role);
    assert.deepEqual(fixture.db.getSession(actor.token).permissions, deniedPermissions);
    if (role === 'admin') {
      assert.deepEqual(fixture.db.getOrganizationStructure(fixture.orgId, actor.id).capabilities, { canManageMembers: false, canManageDepartments: false, canAssignRoles: false });
    } else assert.throws(() => fixture.db.getOrganizationStructure(fixture.orgId, actor.id), { code: 'organization_permission_denied' });
    assert.throws(() => fixture.db.updateOrganizationMember(fixture.orgId, actor.id, actor.id, { permissions: ownerPermissions }), { code: 'organization_permission_denied' });
  }
});

test('department tree rejects cycles, duplicate siblings and nonempty deletion', () => {
  const root = department('Engineering');
  const child = department('Manufacturing', root.id);
  const grandchild = department('Machining', child.id);
  assert.throws(() => fixture.db.updateOrganizationDepartment(fixture.orgId, fixture.ownerId, root.id, { parentId: grandchild.id }), { code: 'department_cycle' });
  assert.throws(() => fixture.db.updateOrganizationDepartment(fixture.orgId, fixture.ownerId, root.id, { parentId: root.id }), { code: 'department_cycle' });
  assert.throws(() => department('engineering'), { code: 'department_name_conflict' });
  assert.throws(() => fixture.db.deleteOrganizationDepartment(fixture.orgId, fixture.ownerId, child.id), { code: 'department_not_empty' });
  const target = member();
  fixture.db.updateOrganizationMember(fixture.orgId, fixture.ownerId, target.id, { departmentId: grandchild.id, jobTitle: 'Operator' });
  assert.throws(() => fixture.db.deleteOrganizationDepartment(fixture.orgId, fixture.ownerId, grandchild.id), { code: 'department_not_empty' });
  fixture.db.updateOrganizationMember(fixture.orgId, fixture.ownerId, target.id, { departmentId: null });
  assert.equal(fixture.db.deleteOrganizationDepartment(fixture.orgId, fixture.ownerId, grandchild.id), true);
  const moved = fixture.db.updateOrganizationDepartment(fixture.orgId, fixture.ownerId, child.id, { name: 'Production', parentId: null });
  assert.deepEqual(moved, { id: child.id, name: 'Production', parentId: null });
});

test('department and membership mutations remain isolated to the active organization', () => {
  const other = fixture.db.createOrganization({ name: 'Other enterprise', slug: 'organization-access-other', ownerUserId: fixture.ownerId });
  const otherDepartment = department('Other department', null, other.id);
  const localDepartment = department('Local department');
  const target = member();
  const otherTarget = member('member', other.id);
  for (const operation of [
    () => department('Invalid child', otherDepartment.id),
    () => fixture.db.updateOrganizationDepartment(fixture.orgId, fixture.ownerId, localDepartment.id, { parentId: otherDepartment.id }),
    () => fixture.db.updateOrganizationDepartment(fixture.orgId, fixture.ownerId, otherDepartment.id, { name: 'Stolen' }),
    () => fixture.db.deleteOrganizationDepartment(fixture.orgId, fixture.ownerId, otherDepartment.id),
    () => fixture.db.updateOrganizationMember(fixture.orgId, fixture.ownerId, target.id, { departmentId: otherDepartment.id })
  ]) assert.throws(operation, { code: 'department_not_found' });
  assert.throws(() => fixture.db.updateOrganizationMember(fixture.orgId, fixture.ownerId, otherTarget.id, { permissions: ownerPermissions }), { code: 'member_not_found' });
  fixture.db.updateOrganizationMember(other.id, fixture.ownerId, otherTarget.id, { permissions: { 'customer.read': true } });
  assert.equal(fixture.db.getMemberPermissions(fixture.orgId, otherTarget.id)['customer.read'], false);
  assert.equal(fixture.db.getMemberPermissions(other.id, otherTarget.id)['customer.read'], true);
});

test('delegations and revocations affect existing sessions immediately', () => {
  const target = member('admin');
  fixture.db.updateOrganizationMember(fixture.orgId, fixture.ownerId, target.id, { permissions: { 'task.delete': true, 'customer.read': true } });
  assert.deepEqual(fixture.db.getSession(target.token).permissions, { ...deniedPermissions, 'task.delete': true, 'customer.read': true });
  fixture.db.updateOrganizationMember(fixture.orgId, fixture.ownerId, target.id, { permissions: { 'task.delete': false } });
  assert.deepEqual(fixture.db.getSession(target.token).permissions, { ...deniedPermissions, 'customer.read': true });
  assert.equal(fixture.db.getSession(target.token).role, 'admin');
});

test('invalid authorization is rejected atomically with role and personnel changes', () => {
  const target = member();
  const assigned = department('Validation department');
  const beforeAudit = fixture.db.listAudit(fixture.orgId).length;
  for (const permissions of [{ unknown: true }, { 'task.delete': 1 }, { 'customer.read': 'true' }, null, []]) {
    assert.throws(() => fixture.db.updateOrganizationMember(fixture.orgId, fixture.ownerId, target.id, {
      role: 'admin', departmentId: assigned.id, jobTitle: 'Lead', permissions
    }));
    const result = fixture.db.getOrganizationStructure(fixture.orgId, fixture.ownerId).members.find(item => item.id === target.id);
    assert.equal(result.role, 'member');
    assert.equal(result.departmentId, null);
    assert.equal(result.jobTitle, '');
  }
  assert.equal(fixture.db.listAudit(fixture.orgId).length, beforeAudit);
});

test('owner permissions cannot be revoked and an owner cannot demote itself', () => {
  assert.throws(() => fixture.db.updateOrganizationMember(fixture.orgId, fixture.ownerId, fixture.ownerId, { permissions: { 'task.delete': false } }), { code: 'self_authorization_change_denied' });
  assert.throws(() => fixture.db.updateOrganizationMember(fixture.orgId, fixture.ownerId, fixture.ownerId, { role: 'admin' }), { code: 'self_role_change_denied' });
  const second = member();
  fixture.db.updateOrganizationMember(fixture.orgId, fixture.ownerId, second.id, { role: 'owner', permissions: ownerPermissions, jobTitle: 'Director' });
  assert.equal(fixture.db.getSession(second.token).role, 'owner');
  assert.deepEqual(fixture.db.getSession(second.token).permissions, ownerPermissions);
  fixture.db.updateOrganizationMember(fixture.orgId, fixture.ownerId, second.id, { role: 'member' });
  assert.deepEqual(fixture.db.getSession(second.token).permissions, deniedPermissions);
});

test('audit failure rolls back department, membership and grant writes', () => {
  const target = member();
  const previousAddAudit = fixture.db.addAudit;
  const assigned = department('Atomic department');
  try {
    fixture.db.addAudit = () => { throw new Error('audit failure'); };
    assert.throws(() => department('Rolled back'), /audit failure/);
    assert.throws(() => fixture.db.updateOrganizationMember(fixture.orgId, fixture.ownerId, target.id, {
      role: 'admin', departmentId: assigned.id, jobTitle: 'Lead', permissions: ownerPermissions
    }), /audit failure/);
    assert.throws(() => fixture.db.deleteOrganizationDepartment(fixture.orgId, fixture.ownerId, assigned.id), /audit failure/);
  } finally { fixture.db.addAudit = previousAddAudit; }
  const structure = fixture.db.getOrganizationStructure(fixture.orgId, fixture.ownerId);
  assert.equal(structure.departments.some(item => item.name === 'Rolled back'), false);
  assert.equal(structure.departments.some(item => item.id === assigned.id), true);
  const unchanged = structure.members.find(item => item.id === target.id);
  assert.equal(unchanged.role, 'member');
  assert.equal(unchanged.departmentId, null);
  assert.equal(unchanged.jobTitle, '');
  assert.deepEqual(unchanged.permissions, deniedPermissions);
});

test('organization endpoints enforce authorization and return the frontend contract', async () => {
  const target = member('member');
  for (const [method, path, body] of [
    ['GET', '/organization/structure'],
    ['POST', '/organization/departments', { name: 'Forbidden' }],
    ['PUT', '/organization/departments/missing', { name: 'Forbidden' }],
    ['DELETE', '/organization/departments/missing'],
    ['PUT', `/organization/members/${target.id}`, { permissions: ownerPermissions }]
  ]) {
    const denied = await request(path, { method, body, token: target.token });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'organization_permission_denied');
  }
  assert.equal((await request('/organization/structure', { token: '' })).status, 401);
  const created = await request('/organization/departments', { method: 'POST', body: { name: 'API department' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.department.parentId, null);
  const updated = await request(`/organization/members/${target.id}`, {
    method: 'PUT', body: { departmentId: created.body.department.id, jobTitle: 'QA', permissions: { 'customer.read': true } }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.member.permissions['customer.read'], true);
  const structure = await request('/organization/structure');
  assert.equal(structure.status, 200);
  assert.equal(structure.body.organization.id, fixture.orgId);
  assert.deepEqual(structure.body.permissionDefinitions.map(item => item.key), Object.keys(deniedPermissions));
  assert.ok(structure.body.members.find(item => item.id === target.id)?.departmentId);
});

test('legacy databases explicitly retain former business capabilities without inventing management grants', async () => {
  const dbPath = join(fixture.directory, 'legacy.sqlite');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`CREATE TABLE organizations(id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE memberships(id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(organization_id,user_id));
    INSERT INTO organizations VALUES('legacy-org', 'legacy', 'Legacy', '2020-01-01');
    INSERT INTO users VALUES('legacy-admin', 'legacy-admin', '', 'Legacy admin', '2020-01-01');
    INSERT INTO memberships VALUES('legacy-membership', 'legacy-org', 'legacy-admin', 'admin', '2020-01-01');`);
  legacy.close();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const upgraded = await createDatabase({ dbPath });
    try {
      assert.equal(upgraded.getMembership('legacy-admin', 'legacy-org').role, 'admin');
      assert.equal(upgraded.getMembership('legacy-admin', 'legacy-org').department_id, null);
      assert.equal(upgraded.getMembership('legacy-admin', 'legacy-org').job_title, '');
      assert.deepEqual(upgraded.getMemberPermissions('legacy-org', 'legacy-admin'), { ...deniedPermissions, ...Object.fromEntries(LEGACY_ROLE_PERMISSIONS.admin.map(key => [key, true])) });
      assert.equal(upgraded.countOwners('legacy-org'), 0);
    } finally { upgraded.close(); }
  }
});

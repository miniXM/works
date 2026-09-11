import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { createDatabase } from '../server/db.js';
import { registerOrganizationRoutes } from '../server/organization-routes.js';
import { LEGACY_ROLE_PERMISSIONS } from '../access-policy.js';

let db;
let directory;
let dbPath;
let previousPassword;
let number = 0;
const orgId = 'org_demo';
const ownerId = 'user_admin';
const member = (role = 'member') => db.createMember({ organizationId: orgId, username: `hierarchy_${++number}`, displayName: `Member ${number}`, password: 'test-pass-123', role });
const update = (userId, input, actorId = ownerId) => db.updateOrganizationMember(orgId, actorId, userId, input);
const tokenFor = userId => db.createSession(userId, orgId).token;
const authorizeDeputy = deputy => update(deputy.id, { role: 'admin', permissions: {
  'member.manage': true, 'department.manage': true, 'task.delete': true, 'customer.read': true
}, grantablePermissions: { 'task.delete': true, 'customer.read': true } });

test.before(async () => {
  previousPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'hierarchy-test-123';
  directory = await mkdtemp(join(tmpdir(), 'machquote-hierarchy-'));
  dbPath = join(directory, 'test.sqlite');
  db = await createDatabase({ dbPath });
});
test.after(async () => {
  db.close();
  await rm(directory, { recursive: true, force: true });
  if (previousPassword === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
  else process.env.INITIAL_ADMIN_PASSWORD = previousPassword;
});

test('a deputy can administer only employee profiles and business grants within its assigned scope', () => {
  const deputy = member('admin');
  const employee = member();
  const peer = member('admin');
  assert.throws(() => update(employee.id, { displayName: 'Changed' }, deputy.id), { code: 'organization_permission_denied' });
  authorizeDeputy(deputy);
  const department = db.createOrganizationDepartment(orgId, deputy.id, { name: 'Deputy managed department' });
  const changed = update(employee.id, { displayName: 'Updated name', departmentId: department.id, jobTitle: 'Engineer', permissions: { 'customer.read': true } }, deputy.id);
  assert.equal(changed.displayName, 'Updated name');
  assert.equal(changed.departmentId, department.id);
  assert.equal(changed.role, 'member');
  assert.equal(changed.permissions['customer.read'], true);
  update(employee.id, { permissions: { 'customer.read': false } }, deputy.id);
  assert.equal(db.getMemberPermissions(orgId, employee.id)['customer.read'], false);
  for (const target of [deputy.id, peer.id, ownerId]) assert.throws(() => update(target, { displayName: 'Forbidden' }, deputy.id), { code: 'member_edit_denied' });
  for (const input of [{ role: 'admin' }, { role: 'member' }, { grantablePermissions: {} }]) {
    assert.throws(() => update(employee.id, input, deputy.id), { code: 'role_assignment_denied' });
  }
  assert.throws(() => update(employee.id, { permissions: { 'quote.write': true } }, deputy.id), { code: 'grant_scope_exceeded' });
  assert.throws(() => update(employee.id, { permissions: { 'quote.write': false } }, deputy.id), { code: 'grant_scope_exceeded' });
  const structure = db.getOrganizationStructure(orgId, deputy.id);
  assert.deepEqual(structure.capabilities, { canManageMembers: true, canManageDepartments: true, canAssignRoles: false });
  assert.equal(structure.members.find(item => item.id === employee.id).canEdit, true);
  assert.equal(structure.members.find(item => item.id === peer.id).canEdit, false);
  assert.equal(structure.actor.grantablePermissions['customer.read'], true);
});

test('management capabilities cannot be assigned to employees or delegated onward', () => {
  const employee = member();
  const deputy = member('admin');
  assert.throws(() => update(employee.id, { permissions: { 'member.manage': true } }), { code: 'management_role_required' });
  assert.throws(() => update(deputy.id, { permissions: { 'member.manage': true }, grantablePermissions: { 'member.manage': true } }), { code: 'invalid_grantable_permissions' });
  assert.equal(db.getMemberPermissions(orgId, deputy.id)['member.manage'], false);
  assert.throws(() => update(deputy.id, { grantablePermissions: { 'task.delete': true } }), { code: 'invalid_grantable_permissions' });
  authorizeDeputy(deputy);
  assert.throws(() => update(employee.id, { permissions: { 'department.manage': true } }, deputy.id), { code: 'management_role_required' });
  update(deputy.id, { role: 'member' });
  assert.equal(db.getMemberPermissions(orgId, deputy.id)['member.manage'], false);
  assert.equal(db.getMemberGrantablePermissions(orgId, deputy.id)['task.delete'], false);
  assert.equal(db.getMemberPermissions(orgId, deputy.id)['task.delete'], true);
});

test('deputy grants track their grantor immediately while owner direct grants remain independent', () => {
  const deputy = member('admin');
  const delegated = member();
  const direct = member();
  authorizeDeputy(deputy);
  const delegatedToken = tokenFor(delegated.id);
  update(delegated.id, { permissions: { 'task.delete': true, 'customer.read': true } }, deputy.id);
  update(direct.id, { permissions: { 'task.delete': true } });
  const raw = new DatabaseSync(dbPath);
  try {
    assert.equal(raw.prepare('SELECT delegated_by_user_id FROM organization_member_permissions WHERE organization_id = ? AND user_id = ? AND permission_key = ?').get(orgId, delegated.id, 'task.delete').delegated_by_user_id, deputy.id);
  } finally { raw.close(); }
  assert.equal(db.getSession(delegatedToken).permissions['task.delete'], true);
  update(deputy.id, { grantablePermissions: { 'task.delete': false } });
  assert.equal(db.getSession(delegatedToken).permissions['task.delete'], false);
  assert.equal(db.getSession(delegatedToken).permissions['customer.read'], true);
  assert.equal(db.getMemberPermissions(orgId, direct.id)['task.delete'], true);
  update(deputy.id, { grantablePermissions: { 'task.delete': true } });
  update(deputy.id, { permissions: { 'member.manage': false } });
  assert.equal(db.getSession(delegatedToken).permissions['customer.read'], false);
  update(deputy.id, { permissions: { 'member.manage': true } });
  update(deputy.id, { permissions: { 'task.delete': false } });
  assert.equal(db.getSession(delegatedToken).permissions['task.delete'], false);
  update(deputy.id, { permissions: { 'task.delete': true } });
  assert.equal(db.getSession(delegatedToken).permissions['task.delete'], false);
  update(delegated.id, { permissions: { 'customer.read': true } });
  update(deputy.id, { role: 'member' });
  assert.equal(db.getSession(delegatedToken).permissions['task.delete'], false);
  assert.equal(db.getSession(delegatedToken).permissions['customer.read'], true);
});

test('invalid grants and failed audits roll back profiles, roles, grants and user creation together', () => {
  const employee = member();
  const before = db.getMemberProfile(orgId, employee.id).member;
  const auditCount = db.listAudit(orgId).length;
  for (const grantablePermissions of [{ 'task.delete': true }, { unknown: true }, { 'customer.read': 1 }, null]) {
    assert.throws(() => update(employee.id, { role: 'admin', displayName: 'Must roll back', permissions: { 'customer.read': true }, grantablePermissions }));
    assert.deepEqual(db.getMemberProfile(orgId, employee.id).member, before);
  }
  assert.equal(db.listAudit(orgId).length, auditCount);
  const oldAudit = db.addAudit;
  const username = `rollback_${++number}`;
  try {
    db.addAudit = () => { throw new Error('audit unavailable'); };
    assert.throws(() => db.createOrganizationMember(orgId, ownerId, { username, displayName: 'Must roll back', temporaryPassword: 'test-pass-123', role: 'admin' }), /audit unavailable/);
    assert.throws(() => db.updateMemberProfile(orgId, employee.id, { displayName: 'Must roll back' }), /audit unavailable/);
    assert.throws(() => update(employee.id, { role: 'admin', permissions: { 'customer.read': true }, grantablePermissions: { 'customer.read': true } }), /audit unavailable/);
  } finally { db.addAudit = oldAudit; }
  assert.equal(db.authenticate(username, 'test-pass-123'), null);
  assert.deepEqual(db.getMemberProfile(orgId, employee.id).member, before);
});

test('employee profile names are tenant scoped and changing job titles never changes authority', () => {
  const employee = member();
  const token = tokenFor(employee.id);
  const other = db.createOrganization({ name: 'Profile other enterprise', slug: `profile-other-${++number}`, ownerUserId: employee.id });
  const otherToken = db.createSession(employee.id, other.id).token;
  const localDepartment = db.createOrganizationDepartment(orgId, ownerId, { name: 'Profile department' });
  const otherDepartment = db.createOrganizationDepartment(other.id, employee.id, { name: 'Other profile department' });
  const beforePermissions = db.getMemberPermissions(orgId, employee.id);
  const updated = db.updateMemberProfile(orgId, employee.id, { displayName: 'Local name', departmentId: localDepartment.id, jobTitle: 'Administrator' });
  assert.equal(updated.role, 'member');
  assert.deepEqual(updated.permissions, beforePermissions);
  assert.equal(db.getSession(token).user.displayName, 'Local name');
  assert.equal(db.getSession(otherToken).user.displayName, employee.displayName);
  assert.equal(db.authenticate(employee.username, 'test-pass-123').user.displayName, 'Local name');
  assert.equal(db.listMembers(orgId).find(item => item.id === employee.id).displayName, 'Local name');
  assert.throws(() => db.updateMemberProfile(orgId, employee.id, { departmentId: otherDepartment.id }), { code: 'department_not_found' });
  for (const input of [{ role: 'owner' }, { permissions: { 'task.delete': true } }, { grantablePermissions: {} }, { username: 'changed' }]) {
    assert.throws(() => db.updateMemberProfile(orgId, employee.id, input), { code: 'invalid_request' });
  }
  update(employee.id, { displayName: 'Manager corrected name', jobTitle: 'Engineer' });
  assert.equal(db.getSession(token).user.displayName, 'Manager corrected name');
  assert.equal(db.getSession(otherToken).user.displayName, employee.displayName);
});

test('new employee accounts have no business grants and deputy creation cannot smuggle legacy privilege templates', () => {
  const deputy = member('admin');
  authorizeDeputy(deputy);
  const employee = db.createOrganizationMember(orgId, deputy.id, { username: `new_employee_${++number}`, displayName: 'New employee', temporaryPassword: 'test-pass-123' });
  assert.equal(employee.role, 'member');
  assert.equal(Object.values(employee.permissions).some(Boolean), false);
  assert.throws(() => db.createOrganizationMember(orgId, deputy.id, { username: `new_deputy_${++number}`, displayName: 'Forbidden', temporaryPassword: 'test-pass-123', role: 'admin' }), { code: 'role_assignment_denied' });
  assert.throws(() => db.createOrganizationMember(orgId, deputy.id, { username: `old_engineer_${++number}`, displayName: 'Forbidden', temporaryPassword: 'test-pass-123', role: 'engineer' }), { code: 'grant_scope_exceeded' });
  for (const alias of ['engineer', 'qa', 'viewer']) {
    const legacy = member(alias);
    assert.equal(legacy.role, 'member');
    assert.deepEqual(Object.keys(legacy.permissions).filter(key => legacy.permissions[key]).sort(), [...LEGACY_ROLE_PERMISSIONS[alias]].sort());
  }
});

test('tenant rename updates current task identities without rewriting historical event snapshots', () => {
  const employee = member();
  const project = db.createProject({ organizationId: orgId, userId: employee.id, ownerUserId: employee.id, title: 'Profile projection', stage: '立项沟通' });
  db.updateTask(orgId, project.rootTaskId, { owner: employee.displayName, assigneeUserId: employee.id });
  const subtask = db.createTaskSubtask({ organizationId: orgId, taskId: project.rootTaskId, userId: employee.id, assigneeUserId: employee.id, title: 'Subtask profile' });
  const historyBefore = db.listTaskHistory(orgId, project.rootTaskId);
  db.updateMemberProfile(orgId, employee.id, { displayName: 'Enterprise display name' });
  assert.equal(db.getTask(orgId, project.rootTaskId).owner, 'Enterprise display name');
  assert.equal(db.getProject(orgId, project.id).owner, 'Enterprise display name');
  assert.equal(db.listProjectMembers(orgId, project.id).find(item => item.id === employee.id).displayName, 'Enterprise display name');
  assert.equal(db.getTaskSubtask(orgId, project.rootTaskId, subtask.id).assigneeDisplayName, 'Enterprise display name');
  const comment = db.createTaskComment({ organizationId: orgId, taskId: project.rootTaskId, userId: employee.id, body: 'Current author' });
  assert.equal(comment.displayName, 'Enterprise display name');
  assert.deepEqual(db.listTaskHistory(orgId, project.rootTaskId), historyBefore);
  db.updateProject(orgId, project.id, { stage: '内部报价' }, { actorUserId: employee.id });
  const event = db.listTaskHistory(orgId, project.rootTaskId)[0];
  assert.equal(event.actorName, 'Enterprise display name');
  assert.equal(event.assigneeName, 'Enterprise display name');
  assert.equal(db.listTaskHistory(orgId, project.rootTaskId).at(-1).assigneeName, '', '未分配时写入的历史快照不应被后续改名补写');
});

test('profile endpoints reject authorization fields and organization mutations use live delegated capabilities', async () => {
  const deputy = member('admin');
  const employee = member();
  const deputyToken = tokenFor(deputy.id);
  const employeeToken = tokenFor(employee.id);
  const app = new Koa();
  const router = new Router({ prefix: '/api' });
  app.use(bodyParser());
  registerOrganizationRoutes(router, { db, requireAuth: async (ctx, next) => {
    const session = db.getSession(ctx.get('authorization').replace(/^Bearer /, ''));
    if (!session) { ctx.status = 401; return; }
    ctx.state.session = session;
    await next();
  } });
  app.use(router.routes());
  const server = createServer(app.callback());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = (path, token, method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
  });
  try {
    const profile = await (await request('/me/profile', employeeToken)).json();
    assert.equal(profile.member.id, employee.id);
    assert.ok(Array.isArray(profile.departments));
    assert.equal((await request('/me/profile', employeeToken, 'PUT', { role: 'owner' })).status, 400);
    const saved = await (await request('/me/profile', employeeToken, 'PUT', { displayName: 'Self edited' })).json();
    assert.equal(saved.member.displayName, 'Self edited');
    assert.equal((await request(`/organization/members/${employee.id}`, deputyToken, 'PUT', { displayName: 'Deputy edited' })).status, 403);
    authorizeDeputy(deputy);
    assert.equal((await request(`/organization/members/${employee.id}`, deputyToken, 'PUT', { displayName: 'Deputy edited' })).status, 200);
    update(deputy.id, { permissions: { 'member.manage': false } });
    assert.equal((await request(`/organization/members/${employee.id}`, deputyToken, 'PUT', { displayName: 'Forbidden' })).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('one-time legacy role migration preserves grants and does not restore revoked permissions after reopening', async () => {
  const path = join(directory, 'legacy-hierarchy.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE organizations(id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE memberships(id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(organization_id,user_id));
    CREATE TABLE organization_member_permissions(organization_id TEXT NOT NULL, user_id TEXT NOT NULL, permission_key TEXT NOT NULL CHECK(permission_key IN ('task.delete','customer.read','project.members.manage')), enabled INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(organization_id,user_id,permission_key), FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id));
    INSERT INTO organizations VALUES('legacy-org','legacy-hierarchy','Legacy','2020-01-01');`);
  for (const role of ['engineer', 'qa', 'viewer', 'admin']) {
    legacy.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(role, role, '', role, '2020-01-01');
    legacy.prepare('INSERT INTO memberships VALUES(?,?,?,?,?)').run(`membership-${role}`, 'legacy-org', role, role, '2020-01-01');
  }
  legacy.exec("INSERT INTO organization_member_permissions VALUES('legacy-org','engineer','task.delete',1,'2020-01-01')");
  legacy.close();
  let upgraded = await createDatabase({ dbPath: path });
  assert.equal(upgraded.getMembership('engineer', 'legacy-org').role, 'member');
  assert.equal(upgraded.getMembership('engineer', 'legacy-org').job_title, '工程师');
  assert.equal(upgraded.getMemberPermissions('legacy-org', 'engineer')['task.delete'], true);
  assert.equal(upgraded.getMemberPermissions('legacy-org', 'engineer')['quote.write'], true);
  assert.equal(upgraded.getMemberPermissions('legacy-org', 'admin')['member.manage'], false);
  assert.equal(upgraded.getMemberPermissions('legacy-org', 'admin')['stats.read'], true);
  upgraded.close();
  const edit = new DatabaseSync(path);
  edit.exec("UPDATE organization_member_permissions SET enabled = 0 WHERE organization_id = 'legacy-org' AND user_id = 'engineer' AND permission_key = 'quote.write'; UPDATE organization_member_permissions SET enabled = 0 WHERE organization_id = 'legacy-org' AND user_id = 'admin' AND permission_key = 'stats.read'");
  edit.close();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    upgraded = await createDatabase({ dbPath: path });
    assert.equal(upgraded.getMemberPermissions('legacy-org', 'engineer')['quote.write'], false);
    assert.equal(upgraded.getMemberPermissions('legacy-org', 'admin')['stats.read'], false);
    assert.equal(upgraded.getMemberPermissions('legacy-org', 'engineer')['task.delete'], true);
    upgraded.close();
  }
});

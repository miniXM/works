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

let db;
let directory;
let dbPath;
let previousPassword;
let number = 0;
const orgId = 'org_demo';
const ownerId = 'user_admin';
const member = (role = 'member', managerUserId, organizationId = orgId) => db.createMember({
  organizationId, username: `chart_${++number}`, displayName: `Chart member ${number}`, password: 'chart-test-123', role,
  ...(managerUserId === undefined ? {} : { managerUserId })
});
const update = (userId, input, actorId = ownerId) => db.updateOrganizationMember(orgId, actorId, userId, input);
const ids = chart => chart.members.map(item => item.id).sort();
const authorizeDeputy = deputy => update(deputy.id, { permissions: { 'member.manage': true } });
const newAccount = (actorUserId, values = {}) => db.createOrganizationMember(orgId, actorUserId, {
  username: `chart_account_${++number}`, displayName: `New chart member ${number}`, temporaryPassword: 'chart-test-123', ...values
});

test.before(async () => {
  previousPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'chart-test-123';
  directory = await mkdtemp(join(tmpdir(), 'machquote-chart-'));
  dbPath = join(directory, 'chart.sqlite');
  db = await createDatabase({ dbPath });
});
test.after(async () => {
  db.close();
  await rm(directory, { recursive: true, force: true });
  if (previousPassword === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
  else process.env.INITIAL_ADMIN_PASSWORD = previousPassword;
});

test('the chart includes only the immediate manager, self and every descendant, with minimized fields', () => {
  const deputy = member('admin');
  const lead = member('member', deputy.id);
  const child = member('member', lead.id);
  const leaf = member('member', child.id);
  const branch = member('member', lead.id);
  const sibling = member('member', deputy.id);
  const outsider = member();
  const department = db.createOrganizationDepartment(orgId, ownerId, { name: 'Chart engineering' });
  update(lead.id, { departmentId: department.id, jobTitle: 'Team lead', permissions: { 'customer.read': true } });
  const chart = db.getOrganizationChart(orgId, lead.id);
  assert.deepEqual(ids(chart), [deputy.id, lead.id, child.id, leaf.id, branch.id].sort());
  assert.equal(chart.currentUserId, lead.id);
  assert.deepEqual(Object.keys(chart.organization).sort(), ['id', 'name']);
  assert.deepEqual(chart.capabilities, { canManageMembers: false });
  assert.equal(chart.members.find(item => item.id === deputy.id).managerUserId, null);
  assert.equal(chart.members.find(item => item.id === lead.id).managerUserId, deputy.id);
  assert.equal(chart.members.find(item => item.id === lead.id).departmentName, department.name);
  assert.equal(chart.members.find(item => item.id === lead.id).jobTitle, 'Team lead');
  for (const item of chart.members) {
    assert.deepEqual(Object.keys(item).sort(), ['id', 'username', 'displayName', 'role', 'jobTitle', 'departmentId', 'departmentName', 'managerUserId'].sort());
    assert.ok(item.managerUserId === null || chart.members.some(manager => manager.id === item.managerUserId));
  }
  const serialized = JSON.stringify(chart);
  for (const hiddenId of [ownerId, sibling.id, outsider.id]) assert.equal(serialized.includes(hiddenId), false);
  assert.deepEqual(ids(db.getOrganizationChart(orgId, leaf.id)), [child.id, leaf.id].sort());
});

test('owners and members with no assigned manager see only their own reporting tree', () => {
  const secondOwner = member('owner');
  const employee = member('member', secondOwner.id);
  assert.deepEqual(ids(db.getOrganizationChart(orgId, secondOwner.id)), [secondOwner.id, employee.id].sort());
  assert.equal(ids(db.getOrganizationChart(orgId, ownerId)).includes(secondOwner.id), false);
  const root = member('member', null);
  assert.deepEqual(ids(db.getOrganizationChart(orgId, root.id)), [root.id]);
  assert.deepEqual(db.getOrganizationChart(orgId, secondOwner.id).capabilities, { canManageMembers: true });
});

test('recursive chart scope follows deep employee reporting chains without granting authority', () => {
  const root = member('member', null);
  const expected = [root.id];
  let parentId = root.id;
  for (let index = 0; index < 24; index += 1) {
    parentId = member('member', parentId).id;
    expected.push(parentId);
  }
  assert.deepEqual(ids(db.getOrganizationChart(orgId, root.id)), expected.sort());
  assert.equal(Object.values(db.getMemberPermissions(orgId, root.id)).some(Boolean), false);
  assert.throws(() => update(parentId, { managerUserId: root.id }, root.id), { code: 'organization_permission_denied' });
  assert.throws(() => db.updateMemberProfile(orgId, root.id, { managerUserId: ownerId }), { code: 'invalid_request' });
});

test('reporting assignments reject cycles, invalid roles and unknown or foreign managers atomically', () => {
  const deputy = member('admin');
  const employee = member('member', deputy.id);
  const child = member('member', employee.id);
  const other = db.createOrganization({ name: 'Chart other', slug: `chart-other-${++number}`, ownerUserId: ownerId });
  const foreign = member('admin', undefined, other.id);
  const before = db.getMemberProfile(orgId, employee.id).member;
  for (const managerUserId of [employee.id, child.id]) {
    assert.throws(() => update(employee.id, { managerUserId, displayName: 'Must roll back' }), { code: 'reporting_cycle' });
    assert.deepEqual(db.getMemberProfile(orgId, employee.id).member, before);
  }
  for (const managerUserId of ['missing-user', foreign.id]) assert.throws(() => update(employee.id, { managerUserId }), { code: 'manager_not_found' });
  for (const managerUserId of [5, {}, [], true, ' '.repeat(2), 'x'.repeat(101)]) assert.throws(() => update(employee.id, { managerUserId }), { code: 'invalid_manager' });
  assert.throws(() => update(ownerId, { managerUserId: deputy.id }), { code: 'owner_manager_denied' });
  assert.throws(() => update(deputy.id, { managerUserId: child.id }), { code: 'invalid_manager_role' });
  assert.throws(() => db.getOrganizationChart(other.id, employee.id), { code: 'organization_permission_denied' });
  assert.equal(JSON.stringify(db.getOrganizationChart(orgId, deputy.id)).includes(foreign.id), false);
});

test('deputies can reparent only employees already inside their own subtree', () => {
  const deputy = member('admin');
  const employee = member('member', deputy.id);
  const teamLead = member('member', deputy.id);
  const outsider = member();
  const peer = member('admin');
  assert.throws(() => update(employee.id, { managerUserId: teamLead.id }, deputy.id), { code: 'organization_permission_denied' });
  authorizeDeputy(deputy);
  assert.equal(db.getOrganizationChart(orgId, deputy.id).capabilities.canManageMembers, true);
  assert.equal(update(employee.id, { managerUserId: teamLead.id }, deputy.id).managerUserId, teamLead.id);
  for (const [target, managerUserId] of [[outsider.id, deputy.id], [employee.id, peer.id], [employee.id, ownerId], [employee.id, null]]) {
    assert.throws(() => update(target, { managerUserId }, deputy.id), { code: 'reporting_scope_denied' });
  }
  for (const target of [deputy.id, peer.id, ownerId]) assert.throws(() => update(target, { managerUserId: deputy.id }, deputy.id), { code: 'member_edit_denied' });
  assert.equal(update(employee.id, { managerUserId: peer.id }).managerUserId, peer.id);
  // Reporting scope does not redefine the existing business permission policy.
  assert.equal(update(outsider.id, { displayName: 'Updated profile' }, deputy.id).displayName, 'Updated profile');
});

test('creation defaults to the creator, internal creation defaults to an owner, and invalid assignment leaves no account', () => {
  const deputy = member('admin');
  authorizeDeputy(deputy);
  assert.equal(deputy.managerUserId, ownerId);
  const created = newAccount(deputy.id);
  assert.equal(created.managerUserId, deputy.id);
  assert.equal(newAccount(ownerId).managerUserId, ownerId);
  assert.equal(newAccount(deputy.id, { managerUserId: created.id }).managerUserId, created.id);
  assert.throws(() => newAccount(deputy.id, { managerUserId: ownerId }), { code: 'reporting_scope_denied' });
  assert.throws(() => newAccount(deputy.id, { role: 'admin' }), { code: 'role_assignment_denied' });
  const username = `invalid_chart_${++number}`;
  assert.throws(() => newAccount(ownerId, { username, managerUserId: 'missing' }), { code: 'manager_not_found' });
  assert.equal(db.authenticate(username, 'chart-test-123'), null);
});

test('role transitions preserve valid reporting relationships and owner roots', () => {
  const upperDeputy = member('admin');
  const lowerDeputy = member('admin', upperDeputy.id);
  const employee = member('member', lowerDeputy.id);
  assert.throws(() => update(upperDeputy.id, { role: 'member' }), { code: 'reporting_role_conflict' });
  update(lowerDeputy.id, { managerUserId: ownerId });
  assert.equal(update(upperDeputy.id, { role: 'member' }).role, 'member');
  assert.equal(update(lowerDeputy.id, { role: 'owner' }).managerUserId, null);
  assert.deepEqual(ids(db.getOrganizationChart(orgId, lowerDeputy.id)), [lowerDeputy.id, employee.id].sort());
  assert.equal(update(lowerDeputy.id, { role: 'admin' }).managerUserId, ownerId);
  const subordinate = member('member', upperDeputy.id);
  assert.throws(() => update(subordinate.id, { role: 'admin' }), { code: 'invalid_manager_role' });
  assert.equal(update(subordinate.id, { role: 'admin', managerUserId: ownerId }).managerUserId, ownerId);
});

test('a failed audit rolls back a reporting move and creation', () => {
  const employee = member();
  const manager = member('admin');
  const originalAudit = db.addAudit;
  const username = `audit_chart_${++number}`;
  try {
    db.addAudit = () => { throw new Error('audit unavailable'); };
    assert.throws(() => update(employee.id, { managerUserId: manager.id }), /audit unavailable/);
    assert.throws(() => newAccount(ownerId, { username, managerUserId: manager.id }), /audit unavailable/);
  } finally { db.addAudit = originalAudit; }
  assert.equal(db.getMemberProfile(orgId, employee.id).member.managerUserId, ownerId);
  assert.equal(db.authenticate(username, 'chart-test-123'), null);
});

test('the HTTP chart route uses only the authenticated organization and user even when a target is supplied', async () => {
  const deputy = member('admin');
  const employee = member('member', deputy.id);
  const descendant = member('member', employee.id);
  const token = db.createSession(employee.id, orgId).token;
  const app = new Koa();
  const router = new Router({ prefix: '/api' });
  app.use(bodyParser());
  registerOrganizationRoutes(router, { db, requireAuth: async (ctx, next) => {
    const session = db.getSession(ctx.get('authorization').replace(/^Bearer /, ''));
    if (!session) { ctx.status = 401; ctx.body = { error: 'unauthorized' }; return; }
    ctx.state.session = session;
    await next();
  } });
  app.use(router.routes());
  const server = createServer(app.callback());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/organization/tree`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(`${url}?userId=${ownerId}&organizationId=other&depth=all`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.currentUserId, employee.id);
    assert.deepEqual(ids(result), [deputy.id, employee.id, descendant.id].sort());
    assert.equal(result.members.find(item => item.id === deputy.id).managerUserId, null);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('platform owner replacement promotes a root and preserves the former owner reporting tree without cycles', () => {
  const organization = db.createOrganization({ name: 'Owner replacement chart', slug: `replace-chart-${++number}`, ownerUserId: ownerId });
  const deputy = member('admin', ownerId, organization.id);
  const nextOwner = member('member', deputy.id, organization.id);
  const employee = member('member', deputy.id, organization.id);
  db.replacePlatformOrganizationOwner(ownerId, organization.id, { userId: nextOwner.id });
  const chart = db.getOrganizationChart(organization.id, nextOwner.id);
  assert.deepEqual(ids(chart), [ownerId, deputy.id, nextOwner.id, employee.id].sort());
  assert.equal(chart.members.find(item => item.id === nextOwner.id).managerUserId, null);
  assert.equal(chart.members.find(item => item.id === ownerId).managerUserId, nextOwner.id);
  assert.equal(chart.members.find(item => item.id === deputy.id).managerUserId, ownerId);
  assert.equal(chart.members.find(item => item.id === ownerId).role, 'admin');
});

test('reporting migration defaults legacy employees once and preserves later assignments and detached roots', async () => {
  const path = join(directory, 'legacy-chart.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE organizations(id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE memberships(id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(organization_id,user_id));
    INSERT INTO organizations VALUES('legacy-chart', 'legacy-chart', 'Legacy chart', '2020-01-01');
    INSERT INTO organizations VALUES('legacy-no-owner', 'legacy-no-owner', 'No owner', '2020-01-01');`);
  for (const [userId, role] of [['legacy-owner', 'owner'], ['legacy-deputy', 'admin'], ['legacy-employee', 'member'], ['legacy-root', 'member']]) {
    legacy.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(userId, userId, '', userId, '2020-01-01');
    legacy.prepare('INSERT INTO memberships VALUES(?,?,?,?,?)').run(`membership-${userId}`, 'legacy-chart', userId, role, '2020-01-01');
  }
  legacy.prepare('INSERT INTO memberships VALUES(?,?,?,?,?)').run('no-owner-member', 'legacy-no-owner', 'legacy-employee', 'member', '2020-01-01');
  legacy.close();
  let upgraded = await createDatabase({ dbPath: path });
  assert.equal(upgraded.getMemberProfile('legacy-chart', 'legacy-owner').member.managerUserId, null);
  for (const userId of ['legacy-deputy', 'legacy-employee', 'legacy-root']) assert.equal(upgraded.getMemberProfile('legacy-chart', userId).member.managerUserId, 'legacy-owner');
  assert.equal(upgraded.getMemberProfile('legacy-no-owner', 'legacy-employee').member.managerUserId, null);
  upgraded.updateOrganizationMember('legacy-chart', 'legacy-owner', 'legacy-employee', { managerUserId: 'legacy-deputy' });
  upgraded.updateOrganizationMember('legacy-chart', 'legacy-owner', 'legacy-root', { managerUserId: null });
  upgraded.close();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    upgraded = await createDatabase({ dbPath: path });
    try {
      assert.equal(upgraded.getMemberProfile('legacy-chart', 'legacy-employee').member.managerUserId, 'legacy-deputy');
      assert.equal(upgraded.getMemberProfile('legacy-chart', 'legacy-root').member.managerUserId, null);
      assert.deepEqual(ids(upgraded.getOrganizationChart('legacy-chart', 'legacy-employee')), ['legacy-deputy', 'legacy-employee']);
      assert.equal(upgraded.getOrganizationChart('legacy-chart', 'legacy-employee').members[0].managerUserId, null);
      assert.deepEqual(ids(upgraded.getOrganizationChart('legacy-no-owner', 'legacy-employee')), ['legacy-employee']);
    } finally { upgraded.close(); }
  }
});

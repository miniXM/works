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
import { registerOrganizationAssignmentRoutes } from '../server/organization-assignment.js';
import { createDatabase } from '../server/db.js';

let db;
let directory;
let dbPath;
let previousPassword;
let number = 0;
const orgId = 'org_demo';
const ownerId = 'user_admin';
const member = (role = 'member', managerUserId = ownerId, organizationId = orgId) => db.createMember({
  organizationId, username: `assignment_${++number}`, displayName: `Assignment ${number}`,
  password: 'assignment-test-123', role, managerUserId
});
const update = (userId, input, actorUserId = ownerId) => db.updateOrganizationMember(orgId, actorUserId, userId, input);
const authorize = deputy => update(deputy.id, { permissions: { 'member.manage': true } });
const move = (userId, managerUserId, expectedManagerUserId, actorUserId = ownerId) =>
  db.updateOrganizationMemberReporting(orgId, actorUserId, userId, { managerUserId, expectedManagerUserId });
const board = (actorUserId = ownerId) => db.getOrganizationAssignmentBoard(orgId, actorUserId);
const profile = userId => db.getMemberProfile(orgId, userId).member;
const ids = members => members.map(item => item.id).sort();

test.before(async () => {
  previousPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'assignment-test-123';
  directory = await mkdtemp(join(tmpdir(), 'machquote-assignment-'));
  dbPath = join(directory, 'assignment.sqlite');
  db = await createDatabase({ dbPath });
});

test.after(async () => {
  db.close();
  await rm(directory, { recursive: true, force: true });
  if (previousPassword === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
  else process.env.INITIAL_ADMIN_PASSWORD = previousPassword;
});

test('assignment boards preserve chart visibility and disclose only safe claimable pool roots', () => {
  const deputy = member('admin');
  const employee = member('member', deputy.id);
  const leaf = member('member', employee.id);
  const peer = member('admin');
  const hidden = member('member', peer.id);
  const root = member('member', null);
  const poolChild = member('member', root.id);
  const poolAdmin = member('admin', null);
  authorize(deputy);
  const original = db.getOrganizationChart(orgId, deputy.id);
  const result = board(deputy.id);
  assert.deepEqual(ids(result.members), ids(original.members));
  assert.deepEqual(result.capabilities, { canManageMembers: true, canAssignMembers: true, canAssignRoles: false });
  const candidate = result.unassignedMembers.find(item => item.id === root.id);
  assert.equal(candidate.managerUserId, null);
  assert.equal(candidate.childCount, 1);
  assert.equal(candidate.canMove, true);
  assert.equal(candidate.canEdit, true);
  assert.equal(candidate.canReceive, false);
  for (const hiddenId of [peer.id, hidden.id, poolChild.id, poolAdmin.id]) assert.equal(JSON.stringify(result).includes(hiddenId), false);
  for (const item of [...result.members, ...result.unassignedMembers]) {
    for (const privateKey of ['permissions', 'grantablePermissions', 'createdAt', 'passwordHash']) assert.equal(Object.hasOwn(item, privateKey), false);
  }
  assert.equal(result.members.find(item => item.id === ownerId).canMove, false);
  assert.equal(result.members.find(item => item.id === ownerId).canReceive, false);
  assert.equal(result.members.find(item => item.id === deputy.id).canMove, false);
  assert.equal(result.members.find(item => item.id === deputy.id).canReceive, true);
  for (const actorUserId of [employee.id, leaf.id, peer.id]) {
    const ordinary = board(actorUserId);
    assert.deepEqual(ordinary.unassignedMembers, []);
    assert.deepEqual(ordinary.capabilities, { canManageMembers: false, canAssignMembers: false, canAssignRoles: false });
    assert.equal(ordinary.members.some(item => item.canMove || item.canReceive || item.canEdit), false);
  }
  assert.equal(board().unassignedMembers.some(item => item.id === poolAdmin.id), true);
  assert.deepEqual(db.getOrganizationChart(orgId, deputy.id), original);
});

test('owner moves and releases whole subtrees without changing profiles, roles or grants', () => {
  const deputy = member('admin');
  const employee = member();
  const child = member('member', employee.id);
  const grandchild = member('member', child.id);
  const department = db.createOrganizationDepartment(orgId, ownerId, { name: 'Assignment profile department' });
  update(employee.id, { departmentId: department.id, jobTitle: 'Machinist', permissions: { 'quote.write': true } });
  const before = profile(employee.id);
  const childBefore = profile(child.id);
  const grandchildBefore = profile(grandchild.id);
  const attached = move(employee.id, deputy.id, ownerId);
  assert.equal(attached.managerUserId, deputy.id);
  assert.deepEqual(profile(employee.id), { ...before, managerUserId: deputy.id });
  assert.deepEqual(profile(child.id), childBefore);
  assert.deepEqual(profile(grandchild.id), grandchildBefore);
  move(employee.id, null, deputy.id);
  assert.deepEqual(profile(employee.id), { ...before, managerUserId: null });
  const candidate = board().unassignedMembers.find(item => item.id === employee.id);
  assert.equal(candidate.childCount, 2);
  assert.equal(board().members.some(item => [employee.id, child.id, grandchild.id].includes(item.id)), false);
  move(employee.id, deputy.id, null);
  assert.equal(ids(db.getOrganizationChart(orgId, deputy.id).members).includes(grandchild.id), true);
  const audit = db.listAudit(orgId).find(item => item.action === 'organization.member.reporting.update' && item.entityId === `${orgId}:${employee.id}`);
  assert.ok(audit);
  assert.equal(audit.username, 'admin');
});

test('authorized deputies claim unassigned roots and move or release only their own employee branches', () => {
  const deputy = member('admin');
  const peer = member('admin');
  authorize(deputy);
  authorize(peer);
  const employee = member('member', deputy.id);
  const lead = member('member', deputy.id);
  const outsider = member('member', peer.id);
  const root = member('member', null);
  const child = member('member', root.id);
  const adminRoot = member('admin', null);
  assert.equal(move(root.id, lead.id, null, deputy.id).managerUserId, lead.id);
  assert.equal(profile(child.id).managerUserId, root.id);
  assert.equal(move(employee.id, root.id, deputy.id, deputy.id).managerUserId, root.id);
  for (const [source, destination, expected] of [
    [outsider.id, deputy.id, peer.id], [employee.id, peer.id, root.id], [employee.id, ownerId, root.id],
    [deputy.id, lead.id, ownerId], [peer.id, deputy.id, ownerId], [adminRoot.id, deputy.id, null]
  ]) assert.throws(() => move(source, destination, expected, deputy.id), { code: 'reporting_scope_denied' });
  assert.equal(move(root.id, null, lead.id, deputy.id).managerUserId, null);
  assert.equal(board(deputy.id).members.some(item => [root.id, child.id, employee.id].includes(item.id)), false);
  assert.equal(move(root.id, peer.id, null, peer.id).managerUserId, peer.id);
  assert.throws(() => move(root.id, deputy.id, peer.id, deputy.id), { code: 'reporting_scope_denied' });
  assert.equal(profile(child.id).managerUserId, root.id);
});

test('stale drag snapshots conflict and exact request validation rejects unrelated changes', () => {
  const deputy = member('admin');
  const other = member('admin');
  authorize(deputy);
  authorize(other);
  const root = member('member', null);
  move(root.id, deputy.id, null, deputy.id);
  assert.throws(() => move(root.id, other.id, null, other.id), { status: 409, code: 'reporting_assignment_conflict' });
  assert.equal(profile(root.id).managerUserId, deputy.id);
  const countBefore = db.listAudit(orgId).length;
  assert.equal(move(root.id, deputy.id, deputy.id, deputy.id).managerUserId, deputy.id);
  assert.equal(db.listAudit(orgId).length, countBefore);
  for (const input of [null, [], {}, { managerUserId: null }, { expectedManagerUserId: deputy.id },
    { managerUserId: null, expectedManagerUserId: deputy.id, role: 'admin' },
    { managerUserId: null, expectedManagerUserId: deputy.id, permissions: {} }]) {
    assert.throws(() => db.updateOrganizationMemberReporting(orgId, ownerId, root.id, input), { code: 'invalid_request' });
  }
  for (const value of ['', '  ', false, 0, {}, [], 'x'.repeat(101)]) {
    for (const field of ['managerUserId', 'expectedManagerUserId']) {
      assert.throws(() => db.updateOrganizationMemberReporting(orgId, ownerId, root.id,
        { managerUserId: null, expectedManagerUserId: deputy.id, [field]: value }), { code: 'invalid_manager' });
    }
  }
  assert.equal(profile(root.id).managerUserId, deputy.id);
  assert.equal(db.listAudit(orgId).length, countBefore);
});

test('reporting moves reject cycles, immutable owners and foreign tenant nodes', () => {
  const deputy = member('admin');
  const employee = member('member', deputy.id);
  const child = member('member', employee.id);
  const other = db.createOrganization({ name: 'Assignment other', slug: `assignment-other-${++number}`, ownerUserId: ownerId });
  const foreign = member('member', ownerId, other.id);
  for (const managerUserId of [employee.id, child.id]) assert.throws(() => move(employee.id, managerUserId, deputy.id), { code: 'reporting_cycle' });
  assert.throws(() => move(ownerId, deputy.id, null), { code: 'reporting_scope_denied' });
  assert.throws(() => move(deputy.id, child.id, ownerId), { code: 'invalid_manager_role' });
  for (const managerUserId of ['missing', foreign.id]) assert.throws(() => move(employee.id, managerUserId, deputy.id), { code: 'manager_not_found' });
  assert.throws(() => move(foreign.id, ownerId, ownerId), { code: 'member_not_found' });
  assert.throws(() => db.getOrganizationAssignmentBoard(other.id, employee.id), { code: 'organization_permission_denied' });
  assert.equal(JSON.stringify(board()).includes(foreign.id), false);
  assert.equal(profile(employee.id).managerUserId, deputy.id);
});

test('a privileged descendant blocks deputy branch moves through both reporting routes', () => {
  const deputy = member('admin');
  const lead = member('member', deputy.id);
  const ownRoot = member('member', deputy.id);
  const poolRoot = member('member', null);
  const ownAdmin = member('admin');
  const poolAdmin = member('admin');
  authorize(deputy);
  // Simulate an older or externally imported hierarchy that violates current role nesting rules.
  const raw = new DatabaseSync(dbPath);
  try {
    raw.prepare('UPDATE memberships SET manager_user_id = ? WHERE organization_id = ? AND user_id = ?').run(ownRoot.id, orgId, ownAdmin.id);
    raw.prepare('UPDATE memberships SET manager_user_id = ? WHERE organization_id = ? AND user_id = ?').run(poolRoot.id, orgId, poolAdmin.id);
  } finally { raw.close(); }
  assert.equal(board(deputy.id).members.find(item => item.id === ownRoot.id).canMove, false);
  assert.equal(board(deputy.id).unassignedMembers.some(item => item.id === poolRoot.id), false);
  assert.throws(() => move(ownRoot.id, lead.id, deputy.id, deputy.id), { code: 'reporting_scope_denied' });
  assert.throws(() => move(poolRoot.id, deputy.id, null, deputy.id), { code: 'reporting_scope_denied' });
  assert.throws(() => update(ownRoot.id, { managerUserId: lead.id }, deputy.id), { code: 'reporting_scope_denied' });
  assert.equal(profile(ownRoot.id).managerUserId, deputy.id);
  assert.equal(profile(poolRoot.id).managerUserId, null);
});

test('manager creation accepts an explicit unassigned root and retains existing defaults', () => {
  const deputy = member('admin');
  authorize(deputy);
  const create = values => db.createOrganizationMember(orgId, deputy.id, { username: `assignment_new_${++number}`,
    displayName: `New assignment ${number}`, temporaryPassword: 'assignment-test-123', ...values });
  assert.equal(create({}).managerUserId, deputy.id);
  const candidate = create({ managerUserId: null });
  assert.equal(candidate.managerUserId, null);
  assert.equal(candidate.role, 'member');
  assert.equal(board(deputy.id).unassignedMembers.some(item => item.id === candidate.id), true);
  assert.throws(() => create({ managerUserId: ownerId }), { code: 'reporting_scope_denied' });
  assert.throws(() => create({ managerUserId: null, role: 'admin' }), { code: 'role_assignment_denied' });
});

test('audit failure rolls back the entire drag while preserving descendants and permissions', () => {
  const deputy = member('admin');
  const employee = member();
  const child = member('member', employee.id);
  const before = profile(employee.id);
  const childBefore = profile(child.id);
  const countBefore = db.listAudit(orgId).length;
  const originalAudit = db.addAudit;
  try {
    db.addAudit = () => { throw new Error('assignment audit unavailable'); };
    assert.throws(() => move(employee.id, deputy.id, ownerId), /assignment audit unavailable/);
  } finally { db.addAudit = originalAudit; }
  assert.deepEqual(profile(employee.id), before);
  assert.deepEqual(profile(child.id), childBefore);
  assert.equal(db.listAudit(orgId).length, countBefore);
});

test('HTTP assignment routes authenticate, ignore caller tenant hints and apply revoked grants immediately', async () => {
  const deputy = member('admin');
  const employee = member('member', deputy.id);
  const root = member('member', null);
  authorize(deputy);
  const deputyToken = db.createSession(deputy.id, orgId).token;
  const employeeToken = db.createSession(employee.id, orgId).token;
  const app = new Koa();
  const router = new Router({ prefix: '/api' });
  app.use(bodyParser());
  registerOrganizationAssignmentRoutes(router, { db, requireAuth: async (ctx, next) => {
    const session = db.getSession(ctx.get('authorization').replace(/^Bearer /, ''));
    if (!session) { ctx.status = 401; ctx.body = { error: 'unauthorized' }; return; }
    ctx.state.session = session;
    await next();
  } });
  app.use(router.routes());
  const server = createServer(app.callback());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = (path, token = '', method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
  });
  try {
    assert.equal((await request('/organization/assignment-board')).status, 401);
    const employeeBoard = await (await request(`/organization/assignment-board?userId=${ownerId}&organizationId=foreign`, employeeToken)).json();
    assert.equal(employeeBoard.currentUserId, employee.id);
    assert.deepEqual(employeeBoard.unassignedMembers, []);
    const path = `/organization/members/${root.id}/reporting`;
    const payload = { managerUserId: deputy.id, expectedManagerUserId: null };
    assert.equal((await request(path, employeeToken, 'PUT', payload)).status, 403);
    const response = await request(path, deputyToken, 'PUT', payload);
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.member.managerUserId, deputy.id);
    assert.equal(Object.hasOwn(saved.member, 'permissions'), false);
    assert.equal((await request(path, deputyToken, 'PUT', payload)).status, 409);
    update(deputy.id, { permissions: { 'member.manage': false } });
    const revoked = await (await request('/organization/assignment-board', deputyToken)).json();
    assert.equal(revoked.capabilities.canAssignMembers, false);
    assert.deepEqual(revoked.unassignedMembers, []);
    assert.equal(revoked.members.some(item => item.canMove || item.canReceive || item.canEdit), false);
    assert.equal((await request(path, deputyToken, 'PUT', { managerUserId: null, expectedManagerUserId: deputy.id })).status, 403);
    assert.equal(profile(root.id).managerUserId, deputy.id);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

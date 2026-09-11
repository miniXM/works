import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase, verifyPassword } from '../server/db.js';
import { prepareOrganizationDemo } from '../scripts/prepare-organization-demo.mjs';

const orgId = 'org_demo';
const setupAction = 'organization.demo.reporting.v1';
const accounts = ['zhang.gong', 'li.gong', 'wang.qa', 'chen.pm', 'test.user01', 'test.user05', 'test.user02', 'test.user04', 'test.user03'];
const deputies = new Set(['chen.pm', 'test.user05']);
const tableRows = (db, table) => db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();

async function fixture(directory, filename) {
  const dbPath = join(directory, filename);
  const api = await createDatabase({ dbPath });
  for (const username of accounts) api.createMember({ organizationId: orgId, username, displayName: username,
    password: `preserved-${username}-123`, role: deputies.has(username) ? 'admin' : 'member' });
  const employee = api.listMembers(orgId).find(member => member.username === 'zhang.gong');
  const department = api.createOrganizationDepartment(orgId, 'user_admin', { name: 'Existing department' });
  api.updateOrganizationMember(orgId, 'user_admin', employee.id,
    { departmentId: department.id, permissions: { 'quote.write': true, 'part.write': true } });
  const deputy = api.listMembers(orgId).find(member => member.username === 'chen.pm');
  api.updateOrganizationMember(orgId, 'user_admin', deputy.id,
    { permissions: { 'quote.write': true }, grantablePermissions: { 'quote.write': true } });
  api.createProject({ organizationId: orgId, userId: employee.id, ownerUserId: employee.id, title: 'Preserved project', stage: '立项沟通' });
  const other = api.createOrganization({ name: 'Untouched other enterprise', slug: `other-${filename.replace('.', '-')}`, ownerUserId: 'user_admin' });
  api.updateMemberProfile(other.id, 'user_admin', { displayName: 'Other name', jobTitle: 'Other title' });
  api.close();
  return dbPath;
}

test('demo setup is explicit, backed up, tenant scoped and idempotent without resetting credentials', async () => {
  const previousPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'demo-fixture-123';
  const directory = await mkdtemp(join(tmpdir(), 'machquote-demo-'));
  let raw;
  try {
    const dbPath = await fixture(directory, 'demo.sqlite');
    raw = new DatabaseSync(dbPath);
    const beforeUsers = tableRows(raw, 'users');
    const beforeMemberships = tableRows(raw, 'memberships');
    const beforeOrganizations = tableRows(raw, 'organizations');
    const beforeGrants = tableRows(raw, 'organization_member_permissions');
    const beforeGrantable = tableRows(raw, 'organization_member_grantable_permissions');
    const beforeDepartments = tableRows(raw, 'organization_departments');
    const beforeProjects = tableRows(raw, 'projects');
    const beforeTasks = tableRows(raw, 'tasks');
    const beforeProjectMembers = tableRows(raw, 'project_members');
    const beforeAudit = tableRows(raw, 'audit_events');
    const preview = await prepareOrganizationDemo({ dbPath });
    assert.equal(preview.applied, false);
    assert.equal(preview.members.length, 13);
    assert.equal(preview.members.filter(member => member.createAccount).length, 3);
    assert.deepEqual(tableRows(raw, 'users'), beforeUsers);
    assert.deepEqual(tableRows(raw, 'memberships'), beforeMemberships);
    assert.deepEqual(tableRows(raw, 'audit_events'), beforeAudit);
    assert.deepEqual((await readdir(directory)).filter(name => name === 'backups'), []);
    const result = await prepareOrganizationDemo({ dbPath, apply: true, outputDirectory: join(directory, 'credentials') });
    assert.equal(result.applied, true);
    assert.deepEqual(result.createdUsernames.sort(), ['lin.employee', 'liu.manager', 'zhou.employee']);
    const credentials = JSON.parse(await readFile(result.accountFile, 'utf8'));
    assert.equal(JSON.stringify(result).includes(credentials.initialPassword), false);
    assert.equal(credentials.accounts.length, 3);
    const backupDb = new DatabaseSync(result.backupPath, { readOnly: true });
    try {
      assert.deepEqual(tableRows(backupDb, 'users'), beforeUsers);
      assert.deepEqual(tableRows(backupDb, 'memberships'), beforeMemberships);
      assert.deepEqual(tableRows(backupDb, 'audit_events'), beforeAudit);
    } finally { backupDb.close(); }
    for (const original of beforeUsers) assert.deepEqual(raw.prepare('SELECT * FROM users WHERE id = ?').get(original.id), original);
    for (const account of credentials.accounts) {
      const user = raw.prepare('SELECT * FROM users WHERE username = ?').get(account.username);
      assert.equal(verifyPassword(credentials.initialPassword, user.password_hash), true);
    }
    for (const original of beforeMemberships) {
      const current = raw.prepare('SELECT * FROM memberships WHERE id = ?').get(original.id);
      if (original.organization_id !== orgId) assert.deepEqual(current, original);
      else for (const key of ['id', 'organization_id', 'user_id', 'role', 'created_at', 'department_id']) assert.equal(current[key], original[key]);
    }
    for (const original of beforeOrganizations.filter(row => row.id !== orgId)) assert.deepEqual(raw.prepare('SELECT * FROM organizations WHERE id = ?').get(original.id), original);
    assert.deepEqual(tableRows(raw, 'organization_departments'), beforeDepartments);
    assert.deepEqual(tableRows(raw, 'organization_member_grantable_permissions'), beforeGrantable);
    for (const original of beforeGrants.filter(row => row.permission_key !== 'member.manage')) {
      assert.deepEqual(raw.prepare('SELECT * FROM organization_member_permissions WHERE organization_id = ? AND user_id = ? AND permission_key = ?')
        .get(original.organization_id, original.user_id, original.permission_key), original);
    }
    const withoutName = row => { const { owner_name, ...rest } = row; return rest; };
    assert.deepEqual(tableRows(raw, 'projects').map(withoutName), beforeProjects.map(withoutName));
    assert.deepEqual(tableRows(raw, 'tasks').map(withoutName), beforeTasks.map(withoutName));
    assert.deepEqual(tableRows(raw, 'project_members'), beforeProjectMembers);
    const members = raw.prepare(`SELECT u.username, m.* FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ?`).all(orgId);
    const byUsername = new Map(members.map(member => [member.username, member]));
    assert.equal(byUsername.get('admin').display_name_override, '李老板');
    assert.equal(byUsername.get('admin').manager_user_id, null);
    for (const username of ['chen.pm', 'test.user05', 'liu.manager']) {
      const manager = byUsername.get(username);
      assert.equal(manager.role, 'admin');
      assert.equal(manager.manager_user_id, byUsername.get('admin').user_id);
      assert.equal(raw.prepare(`SELECT enabled FROM organization_member_permissions WHERE organization_id = ? AND user_id = ? AND permission_key = 'member.manage'`).get(orgId, manager.user_id).enabled, 1);
    }
    assert.deepEqual(members.filter(member => !member.manager_user_id && member.role !== 'owner').map(member => member.username).sort(), ['lin.employee', 'test.user04', 'zhou.employee']);
    assert.equal(raw.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE action = ?').get(setupAction).count, 1);
    const moved = byUsername.get('test.user04');
    raw.prepare('UPDATE memberships SET display_name_override = ?, manager_user_id = ? WHERE id = ?').run('User revised name', byUsername.get('chen.pm').user_id, moved.id);
    const afterUserChanges = tableRows(raw, 'memberships');
    const auditsAfter = tableRows(raw, 'audit_events');
    const repeated = await prepareOrganizationDemo({ dbPath, apply: true, outputDirectory: join(directory, 'credentials') });
    assert.equal(repeated.applied, false);
    assert.equal(repeated.alreadyApplied, true);
    assert.deepEqual(tableRows(raw, 'memberships'), afterUserChanges);
    assert.deepEqual(tableRows(raw, 'audit_events'), auditsAfter);
    assert.equal((await readdir(join(directory, 'credentials'))).length, 1);
    assert.equal((await readdir(join(directory, 'backups'))).length, 1);
  } finally {
    raw?.close();
    await rm(directory, { recursive: true, force: true });
    if (previousPassword === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
    else process.env.INITIAL_ADMIN_PASSWORD = previousPassword;
  }
});

test('demo setup audit failure rolls back accounts and profiles and removes uncommitted credentials', async () => {
  const previousPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'demo-fixture-123';
  const directory = await mkdtemp(join(tmpdir(), 'machquote-demo-rollback-'));
  let raw;
  try {
    const dbPath = await fixture(directory, 'rollback.sqlite');
    raw = new DatabaseSync(dbPath);
    raw.exec(`CREATE TRIGGER reject_demo_marker BEFORE INSERT ON audit_events
      WHEN NEW.action = '${setupAction}' BEGIN SELECT RAISE(ABORT, 'demo audit unavailable'); END`);
    const before = Object.fromEntries(['users', 'memberships', 'organizations', 'organization_member_permissions', 'audit_events', 'projects', 'tasks']
      .map(table => [table, tableRows(raw, table)]));
    await assert.rejects(prepareOrganizationDemo({ dbPath, apply: true, outputDirectory: join(directory, 'credentials') }), /demo audit unavailable/);
    for (const [table, rows] of Object.entries(before)) assert.deepEqual(tableRows(raw, table), rows);
    assert.deepEqual(await readdir(join(directory, 'credentials')), []);
    assert.equal((await readdir(join(directory, 'backups'))).length, 1);
  } finally {
    raw?.close();
    await rm(directory, { recursive: true, force: true });
    if (previousPassword === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
    else process.env.INITIAL_ADMIN_PASSWORD = previousPassword;
  }
});

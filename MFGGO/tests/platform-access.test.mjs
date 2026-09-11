import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { PLATFORM_PERMISSION_DEFINITIONS } from '../access-policy.js';
import { instrumentPlatformAccess } from '../server/platform-access.js';
import { registerPlatformRoutes } from '../server/platform-routes.js';

const allPermissions = Object.fromEntries(PLATFORM_PERMISSION_DEFINITIONS.map(item => [item.key, true]));
const noPermissions = Object.fromEntries(PLATFORM_PERMISSION_DEFINITIONS.map(item => [item.key, false]));
let fixture;
let memberSequence = 0;

function attachApi(sqlite) {
  return instrumentPlatformAccess({
    listOrganizationModules(organizationId) {
      return Object.fromEntries(sqlite.prepare('SELECT module_key, enabled FROM organization_modules WHERE organization_id = ?').all(organizationId).map(row => [row.module_key, Boolean(row.enabled)]));
    },
    addAudit({ organizationId, userId, action, entityType, entityId, metadata }) {
      sqlite.prepare('INSERT INTO audit_events(id, organization_id, user_id, action, entity_type, entity_id, metadata_json) VALUES(?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), organizationId, userId, action, entityType, entityId, JSON.stringify(metadata));
    }
  }, sqlite);
}

test.before(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'machquote-platform-access-'));
  fixture = { directory, dbPath: join(directory, 'test.sqlite') };
  fixture.sqlite = new DatabaseSync(fixture.dbPath);
  fixture.sqlite.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL);
    CREATE TABLE organizations(id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE memberships(id TEXT PRIMARY KEY, organization_id TEXT REFERENCES organizations(id), user_id TEXT REFERENCES users(id), role TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(organization_id, user_id));
    CREATE TABLE organization_modules(organization_id TEXT REFERENCES organizations(id), module_key TEXT NOT NULL, enabled INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(organization_id,module_key));
    CREATE TABLE organization_member_permissions(organization_id TEXT NOT NULL, user_id TEXT NOT NULL, permission_key TEXT NOT NULL, enabled INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(organization_id,user_id,permission_key));
    CREATE TABLE platform_admins(user_id TEXT PRIMARY KEY REFERENCES users(id), created_at TEXT NOT NULL);
    CREATE TABLE audit_events(id TEXT PRIMARY KEY, organization_id TEXT REFERENCES organizations(id), user_id TEXT REFERENCES users(id), action TEXT, entity_type TEXT, entity_id TEXT, metadata_json TEXT);
    INSERT INTO users VALUES('primary', 'admin', 'Primary');
    INSERT INTO organizations VALUES('org-one', 'One', 'one', '2020-01-01');
    INSERT INTO memberships VALUES('member-primary', 'org-one', 'primary', 'owner', '2020-01-01');
    INSERT INTO platform_admins VALUES('primary', '2020-01-01');`);
  fixture.api = attachApi(fixture.sqlite);
  const app = new Koa();
  const router = new Router({ prefix: '/api' });
  app.use(bodyParser());
  registerPlatformRoutes(router, { db: fixture.api, requireAuth: async (ctx, next) => {
    const userId = ctx.get('authorization').replace(/^Bearer /, '');
    if (!fixture.sqlite.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) {
      ctx.status = 401; ctx.body = { error: 'unauthorized' }; return;
    }
    ctx.state.session = { userId, organizationId: 'org-one' };
    await next();
  } });
  app.use(router.routes());
  fixture.server = createServer(app.callback());
  await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
  fixture.address = `http://127.0.0.1:${fixture.server.address().port}/api`;
});

test.after(async () => {
  await new Promise(resolve => fixture.server.close(resolve));
  fixture.sqlite.close();
  await rm(fixture.directory, { recursive: true, force: true });
});

function member(role = 'member', organizationId = 'org-one') {
  const id = `platform-test-member-${++memberSequence}`;
  fixture.sqlite.prepare('INSERT INTO users VALUES(?, ?, ?)').run(id, id, id);
  fixture.sqlite.prepare('INSERT INTO memberships VALUES(?, ?, ?, ?, ?)').run(`membership-${id}`, organizationId, id, role, new Date().toISOString());
  return id;
}

function deputy(permissions = {}) {
  const id = member('admin');
  fixture.api.updatePlatformAdministrator('primary', id, { role: 'admin', permissions });
  return id;
}

async function request(path, { method = 'GET', body, actor = 'primary' } = {}) {
  const response = await fetch(`${fixture.address}${path}`, {
    method, headers: { authorization: `Bearer ${actor}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

test('legacy platform administrators become primary while ordinary enterprise administrators remain separate', () => {
  assert.deepEqual(fixture.api.getPlatformAccess('primary'), { role: 'owner', permissions: allPermissions });
  const enterpriseOwner = member('owner');
  assert.deepEqual(fixture.api.getPlatformAccess(enterpriseOwner), { role: null, permissions: noPermissions });
  assert.equal(fixture.api.isPlatformAdmin(enterpriseOwner), false);
  assert.deepEqual(fixture.api.getPlatformAccess('missing'), { role: null, permissions: noPermissions });
});

test('deputies receive only explicit grants and may not appoint or change administrators', () => {
  const id = deputy({ 'organization.read': true });
  assert.deepEqual(fixture.api.getPlatformAccess(id), { role: 'admin', permissions: { ...noPermissions, 'organization.read': true } });
  assert.equal(fixture.api.isPlatformAdmin(id), true);
  const target = member();
  for (const userId of [target, id, 'primary']) {
    assert.throws(() => fixture.api.updatePlatformAdministrator(id, userId, { role: 'admin', permissions: allPermissions }), { code: 'platform_owner_required' });
  }
  assert.throws(() => fixture.api.getPlatformAdministrators(id), { code: 'platform_owner_required' });
  assert.throws(() => fixture.api.getPlatformOwnerCandidates(id), { code: 'platform_permission_denied' });
});

test('deputy grants replace atomically and revocation takes effect without changing sessions', () => {
  const id = deputy(allPermissions);
  fixture.api.updatePlatformAdministrator('primary', id, { role: 'admin', permissions: { 'user.read': true } });
  assert.deepEqual(fixture.api.getPlatformAccess(id).permissions, { ...noPermissions, 'user.read': true });
  fixture.api.updatePlatformAdministrator('primary', id, { role: null, permissions: {} });
  assert.deepEqual(fixture.api.getPlatformAccess(id), { role: null, permissions: noPermissions });
  assert.equal(fixture.sqlite.prepare('SELECT COUNT(*) count FROM platform_admin_permissions WHERE user_id = ?').get(id).count, 0);
  assert.throws(() => fixture.api.getPlatformOwnerCandidates(id), { code: 'platform_permission_denied' });
});

test('invalid or escalated grant inputs do not partially appoint an administrator', () => {
  const id = member();
  for (const input of [
    { role: 'owner', permissions: {} },
    { role: 'admin', permissions: { unknown: true } },
    { role: 'admin', permissions: { 'organization.create': 'true' } },
    { role: 'admin', permissions: { 'organization.read': 1 } },
    { role: 'admin', permissions: [] },
    { role: null, permissions: { 'user.read': true } },
    { role: 'admin', permissions: {}, organizationId: 'org-one' }
  ]) {
    assert.throws(() => fixture.api.updatePlatformAdministrator('primary', id, input));
    assert.equal(fixture.api.getPlatformAccess(id).role, null);
  }
  assert.throws(() => fixture.api.updatePlatformAdministrator('primary', 'primary', { role: null }), { code: 'self_platform_role_change_denied' });
  assert.equal(fixture.api.getPlatformAccess('primary').role, 'owner');
});

test('a primary can lower another legacy primary while retaining itself', () => {
  const second = member();
  fixture.sqlite.prepare("INSERT INTO platform_admins(user_id, created_at, role) VALUES(?, ?, 'owner')").run(second, new Date().toISOString());
  fixture.api.updatePlatformAdministrator('primary', second, { role: 'admin', permissions: { 'audit.read': true } });
  assert.equal(fixture.api.getPlatformAccess('primary').role, 'owner');
  assert.deepEqual(fixture.api.getPlatformAccess(second), { role: 'admin', permissions: { ...noPermissions, 'audit.read': true } });
});

test('creating enterprises uses the selected owner and grants no automatic enterprise membership to the platform actor', () => {
  const creator = deputy({ 'organization.create': true });
  const selectedOwner = member();
  const organization = fixture.api.createPlatformOrganization(creator, { name: 'Created enterprise', slug: 'created-enterprise', ownerUserId: selectedOwner, modules: { chat: false } });
  assert.equal(organization.ownerUserId, selectedOwner);
  assert.equal(organization.modules.chat, false);
  assert.equal(organization.modules.projects, true);
  assert.equal(organization.memberCount, 1);
  assert.equal(fixture.sqlite.prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?').get(organization.id, selectedOwner).role, 'owner');
  assert.equal(fixture.sqlite.prepare('SELECT 1 FROM memberships WHERE organization_id = ? AND user_id = ?').get(organization.id, creator), undefined);
  assert.equal(fixture.api.getPlatformAccess(selectedOwner).role, null);
  assert.throws(() => fixture.api.createPlatformOrganization(creator, { name: 'Missing owner', slug: 'missing-owner' }), { code: 'invalid_owner_user' });
  assert.throws(() => fixture.api.createPlatformOrganization(creator, { name: 'Duplicate', slug: 'created-enterprise', ownerUserId: selectedOwner }), { code: 'organization_slug_exists' });
  const reader = deputy({ 'organization.read': true });
  assert.throws(() => fixture.api.createPlatformOrganization(reader, { name: 'Denied', slug: 'denied-enterprise', ownerUserId: selectedOwner }), { code: 'platform_permission_denied' });
});

test('owner replacement promotes an existing member, lowers previous owners and clears implicit management grants', () => {
  const operator = deputy({ 'organization.owner.manage': true });
  const originalOwner = member();
  const organization = fixture.api.createPlatformOrganization('primary', { name: 'Transfer enterprise', slug: 'transfer-enterprise', ownerUserId: originalOwner });
  const newOwner = member('member', organization.id);
  fixture.sqlite.prepare('INSERT INTO organization_member_permissions VALUES(?, ?, ?, ?, ?)').run(organization.id, originalOwner, 'member.manage', 1, new Date().toISOString());
  const otherEnterpriseUser = member();
  assert.throws(() => fixture.api.replacePlatformOrganizationOwner(operator, organization.id, { userId: otherEnterpriseUser }), { code: 'member_not_found' });
  const changed = fixture.api.replacePlatformOrganizationOwner(operator, organization.id, { userId: newOwner });
  assert.equal(changed.ownerUserId, newOwner);
  assert.equal(changed.owners.length, 1);
  assert.equal(fixture.sqlite.prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?').get(organization.id, originalOwner).role, 'admin');
  assert.equal(fixture.sqlite.prepare('SELECT COUNT(*) count FROM organization_member_permissions WHERE organization_id = ? AND user_id = ?').get(organization.id, originalOwner).count, 0);
  assert.equal(fixture.sqlite.prepare('SELECT 1 FROM memberships WHERE organization_id = ? AND user_id = ?').get(organization.id, operator), undefined);
  const creator = deputy({ 'organization.create': true });
  assert.throws(() => fixture.api.replacePlatformOrganizationOwner(creator, organization.id, { userId: originalOwner }), { code: 'platform_permission_denied' });
});

test('owner candidate lookup is permission controlled and may be restricted to one enterprise', () => {
  const operator = deputy({ 'organization.owner.manage': true });
  const selectedOwner = member();
  const organization = fixture.api.createPlatformOrganization('primary', { name: 'Candidate enterprise', slug: 'candidate-enterprise', ownerUserId: selectedOwner });
  const candidate = member('member', organization.id);
  const candidates = fixture.api.getPlatformOwnerCandidates(operator, organization.id);
  assert.deepEqual(new Set(candidates.map(item => item.id)), new Set([selectedOwner, candidate]));
  assert.ok(fixture.api.getPlatformOwnerCandidates(operator).some(item => item.id === selectedOwner));
  assert.throws(() => fixture.api.getPlatformOwnerCandidates(operator, 'missing'), { code: 'organization_not_found' });
});

test('audit failure rolls back enterprise creation, owner replacement and platform appointment', () => {
  const owner = member();
  const organization = fixture.api.createPlatformOrganization('primary', { name: 'Atomic enterprise', slug: 'atomic-enterprise', ownerUserId: owner });
  const replacement = member('member', organization.id);
  const target = member();
  const previousAudit = fixture.api.addAudit;
  fixture.api.addAudit = () => { throw new Error('platform audit unavailable'); };
  try {
    assert.throws(() => fixture.api.createPlatformOrganization('primary', { name: 'Rolled back', slug: 'rolled-back', ownerUserId: owner }), /platform audit unavailable/);
    assert.throws(() => fixture.api.replacePlatformOrganizationOwner('primary', organization.id, { userId: replacement }), /platform audit unavailable/);
    assert.throws(() => fixture.api.updatePlatformAdministrator('primary', target, { role: 'admin', permissions: allPermissions }), /platform audit unavailable/);
  } finally { fixture.api.addAudit = previousAudit; }
  assert.equal(fixture.sqlite.prepare("SELECT 1 FROM organizations WHERE slug = 'rolled-back'").get(), undefined);
  assert.equal(fixture.sqlite.prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?').get(organization.id, owner).role, 'owner');
  assert.equal(fixture.sqlite.prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?').get(organization.id, replacement).role, 'member');
  assert.equal(fixture.api.getPlatformAccess(target).role, null);
});

test('new platform HTTP routes return contracts and enforce grants on each request', async () => {
  const operator = deputy();
  let result = await request('/platform/administrators', { actor: operator });
  assert.equal(result.status, 403);
  result = await request('/platform/administrators');
  assert.equal(result.status, 200);
  assert.equal(result.body.permissionDefinitions.length, PLATFORM_PERMISSION_DEFINITIONS.length);
  assert.ok(result.body.administrators.some(item => item.id === operator && item.role === 'admin'));
  assert.ok(Array.isArray(result.body.candidates));
  result = await request(`/platform/administrators/${operator}`, { method: 'PUT', body: { role: 'admin', permissions: { 'organization.owner.manage': true } } });
  assert.equal(result.status, 200);
  assert.equal(result.body.administrator.permissions['organization.owner.manage'], true);
  result = await request('/platform/owner-candidates?organizationId=org-one', { actor: operator });
  assert.equal(result.status, 200);
  assert.ok(result.body.candidates.some(item => item.id === 'primary'));
  await request(`/platform/administrators/${operator}`, { method: 'PUT', body: { role: null, permissions: {} } });
  result = await request('/platform/owner-candidates', { actor: operator });
  assert.equal(result.status, 403);
  result = await request('/platform/administrators', { actor: 'unknown' });
  assert.equal(result.status, 401);
});

test('repeated migration preserves explicit deputies and never resurrects a revoked administrator', () => {
  const kept = deputy({ 'organization.read': true });
  const revoked = deputy({ 'organization.create': true });
  fixture.api.updatePlatformAdministrator('primary', revoked, { role: null });
  fixture.api = attachApi(fixture.sqlite);
  assert.equal(fixture.api.getPlatformAccess('primary').role, 'owner');
  assert.deepEqual(fixture.api.getPlatformAccess(kept), { role: 'admin', permissions: { ...noPermissions, 'organization.read': true } });
  assert.deepEqual(fixture.api.getPlatformAccess(revoked), { role: null, permissions: noPermissions });
});

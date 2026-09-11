import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { createDatabase } from '../server/db.js';

let app, db, sql, directory, server, address, owner, previousPassword, sequence = 0;
async function request(path, actor = owner, method = 'GET', data) {
  const response = await fetch(`${address}/api${path}`, { method,
    headers: { 'content-type': 'application/json', ...(actor?.token ? { authorization: `Bearer ${actor.token}` } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { status: response.status, body: await response.json() };
}
const endpoint = project => `/projects/${project.id}/links`;
const project = (actor = owner) => db.createProject({ organizationId: owner.organization.id, userId: actor.user.id,
  title: `Linked project ${++sequence}`, stage: '立项沟通', tag: '未分组' });
function member(role = 'member') {
  const name = `link_worker_${++sequence}`;
  const user = db.createOrganizationMember(owner.organization.id, owner.user.id,
    { username: name, displayName: name, temporaryPassword: 'link-worker-123', role });
  return { user, ...db.createSession(user.id, owner.organization.id) };
}
const grant = (actor, permissions) => db.updateOrganizationMember(owner.organization.id, owner.user.id, actor.user.id, { permissions });
const participate = (target, actor) => db.addProjectMember({ organizationId: owner.organization.id,
  projectId: target.id, userId: actor.user.id, createdBy: owner.user.id });
const ids = response => response.body.projects.map(item => item.id);
const linksInSql = source => sql.prepare('SELECT * FROM project_links WHERE project_id = ? ORDER BY target_project_id').all(source.id);

test.before(async () => {
  previousPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'link-owner-123';
  directory = await mkdtemp(join(tmpdir(), 'mfggo-project-links-'));
  app = await createApp({ dbPath: join(directory, 'test.sqlite') });
  db = app.context.db;
  sql = new DatabaseSync(join(directory, 'test.sqlite'));
  sql.exec('PRAGMA foreign_keys = ON');
  server = createServer(app.callback());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${server.address().port}`;
  owner = (await request('/auth/login', null, 'POST', { username: 'admin', password: 'link-owner-123' })).body;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  sql.close(); app.close();
  await rm(directory, { recursive: true, force: true });
  if (previousPassword === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
  else process.env.INITIAL_ADMIN_PASSWORD = previousPassword;
});

test('project links are directed, idempotent, minimal and persistent without changing project contents', async () => {
  const source = project(), target = project();
  const part = db.createPart({ organizationId: owner.organization.id, projectId: source.id, name: 'Original part', format: 'STEP', quantity: 2 });
  const snapshot = () => [db.getProject(owner.organization.id, source.id), db.getProject(owner.organization.id, target.id),
    db.getTask(owner.organization.id, source.rootTaskId), db.getTask(owner.organization.id, target.rootTaskId), db.getPart(owner.organization.id, part.id)];
  const before = snapshot();
  assert.equal((await request(endpoint(source), null)).status, 401);
  const added = await request(endpoint(source), owner, 'POST', { projectId: target.id });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.deepEqual(ids(added), [target.id]);
  assert.deepEqual(Object.keys(added.body.projects[0]).sort(), ['dueAt', 'id', 'owner', 'rootTaskId', 'stage', 'title']);
  assert.deepEqual(added.body.capabilities, { canWrite: true });
  assert.deepEqual(ids(await request(endpoint(target))), []);
  const auditCount = () => sql.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action LIKE 'project.link.%' AND entity_id = ?").get(source.id).count;
  assert.equal(auditCount(), 1);
  assert.deepEqual((await request(endpoint(source), owner, 'POST', { projectId: target.id })).body, added.body);
  assert.equal(auditCount(), 1);
  assert.deepEqual(snapshot(), before);
  const reopened = await createDatabase({ dbPath: join(directory, 'test.sqlite') });
  try { assert.deepEqual(reopened.listProjectLinks(owner.organization.id, owner.user.id, source.id), added.body); }
  finally { reopened.close(); }
  assert.deepEqual(ids(await request(`${endpoint(source)}/${target.id}`, owner, 'DELETE')), []);
  assert.equal(auditCount(), 2);
  assert.deepEqual(ids(await request(`${endpoint(source)}/${target.id}`, owner, 'DELETE')), []);
  assert.equal(auditCount(), 2);
  assert.deepEqual(snapshot(), before);
});

test('project creator, current responsible person and enterprise deputy require explicit project write permission', async () => {
  const employee = member(), deputy = member('admin'), source = project(employee), target = project();
  participate(target, employee);
  db.updateTask(owner.organization.id, source.rootTaskId, { owner: employee.user.displayName, assigneeUserId: employee.user.id });
  db.syncProjectFromRootTask(owner.organization.id, db.getTask(owner.organization.id, source.rootTaskId));
  assert.equal(db.getTask(owner.organization.id, source.rootTaskId).assigneeUserId, employee.user.id);
  assert.equal(db.getProject(owner.organization.id, source.id).ownerUserId, employee.user.id);
  for (const actor of [employee, deputy]) {
    assert.deepEqual((await request(endpoint(source), actor)).body.capabilities, { canWrite: false });
    assert.equal((await request(`${endpoint(source)}/candidates`, actor)).status, 403);
    assert.equal((await request(endpoint(source), actor, 'POST', { projectId: target.id })).status, 403);
    assert.equal((await request(`${endpoint(source)}/${target.id}`, actor, 'DELETE')).status, 403);
  }
  grant(employee, { 'project.write': true });
  assert.equal((await request(endpoint(source), employee, 'POST', { projectId: target.id })).status, 200);
  grant(employee, { 'project.write': false });
  assert.deepEqual(ids(await request(endpoint(source), employee)), [target.id]);
  assert.equal((await request(`${endpoint(source)}/${target.id}`, employee, 'DELETE')).status, 403);
  assert.throws(() => db.removeProjectLink(owner.organization.id, employee.user.id, source.id, target.id), { status: 403 });
  grant(deputy, { 'project.write': true });
  assert.equal((await request(`${endpoint(source)}/${target.id}`, deputy, 'DELETE')).status, 200);
});

test('candidate and linked project visibility enforce current membership, tenant and active project scope', async () => {
  const employee = member(), source = project(), allowed = project(), hidden = project(), retired = project();
  participate(source, employee); participate(allowed, employee); participate(retired, employee);
  grant(employee, { 'project.write': true });
  db.recycleResource(owner.organization.id, owner.user.id, 'project', retired.id);
  const foreignOrganization = db.createOrganization({ name: 'Foreign link company', slug: `foreign-links-${++sequence}`, ownerUserId: employee.user.id });
  const foreign = db.createProject({ organizationId: foreignOrganization.id, userId: employee.user.id, title: 'Foreign confidential project', stage: '立项沟通' });
  let candidates = await request(`${endpoint(source)}/candidates`, employee);
  assert.deepEqual(ids(candidates), [allowed.id]);
  for (const target of [hidden, retired, foreign, { id: 'missing-project' }]) {
    const response = await request(endpoint(source), employee, 'POST', { projectId: target.id });
    assert.equal(response.status, 404);
    assert.equal(response.body.error, 'linked_project_not_found');
    assert.equal((await request(`${endpoint(source)}/${target.id}`, employee, 'DELETE')).status, 404);
  }
  assert.equal((await request(endpoint(hidden), employee)).status, 403);
  assert.equal((await request(endpoint(foreign), employee)).status, 404);
  assert.throws(() => db.listProjectLinks(owner.organization.id, 'missing-member', source.id), { status: 403 });
  await request(endpoint(source), employee, 'POST', { projectId: allowed.id });
  assert.deepEqual(ids(await request(`${endpoint(source)}/candidates`, employee)), []);
  sql.prepare('DELETE FROM project_members WHERE organization_id = ? AND project_id = ? AND user_id = ?')
    .run(owner.organization.id, allowed.id, employee.user.id);
  assert.deepEqual(ids(await request(endpoint(source), employee)), []);
  assert.equal(linksInSql(source).length, 1);
  assert.equal((await request(`${endpoint(source)}/${allowed.id}`, employee, 'DELETE')).status, 404);
  participate(allowed, employee);
  assert.deepEqual(ids(await request(endpoint(source), employee)), [allowed.id]);
  sql.prepare('DELETE FROM project_members WHERE organization_id = ? AND project_id = ? AND user_id = ?')
    .run(owner.organization.id, source.id, employee.user.id);
  assert.equal((await request(endpoint(source), employee)).status, 403);
  assert.equal((await request(`${endpoint(source)}/candidates`, employee)).status, 403);
});

test('links reject self relations and malformed bodies and respect disabled project modules', async () => {
  const source = project(), target = project();
  assert.throws(() => db.addProjectLink(owner.organization.id, owner.user.id, source.id, null), { status: 400 });
  for (const input of [[], {}, { projectId: 4 }, { projectId: '' }, { projectId: 'a'.repeat(101) },
    { projectId: source.id }, { projectId: target.id, fileId: 'file-1' }]) {
    assert.equal((await request(endpoint(source), owner, 'POST', input)).status, 400, JSON.stringify(input));
  }
  assert.equal((await request(`${endpoint(source)}/${source.id}`, owner, 'DELETE')).status, 400);
  const modules = db.listOrganizationModules(owner.organization.id);
  try {
    db.setOrganizationModules(owner.organization.id, { ...modules, projects: false });
    assert.equal((await request(endpoint(source))).status, 403);
    assert.equal((await request(`${endpoint(source)}/candidates`)).status, 403);
    assert.equal((await request(endpoint(source), owner, 'POST', { projectId: target.id })).status, 403);
    assert.equal((await request(`${endpoint(source)}/${target.id}`, owner, 'DELETE')).status, 403);
  } finally { db.setOrganizationModules(owner.organization.id, modules); }
  assert.equal(linksInSql(source).length, 0);
});

test('recycling hides links in both directions without losing them and restoring recovers visibility', async () => {
  const source = project(), target = project();
  db.addProjectLink(owner.organization.id, owner.user.id, source.id, { projectId: target.id });
  const targetEntry = db.recycleResource(owner.organization.id, owner.user.id, 'project', target.id);
  assert.deepEqual(ids(await request(endpoint(source))), []);
  assert.equal(linksInSql(source).length, 1);
  assert.equal((await request(endpoint(target))).status, 404);
  assert.equal((await request(`${endpoint(source)}/${target.id}`, owner, 'DELETE')).status, 404);
  db.restoreRecycledResource(owner.organization.id, owner.user.id, targetEntry.id);
  assert.deepEqual(ids(await request(endpoint(source))), [target.id]);
  const sourceEntry = db.recycleResource(owner.organization.id, owner.user.id, 'project', source.id);
  assert.equal((await request(endpoint(source))).status, 404);
  assert.equal((await request(`${endpoint(source)}/candidates`)).status, 404);
  assert.equal((await request(endpoint(source), owner, 'POST', { projectId: target.id })).status, 404);
  assert.equal((await request(`${endpoint(source)}/${target.id}`, owner, 'DELETE')).status, 404);
  db.restoreRecycledResource(owner.organization.id, owner.user.id, sourceEntry.id);
  assert.deepEqual(ids(await request(endpoint(source))), [target.id]);
});

test('relation changes and audits roll back together on audit failure', () => {
  const source = project(), first = project(), second = project(), args = [owner.organization.id, owner.user.id, source.id];
  db.addProjectLink(...args, { projectId: first.id });
  const before = linksInSql(source), auditBefore = db.listAudit(owner.organization.id), originalAudit = db.addAudit;
  db.addAudit = input => { originalAudit(input); throw new Error('link audit failure'); };
  try {
    assert.throws(() => db.addProjectLink(...args, { projectId: second.id }), /link audit failure/);
    assert.deepEqual(linksInSql(source), before);
    assert.deepEqual(db.listAudit(owner.organization.id), auditBefore);
    assert.throws(() => db.removeProjectLink(...args, first.id), /link audit failure/);
    assert.deepEqual(linksInSql(source), before);
    assert.deepEqual(db.listAudit(owner.organization.id), auditBefore);
  } finally { db.addAudit = originalAudit; }
});

test('physical project deletion cascades both outgoing and incoming relations', () => {
  const source = project(), target = project(), remaining = project();
  db.addProjectLink(owner.organization.id, owner.user.id, source.id, { projectId: target.id });
  db.addProjectLink(owner.organization.id, owner.user.id, target.id, { projectId: remaining.id });
  sql.prepare('DELETE FROM projects WHERE id = ?').run(target.id);
  assert.equal(linksInSql(source).length, 0);
  assert.equal(linksInSql(target).length, 0);
  assert.ok(db.getProject(owner.organization.id, source.id));
  assert.ok(db.getProject(owner.organization.id, remaining.id));
});

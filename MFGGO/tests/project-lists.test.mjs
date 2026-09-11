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
const endpoint = project => `/projects/${project.id}/lists`;
const project = (title = `List project ${++sequence}`) => db.createProject({ organizationId: owner.organization.id, userId: owner.user.id, title, stage: '立项沟通' });
const input = (name = 'Mounting plate') => ({ title: 'Production list', items: [{ name, material: 'Aluminum', quantity: 3, notes: 'Inspect holes' }] });
function member(role = 'member') {
  const name = `list_worker_${++sequence}`;
  const user = db.createOrganizationMember(owner.organization.id, owner.user.id, { username: name, displayName: name, temporaryPassword: 'list-worker-123', role });
  const session = db.createSession(user.id, owner.organization.id);
  return { user, token: session.token };
}
const grant = (actor, permissions) => db.updateOrganizationMember(owner.organization.id, owner.user.id, actor.user.id, { permissions });
const participate = (target, actor) => db.addProjectMember({ organizationId: owner.organization.id, projectId: target.id, userId: actor.user.id, createdBy: owner.user.id });
const assertNoMoney = value => assert.doesNotMatch(JSON.stringify(value), /totalCents|unitPrice|subtotal|currency|amount/i);

test.before(async () => {
  previousPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'list-owner-123';
  directory = await mkdtemp(join(tmpdir(), 'mfggo-project-lists-'));
  app = await createApp({ dbPath: join(directory, 'test.sqlite') });
  db = app.context.db;
  sql = new DatabaseSync(join(directory, 'test.sqlite'));
  server = createServer(app.callback());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${server.address().port}`;
  owner = (await request('/auth/login', null, 'POST', { username: 'admin', password: 'list-owner-123' })).body;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  sql.close(); app.close();
  await rm(directory, { recursive: true, force: true });
  if (previousPassword === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
  else process.env.INITIAL_ADMIN_PASSWORD = previousPassword;
});

test('project list authorization is separate from role, executor, parts and quote permissions and revokes live', async () => {
  const target = project(), employee = member(), deputy = member('admin');
  participate(target, employee);
  assert.equal((await request(endpoint(target), employee)).status, 403);
  assert.equal((await request(endpoint(target), deputy)).status, 403);
  grant(employee, { 'part.read': true, 'part.write': true, 'quote.read': true, 'quote.write': true });
  assert.equal((await request(endpoint(target), employee)).status, 403);
  grant(employee, { 'project.list.read': true });
  let response = await request(endpoint(target), employee);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.capabilities, { canRead: true, canWrite: false });
  assert.equal((await request(endpoint(target), employee, 'POST', input())).status, 403);
  grant(employee, { 'project.list.write': true });
  response = await request(endpoint(target), employee, 'POST', input());
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.notEqual(db.getTask(owner.organization.id, target.rootTaskId).assigneeUserId, employee.user.id);
  const created = response.body.list;
  grant(employee, { 'project.list.read': false });
  assert.equal((await request(`${endpoint(target)}/${created.id}`, employee)).status, 403);
  assert.equal((await request(`${endpoint(target)}/${created.id}`, employee, 'PUT', { ...input(), revision: 1 })).status, 403);
  assert.equal((await request(`${endpoint(target)}/selection`, employee, 'PUT', { listId: created.id })).status, 403);
  assert.throws(() => db.getProjectList(owner.organization.id, employee.user.id, target.id, created.id), { status: 403 });
  grant(deputy, { 'project.list.read': true, 'project.list.write': true });
  assert.equal((await request(`${endpoint(target)}/${created.id}`, deputy)).status, 200);
});

test('project list reads and writes enforce tenant, project membership, project identity and module access', async () => {
  const target = project(), other = project(), outsider = member();
  grant(outsider, { 'project.list.read': true, 'project.list.write': true });
  assert.equal((await request(endpoint(target), outsider)).status, 403);
  const created = (await request(endpoint(target), owner, 'POST', input())).body.list;
  assert.equal((await request(`${endpoint(other)}/${created.id}`)).status, 404);
  assert.equal((await request(`${endpoint(other)}/selection`, owner, 'PUT', { listId: created.id })).status, 404);
  const foreign = db.createOrganization({ name: 'Foreign list company', slug: `foreign-lists-${++sequence}`, ownerUserId: outsider.user.id });
  const foreignProject = db.createProject({ organizationId: foreign.id, userId: outsider.user.id, title: 'Foreign', stage: '立项沟通' });
  assert.equal((await request(endpoint(foreignProject))).status, 404);
  const foreignActor = { user: outsider.user, ...db.createSession(outsider.user.id, foreign.id) };
  assert.equal((await request(endpoint(target), foreignActor)).status, 404);
  const modules = db.listOrganizationModules(owner.organization.id);
  try {
    db.setOrganizationModules(owner.organization.id, { ...modules, projects: false });
    assert.equal((await request(endpoint(target))).status, 403);
  } finally { db.setOrganizationModules(owner.organization.id, modules); }
});

test('project lists create, replace rows, select, reopen and protect concurrent revisions without financial fields', async () => {
  const target = project();
  const first = await request(endpoint(target), owner, 'POST', input());
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const created = first.body.list;
  assert.equal(first.body.selectedListId, created.id);
  assert.equal(created.revision, 1);
  assert.ok(created.items[0].id);
  assertNoMoney(created);
  const update = { title: 'Edited list', revision: created.revision, items: [{ ...created.items[0], quantity: 8 }, { name: 'Second piece', quantity: 1 }] };
  const edited = await request(`${endpoint(target)}/${created.id}`, owner, 'PUT', update);
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.list.revision, 2);
  assert.equal(edited.body.list.items[0].id, created.items[0].id);
  assert.equal(edited.body.list.items[0].quantity, 8);
  assert.equal((await request(`${endpoint(target)}/${created.id}`, owner, 'PUT', update)).status, 409);
  assert.equal((await request(`${endpoint(target)}/${created.id}`, owner, 'PUT', { ...update, revision: undefined })).status, 400);
  const second = (await request(endpoint(target), owner, 'POST', { title: 'Empty list', items: [] })).body.list;
  assert.equal((await request(endpoint(target))).body.selectedListId, second.id);
  assert.equal((await request(`${endpoint(target)}/selection`, owner, 'PUT', { listId: created.id })).status, 200);
  const state = (await request(endpoint(target))).body;
  assert.equal(state.selectedListId, created.id);
  assert.deepEqual(state.list, edited.body.list);
  assert.equal(state.lists.length, 2);
  assert.equal(state.lists.find(list => list.id === created.id).itemCount, 2);
  assert.equal('items' in state.lists[0], false);
  assertNoMoney(state);
  const reopened = await createDatabase({ dbPath: join(directory, 'test.sqlite') });
  try { assert.deepEqual(reopened.listProjectLists(owner.organization.id, owner.user.id, target.id), state); }
  finally { reopened.close(); }
  assert.equal((await request(`${endpoint(target)}/selection`, owner, 'PUT', { listId: null })).body.list, null);
  assert.equal((await request(endpoint(target))).body.selectedListId, null);
});

test('project list row validation rejects unsupported fields, invalid counts and foreign part links', async () => {
  const target = project(), other = project();
  const foreignPart = db.createPart({ organizationId: owner.organization.id, projectId: other.id, name: 'Foreign part', format: 'STEP', quantity: 1 });
  const validPart = db.createPart({ organizationId: owner.organization.id, projectId: target.id, name: 'Own part', format: 'STEP', quantity: 1 });
  const invalid = [
    { title: '', items: [] }, { title: 'a'.repeat(161), items: [] },
    { title: 'Rows', items: [{ name: 'Part', quantity: 0 }] },
    { title: 'Rows', items: [{ name: 'Part', quantity: 1.5 }] },
    { title: 'Rows', items: [{ name: 'Part', quantity: '1' }] },
    { title: 'Rows', items: [{ name: '', quantity: 1 }] },
    { title: 'Rows', items: [{ name: 'Part', quantity: 1, unitPriceCents: 100 }] },
    { title: 'Rows', items: [{ name: 'Part', quantity: 1, partId: foreignPart.id }] },
    { title: 'Rows', items: [{ name: 'Part', quantity: 1, partId: 'missing' }] },
    { title: 'Rows', items: [{ name: 'Part', quantity: 1, notes: 'x'.repeat(2001) }] },
    { title: 'Rows', items: [{ id: 'same', name: 'Part', quantity: 1 }, { id: 'same', name: 'Other', quantity: 1 }] },
    { title: 'Rows', items: Array.from({ length: 501 }, () => ({ name: 'Part', quantity: 1 })) },
    { title: 'Rows', items: [], sourceQuoteId: 'missing' }
  ];
  for (const value of invalid) assert.equal((await request(endpoint(target), owner, 'POST', value)).status, 400, JSON.stringify(value).slice(0, 200));
  assert.equal((await request(endpoint(target))).body.lists.length, 0);
  const valid = await request(endpoint(target), owner, 'POST', { title: 'Linked parts', items: [{ name: 'Own part', quantity: 1, partId: validPart.id }] });
  assert.equal(valid.status, 201);
  assert.equal(valid.body.list.items[0].partId, validPart.id);
});

test('project list mutations roll back list, selection and revision if audit fails', () => {
  const target = project(), args = [owner.organization.id, owner.user.id, target.id];
  const first = db.createProjectList(...args, input()), second = db.createProjectList(...args, input('Second'));
  const before = db.listProjectLists(...args), originalAudit = db.addAudit;
  db.addAudit = () => { throw new Error('audit failure'); };
  try {
    assert.throws(() => db.createProjectList(...args, input('Rolled back')), /audit failure/);
    assert.throws(() => db.selectProjectList(...args, { listId: first.list.id }), /audit failure/);
    assert.throws(() => db.updateProjectList(...args, second.list.id, { ...input('Rolled back'), revision: 1 }), /audit failure/);
    assert.deepEqual(db.listProjectLists(...args), before);
  } finally { db.addAudit = originalAudit; }
});

test('project lists remain inaccessible while project is recycled and restore with unchanged data', async () => {
  const target = project(), created = (await request(endpoint(target), owner, 'POST', input())).body.list;
  const archived = (await request(`/projects/${target.id}/recycle`, owner, 'POST')).body.item;
  assert.equal((await request(endpoint(target))).status, 404);
  assert.equal((await request(`${endpoint(target)}/${created.id}`)).status, 404);
  assert.equal((await request(endpoint(target), owner, 'POST', input())).status, 404);
  assert.equal((await request(`${endpoint(target)}/${created.id}`, owner, 'PUT', { ...input(), revision: 1 })).status, 404);
  assert.equal((await request(`${endpoint(target)}/selection`, owner, 'PUT', { listId: created.id })).status, 404);
  assert.throws(() => db.getProjectList(owner.organization.id, owner.user.id, target.id, created.id), { status: 404 });
  assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM project_lists WHERE project_id = ?').get(target.id).count, 1);
  assert.equal((await request(`/recycle-bin/${archived.id}/restore`, owner, 'POST')).status, 200);
  assert.deepEqual((await request(endpoint(target))).body.list, created);
});

const importInput = () => ({ quoteMeta: { quoteNo: 'Q-import', currency: 'CNY' }, parts: [{ clientId: 'cad-1', name: 'CAD plate', quantity: 2, material: 'Aluminum', revision: 'A', notes: 'Imported note', unitPriceCents: 150 }] });

test('CAD imports create new selectable snapshots and preserve manually edited lists', async () => {
  const target = project();
  const first = await request(`${endpoint(target)}/import`, owner, 'POST', importInput());
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.parts[0].clientId, 'cad-1');
  const list = first.body.list;
  assert.equal(list.items[0].notes, 'Imported note');
  const edited = db.updateProjectList(owner.organization.id, owner.user.id, target.id, list.id, {
    title: 'Production release', revision: list.revision,
    items: [{ ...list.items[0], revision: 'B', notes: 'Retain inspection note' }, { name: 'Packaging', quantity: 1 }]
  });
  const next = importInput(); next.parts[0].quantity = 7;
  const second = await request(`${endpoint(target)}/import`, owner, 'POST', next);
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.quote.id, first.body.quote.id);
  assert.equal(second.body.parts[0].id, first.body.parts[0].id);
  assert.notEqual(second.body.list.id, list.id);
  assert.equal(second.body.list.items[0].quantity, 7);
  assertNoMoney(second.body.list);
  assert.deepEqual(db.getProjectList(owner.organization.id, owner.user.id, target.id, list.id), edited);
  assert.equal((await request(endpoint(target))).body.selectedListId, second.body.list.id);
});

test('CAD import failures roll back parts, quotes, fair items, lists, selection and audit together', async () => {
  const target = project();
  await request(`${endpoint(target)}/import`, owner, 'POST', importInput());
  const snapshot = () => ['parts', 'quotes', 'quote_lines', 'fair_items', 'project_lists', 'project_list_selections', 'audit_events'].map(table => sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  const before = snapshot();
  const next = importInput();
  next.parts[0].quantity = 9;
  next.fairItems = [{ characteristic: 'Hole diameter', status: 'pending' }];
  const originalAudit = db.addAudit;
  db.addAudit = entry => {
    if (entry.action === 'project_list.create') throw new Error('import audit failure');
    return originalAudit(entry);
  };
  try { assert.throws(() => db.importProjectList(owner.organization.id, owner.user.id, target.id, next), /import audit failure/); }
  finally { db.addAudit = originalAudit; }
  assert.deepEqual(snapshot(), before);
  next.parts.push({ name: 'Bad row', quantity: 0 });
  assert.equal((await request(`${endpoint(target)}/import`, owner, 'POST', next)).status, 400);
  assert.deepEqual(snapshot(), before);
});

test('CAD imports require live list, part, quote and optional fair grants plus project membership', async () => {
  const target = project(), employee = member();
  const path = `${endpoint(target)}/import`;
  grant(employee, { 'project.list.read': true, 'project.list.write': true, 'part.write': true, 'quote.write': true });
  assert.equal((await request(path, employee, 'POST', importInput())).status, 403);
  participate(target, employee);
  assert.equal((await request(path, employee, 'POST', importInput())).status, 201);
  assert.equal((await request(path, employee, 'POST', { ...importInput(), fairItems: [{ characteristic: 'Hole' }] })).status, 403);
  grant(employee, { 'quote.write': false });
  assert.equal((await request(path, employee, 'POST', importInput())).status, 403);
  grant(employee, { 'quote.write': true, 'project.list.write': false });
  assert.equal((await request(path, employee, 'POST', importInput())).status, 403);
  grant(employee, { 'project.list.write': true });
  const modules = db.listOrganizationModules(owner.organization.id);
  try {
    db.setOrganizationModules(owner.organization.id, { ...modules, workspace: false });
    assert.equal((await request(path, employee, 'POST', importInput())).status, 403);
  } finally { db.setOrganizationModules(owner.organization.id, modules); }
  await request(`/projects/${target.id}/recycle`, owner, 'POST');
  assert.equal((await request(path, owner, 'POST', importInput())).status, 404);
});

test('one-time project list migration preserves original quote lines and legacy titles without changing finance or grants', async () => {
  const location = join(directory, 'legacy.sqlite');
  let legacy = await createDatabase({ dbPath: location }), raw = new DatabaseSync(location);
  try {
    const legacyOwner = legacy.authenticate('admin', 'list-owner-123');
    const organizationId = legacyOwner.organization.id, userId = legacyOwner.user.id;
    const target = legacy.createProject({ organizationId, userId, title: 'Migration parts', stage: '立项沟通' });
    const part = legacy.createPart({ organizationId, projectId: target.id, name: 'Part original', format: 'STEP', material: 'Part material', finish: 'Anodizing', dimensions: '20x40', quantity: 7 });
    const unquotedPart = legacy.createPart({ organizationId, projectId: target.id, name: 'Unquoted part', format: 'STEP', quantity: 9 });
    const quote = legacy.createQuote({ organizationId, projectId: target.id, userId, quoteNo: 'Q-preserved', currency: 'CNY', lines: [
      { partId: part.id, name: 'Quoted name', material: 'Quoted material', process: 'Milling', quantity: 2, unitPriceCents: 900 },
      { name: 'Quote-only component', material: 'Steel', quantity: 4, unitPriceCents: 700 }
    ] });
    const partsOnly = legacy.createProject({ organizationId, userId, title: 'Parts-only', stage: '立项沟通' });
    legacy.createPart({ organizationId, projectId: partsOnly.id, name: 'Unquoted', format: 'IGES', quantity: 5 });
    const fullyQuoted = legacy.createProject({ organizationId, userId, title: 'Fully quoted', stage: '立项沟通' });
    const coveredPart = legacy.createPart({ organizationId, projectId: fullyQuoted.id, name: 'Covered part', format: 'STEP', quantity: 5 });
    legacy.createQuote({ organizationId, projectId: fullyQuoted.id, userId, quoteNo: 'Q-covered', lines: [{ partId: coveredPart.id, name: 'Covered', quantity: 1, unitPriceCents: 100 }] });
    const textOnly = legacy.createProject({ organizationId, userId, title: 'Legacy text', stage: '立项沟通' });
    raw.prepare('UPDATE tasks SET project_list = ? WHERE id = ?').run('Named legacy list', textOnly.rootTaskId);
    const recycled = legacy.recycleResource(organizationId, userId, 'project', target.id);
    const originalQuotes = raw.prepare('SELECT * FROM quotes ORDER BY id').all();
    const originalLines = raw.prepare('SELECT * FROM quote_lines ORDER BY id').all();
    const originalTasks = raw.prepare('SELECT * FROM tasks ORDER BY id').all();
    const originalGrants = raw.prepare('SELECT * FROM organization_member_permissions ORDER BY organization_id, user_id, permission_key').all();
    raw.exec('DROP TABLE project_list_selections; DROP TABLE project_lists; DROP TABLE project_list_migrations;');
    raw.close(); legacy.close();
    legacy = await createDatabase({ dbPath: location }); raw = new DatabaseSync(location);
    assert.throws(() => legacy.listProjectLists(organizationId, userId, target.id), { status: 404 });
    legacy.restoreRecycledResource(organizationId, userId, recycled.id);
    const state = legacy.listProjectLists(organizationId, userId, target.id);
    assert.equal(state.lists.length, 2);
    assert.equal(state.list.sourceQuoteId, quote.id);
    assert.equal(state.list.items.length, 2);
    assert.deepEqual(state.list.items.map(item => [item.name, item.quantity, item.material]), [
      ['Quoted name', 2, 'Quoted material'], ['Quote-only component', 4, 'Steel']
    ]);
    assert.equal(state.list.items[0].finish, 'Milling');
    assert.equal(state.list.items[0].dimensions, '20x40');
    assert.equal(state.list.items[1].partId, null);
    const supplementarySummary = state.lists.find(list => !list.sourceQuoteId);
    assert.equal(supplementarySummary.title, '项目零件清单');
    const supplementary = legacy.getProjectList(organizationId, userId, target.id, supplementarySummary.id);
    assert.deepEqual(supplementary.items.map(item => [item.partId, item.name, item.quantity]), [[unquotedPart.id, 'Unquoted part', 9]]);
    assert.equal(supplementary.items.some(item => item.partId === part.id), false);
    assert.equal(legacy.listProjectLists(organizationId, userId, fullyQuoted.id).lists.length, 1);
    assertNoMoney(supplementary);
    assertNoMoney(state);
    assert.equal(legacy.listProjectLists(organizationId, userId, partsOnly.id).list.items[0].quantity, 5);
    assert.equal(legacy.listProjectLists(organizationId, userId, textOnly.id).list.title, 'Named legacy list');
    assert.deepEqual(raw.prepare('SELECT * FROM quotes ORDER BY id').all(), originalQuotes);
    assert.deepEqual(raw.prepare('SELECT * FROM quote_lines ORDER BY id').all(), originalLines);
    assert.deepEqual(raw.prepare('SELECT * FROM tasks ORDER BY id').all(), originalTasks);
    assert.deepEqual(raw.prepare('SELECT * FROM organization_member_permissions ORDER BY organization_id, user_id, permission_key').all(), originalGrants);
    const edited = legacy.updateProjectList(organizationId, userId, target.id, state.list.id, { title: 'Retained manual edit', items: [], revision: 1 });
    raw.close(); legacy.close();
    legacy = await createDatabase({ dbPath: location }); raw = new DatabaseSync(location);
    assert.deepEqual(legacy.listProjectLists(organizationId, userId, target.id).list, edited);
    assert.equal(legacy.listProjectLists(organizationId, userId, target.id).lists.length, 2);
    assert.deepEqual(legacy.getProjectList(organizationId, userId, target.id, supplementary.id), supplementary);
  } finally { raw.close(); legacy.close(); }
});

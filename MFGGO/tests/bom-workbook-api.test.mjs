import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { createDatabase } from '../server/db.js';
import { defaultBomLayout } from '../bom-schema.js';

let app, db, sql, directory, server, address, owner, previousPassword, sequence = 0;
async function request(path, actor = owner, method = 'GET', data) {
  const response = await fetch(`${address}/api${path}`, { method,
    headers: { 'content-type': 'application/json', ...(actor?.token ? { authorization: `Bearer ${actor.token}` } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { status: response.status, body: await response.json() };
}
const endpoint = target => `/projects/${target.id}/lists`;
const project = () => db.createProject({ organizationId: owner.organization.id, userId: owner.user.id, title: `Workbook project ${++sequence}`, stage: '立项沟通' });
const workbook = () => ({ id: `workbook_${++sequence}`, name: 'Free BOM', appVersion: '0.25.1', locale: 'zhCN', styles: {}, sheetOrder: ['bom'],
  sheets: { bom: { id: 'bom', name: 'BOM', rowCount: 300, columnCount: 60,
    cellData: { 0: { 0: { v: '任意表头', s: { bl: 1 } } }, 1: { 0: { v: '不是固定字段' }, 1: { v: -0.5 }, 2: { f: '=B2*3' } } },
    mergeData: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 3 }], rowData: { 0: { h: 48 } }, columnData: { 0: { w: 250 } } } }, resources: [] });
const member = () => {
  const username = `workbook_member_${++sequence}`;
  const user = db.createOrganizationMember(owner.organization.id, owner.user.id, { username, displayName: username, temporaryPassword: 'workbook-worker-123', role: 'member' });
  return { user, ...db.createSession(user.id, owner.organization.id) };
};
const grant = (actor, permissions) => db.updateOrganizationMember(owner.organization.id, owner.user.id, actor.user.id, { permissions });
const participate = (target, actor) => db.addProjectMember({ organizationId: owner.organization.id, projectId: target.id, userId: actor.user.id, createdBy: owner.user.id });

test.before(async () => {
  previousPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'workbook-owner-123';
  directory = await mkdtemp(join(tmpdir(), 'mfggo-workbook-'));
  app = await createApp({ dbPath: join(directory, 'test.sqlite') });
  db = app.context.db; sql = new DatabaseSync(join(directory, 'test.sqlite'));
  server = createServer(app.callback());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${server.address().port}`;
  owner = (await request('/auth/login', null, 'POST', { username: 'admin', password: 'workbook-owner-123' })).body;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  sql.close(); app.close();
  await rm(directory, { recursive: true, force: true });
  if (previousPassword === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
  else process.env.INITIAL_ADMIN_PASSWORD = previousPassword;
});

test('whole workbooks persist without fixed item fields and survive restart, permissions, and revision conflicts', async () => {
  const target = project(), book = workbook();
  const created = await request(endpoint(target), owner, 'POST', { title: 'Workbook', workbook: book });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  let list = created.body.list;
  assert.deepEqual(list.workbook, book);
  assert.deepEqual(list.items, []);
  const all = (await request(endpoint(target))).body;
  assert.equal(all.lists.find(value => value.id === list.id).hasWorkbook, true);
  assert.equal(all.lists.find(value => value.id === list.id).workbook, undefined);
  assert.deepEqual(all.list.workbook, book);
  book.sheets.bom.cellData[1][1].v = '数量可以填写文字';
  const edited = await request(`${endpoint(target)}/${list.id}`, owner, 'PUT', { title: 'Edited', revision: list.revision, workbook: book });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  list = edited.body.list;
  assert.deepEqual(list.workbook, book);
  assert.equal((await request(`${endpoint(target)}/${list.id}`, owner, 'PUT', { title: 'Old edit', revision: 1, workbook: book })).status, 409);
  for (const value of [undefined, null]) {
    const rejected = await request(`${endpoint(target)}/${list.id}`, owner, 'PUT', { title: 'Old client', revision: list.revision, items: [], workbook: value });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.error, 'bom_workbook_required');
  }
  const employee = member(); grant(employee, { 'project.list.read': true, 'project.list.write': true });
  assert.equal((await request(`${endpoint(target)}/${list.id}`, employee)).status, 403);
  participate(target, employee);
  assert.deepEqual((await request(`${endpoint(target)}/${list.id}`, employee)).body.list.workbook, book);
  grant(employee, { 'project.list.write': false });
  assert.equal((await request(`${endpoint(target)}/${list.id}`, employee, 'PUT', { title: 'Denied', revision: list.revision, workbook: book })).status, 403);
  grant(employee, { 'project.list.read': false });
  assert.equal((await request(`${endpoint(target)}/${list.id}`, employee)).status, 403);
  const reopened = await createDatabase({ dbPath: join(directory, 'test.sqlite') });
  try { assert.deepEqual(reopened.getProjectList(owner.organization.id, owner.user.id, target.id, list.id), list); }
  finally { reopened.close(); }
});

test('upgrading legacy lists retains the original BOM rows, layout and independently protected quote data', async () => {
  const target = project(), layout = defaultBomLayout();
  const quote = db.createQuote({ organizationId: owner.organization.id, userId: owner.user.id, projectId: target.id, quoteNo: 'Protected price', lines: [{ name: 'Plate', quantity: 2, unitPriceCents: 250 }] });
  const original = (await request(endpoint(target), owner, 'POST', { title: 'Original', sourceQuoteId: quote.id, layout, items: [{ name: 'Plate', quantity: 2 }] })).body.list;
  assert.equal(original.workbook, null);
  const before = sql.prepare('SELECT items_json, layout_json FROM project_lists WHERE id = ?').get(original.id);
  const employee = member(); participate(target, employee); grant(employee, { 'project.list.read': true, 'project.list.write': true, 'quote.read': false });
  const converted = await request(`${endpoint(target)}/${original.id}`, employee, 'PUT', { title: 'Converted', revision: 1, workbook: workbook(), items: [] });
  assert.equal(converted.status, 200, JSON.stringify(converted.body));
  assert.deepEqual(converted.body.list.items, original.items);
  assert.deepEqual(converted.body.list.layout, layout);
  assert.deepEqual(sql.prepare('SELECT items_json, layout_json FROM project_lists WHERE id = ?').get(original.id), before);
  assert.equal(db.getQuote(owner.organization.id, target.id, quote.id).lines[0].unitPriceCents, 250);
  assert.equal(JSON.stringify(converted.body.list).includes('unitPriceCents'), false);
});

test('workbook templates default to structure and maintain immutable content opt-in versions', async () => {
  const target = project(), book = workbook();
  const created = await request(`${endpoint(target)}/templates`, owner, 'POST', { name: 'Format', workbook: book });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const template = created.body.template;
  assert.equal(template.workbook.name, 'Format');
  assert.deepEqual(template.workbook.sheets.bom.cellData, { 0: { 0: { s: { bl: 1 } } } });
  const updated = await request(`${endpoint(target)}/templates/${template.id}`, owner, 'PUT', { name: 'Content template', revision: 1, workbook: book, includeContent: true });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.template.workbook.sheets.bom.cellData[1][2].f, '=B2*3');
  assert.deepEqual(JSON.parse(sql.prepare('SELECT workbook_json FROM project_list_template_versions WHERE template_id = ? AND revision = 1').get(template.id).workbook_json), template.workbook);
  assert.deepEqual((await request(`${endpoint(target)}/templates`)).body.templates.find(value => value.id === template.id).workbook, updated.body.template.workbook);
  assert.equal((await request(`${endpoint(target)}/templates/${template.id}`, owner, 'PUT', { name: 'Old template', revision: 2, layout: defaultBomLayout() })).status, 409);
  assert.equal((await request(`${endpoint(target)}/templates`, owner, 'POST', { name: 'Invalid option', workbook: book, includeContent: 'true' })).status, 400);
  const employee = member(); participate(target, employee); grant(employee, { 'project.list.read': true, 'project.list.write': true });
  assert.equal((await request(`${endpoint(target)}/templates`, employee, 'POST', { name: 'Not manager', workbook: book, includeContent: true })).status, 403);
});

test('workbook mutations are atomic and project or tenant authorization is enforced', async () => {
  const target = project(), other = project(), args = [owner.organization.id, owner.user.id, target.id];
  const original = db.createProjectList(...args, { title: 'Atomic', workbook: workbook() }).list;
  const before = sql.prepare('SELECT * FROM project_lists WHERE id = ?').get(original.id), audit = db.addAudit;
  db.addAudit = () => { throw new Error('workbook audit failure'); };
  try {
    assert.throws(() => db.updateProjectList(...args, original.id, { title: 'Changed', revision: 1, workbook: workbook() }), /workbook audit failure/);
    assert.deepEqual(sql.prepare('SELECT * FROM project_lists WHERE id = ?').get(original.id), before);
  } finally { db.addAudit = audit; }
  assert.equal((await request(`${endpoint(other)}/${original.id}`)).status, 404);
  const employee = member(), foreign = db.createOrganization({ name: 'Foreign workbook', slug: `foreign-workbook-${++sequence}`, ownerUserId: employee.user.id });
  const foreignActor = { user: employee.user, ...db.createSession(employee.user.id, foreign.id) };
  assert.equal((await request(`${endpoint(target)}/${original.id}`, foreignActor)).status, 404);
  const recycled = db.recycleResource(owner.organization.id, owner.user.id, 'project', target.id);
  assert.equal((await request(`${endpoint(target)}/${original.id}`)).status, 404);
  assert.equal((await request(`${endpoint(target)}/${original.id}`, owner, 'PUT', { title: 'Recycled', revision: 1, workbook: workbook() })).status, 404);
  db.restoreRecycledResource(owner.organization.id, owner.user.id, recycled.id);
});

test('large workbook JSON is accepted only by workbook routes and invalid snapshots never persist', async () => {
  const target = project(), book = workbook();
  book.sheets.bom.cellData[2] = { 0: { v: 'x'.repeat(2 * 1024 * 1024 + 1) } };
  const saved = await request(endpoint(target), owner, 'POST', { title: 'Large workbook', workbook: book });
  assert.equal(saved.status, 201, JSON.stringify(saved.body).slice(0, 500));
  assert.equal((await request('/auth/login', null, 'POST', { username: 'x'.repeat(2 * 1024 * 1024 + 1), password: 'unused' })).status, 413);
  assert.equal((await request(`${endpoint(target)}/selection`, owner, 'PUT', { listId: 'x'.repeat(2 * 1024 * 1024 + 1) })).status, 413);
  book.sheets.bom.mergeData[0].endColumn = 300;
  const failed = await request(endpoint(target), owner, 'POST', { title: 'Invalid workbook', workbook: book });
  assert.equal(failed.status, 400);
  assert.equal(failed.body.error, 'invalid_bom_workbook');
  assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM project_lists WHERE project_id = ?').get(target.id).count, 1);
});

test('workbook migration adds nullable snapshots without changing legacy list or template records', async () => {
  const location = join(directory, 'pre-workbook.sqlite');
  let legacy = await createDatabase({ dbPath: location }), raw = new DatabaseSync(location);
  try {
    const actor = legacy.authenticate('admin', 'workbook-owner-123'), organizationId = actor.organization.id, userId = actor.user.id;
    const target = legacy.createProject({ organizationId, userId, title: 'Old database', stage: '立项沟通' });
    const list = legacy.createProjectList(organizationId, userId, target.id, { title: 'Untouched BOM', layout: defaultBomLayout(), items: [{ name: 'Plate', quantity: 7 }] }).list;
    const template = legacy.createProjectListTemplate(organizationId, userId, target.id, { name: 'Old template', layout: defaultBomLayout() }).template;
    const tables = ['project_lists', 'project_list_templates', 'project_list_template_versions'];
    for (const table of tables) raw.exec(`ALTER TABLE ${table} DROP COLUMN workbook_json`);
    raw.prepare('DELETE FROM project_list_migrations WHERE version = ?').run('project-lists-workbook-v1');
    const before = tables.map(table => raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row })));
    const selectedBefore = raw.prepare('SELECT * FROM project_list_selections ORDER BY project_id').all();
    raw.close(); legacy.close();
    legacy = await createDatabase({ dbPath: location }); raw = new DatabaseSync(location);
    assert.deepEqual(tables.map(table => raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(({ workbook_json, ...row }) => {
      assert.equal(workbook_json, null); return row;
    })), before);
    assert.deepEqual(legacy.getProjectList(organizationId, userId, target.id, list.id), list);
    assert.deepEqual(legacy.listProjectListTemplates(organizationId, userId, target.id).templates.find(value => value.id === template.id), template);
    assert.deepEqual(raw.prepare('SELECT * FROM project_list_selections ORDER BY project_id').all(), selectedBefore);
    assert.equal(raw.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { raw.close(); legacy.close(); }
});

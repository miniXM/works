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
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WQAAAABJRU5ErkJggg==';
async function request(path, actor = owner, method = 'GET', data) {
  const response = await fetch(`${address}/api${path}`, { method,
    headers: { 'content-type': 'application/json', ...(actor?.token ? { authorization: `Bearer ${actor.token}` } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
const endpoint = project => `/projects/${project.id}/lists`;
const project = () => db.createProject({ organizationId: owner.organization.id, userId: owner.user.id, title: `BOM project ${++sequence}`, stage: '立项沟通' });
function member(role = 'member') {
  const name = `bom_worker_${++sequence}`;
  const user = db.createOrganizationMember(owner.organization.id, owner.user.id, { username: name, displayName: name, temporaryPassword: 'bom-worker-123', role });
  return { user, ...db.createSession(user.id, owner.organization.id) };
}
const grant = (actor, permissions) => db.updateOrganizationMember(owner.organization.id, owner.user.id, actor.user.id, { permissions });
const participate = (target, actor) => db.addProjectMember({ organizationId: owner.organization.id, projectId: target.id, userId: actor.user.id, createdBy: owner.user.id });
function customLayout() {
  const layout = defaultBomLayout();
  layout.columns.push(
    { key: 'custom_note', label: 'Customer note', type: 'text', width: 140, visible: false },
    { key: 'custom_mass', label: 'Mass', type: 'number', width: 100, visible: true },
    { key: 'custom_date', label: 'Delivery', type: 'date', width: 120, visible: true },
    { key: 'custom_grade', label: 'Grade', type: 'select', width: 100, visible: true, options: ['A', 'B'] },
    { key: 'custom_checked', label: 'Checked', type: 'checkbox', width: 80, visible: true }
  );
  return layout;
}
const customValues = () => ({ custom_note: 'Retain hidden note', custom_mass: 0, custom_date: '2026-09-07', custom_grade: 'A', custom_checked: false });

test.before(async () => {
  previousPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'bom-owner-123';
  directory = await mkdtemp(join(tmpdir(), 'mfggo-bom-lists-'));
  app = await createApp({ dbPath: join(directory, 'test.sqlite') });
  db = app.context.db; sql = new DatabaseSync(join(directory, 'test.sqlite'));
  server = createServer(app.callback());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${server.address().port}`;
  owner = (await request('/auth/login', null, 'POST', { username: 'admin', password: 'bom-owner-123' })).body;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  sql.close(); app.close();
  await rm(directory, { recursive: true, force: true });
  if (previousPassword === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
  else process.env.INITIAL_ADMIN_PASSWORD = previousPassword;
});

test('only the responsible person or an organization-granted member can manage participants', async () => {
  const target = project(), worker = member(), other = member();
  participate(target, worker); participate(target, other);
  const path = `/projects/${target.id}/members/${other.user.id}`;
  assert.equal((await request(path, worker, 'DELETE')).status, 403);
  sql.prepare('UPDATE tasks SET assignee_user_id = ? WHERE id = ?').run(worker.user.id, target.rootTaskId);
  assert.equal((await request(`/projects/${target.id}/members/${owner.user.id}`, worker, 'DELETE')).status, 200);
  grant(worker, { 'project.members.manage': true });
  sql.prepare('UPDATE tasks SET assignee_user_id = ? WHERE project_id = ?').run(other.user.id, target.id);
  assert.equal((await request(path, worker, 'DELETE')).status, 409);
  sql.prepare('UPDATE tasks SET assignee_user_id = ? WHERE project_id = ?').run(worker.user.id, target.id);
  const staleMember = await request(`/projects/${target.id}/members/not-a-project-member`, worker, 'DELETE');
  assert.equal(staleMember.status, 404);
  assert.equal(staleMember.body.error, 'project_member_not_found');
  const audit = db.addAudit;
  db.addAudit = () => { throw new Error('audit failed'); };
  try { assert.throws(() => db.removeProjectMember(owner.organization.id, target.id, other.user.id, owner.user.id), /audit failed/); }
  finally { db.addAudit = audit; }
  assert.equal(db.listProjectMembers(owner.organization.id, target.id).some(value => value.id === other.user.id), true);
  assert.equal((await request(path, worker, 'DELETE')).status, 200);
  assert.equal(db.listProjectMembers(owner.organization.id, target.id).some(value => value.id === other.user.id), false);
  const removal = db.listAudit(owner.organization.id).find(event => event.action === 'project.member.remove' && event.entityId === `${target.id}:${other.user.id}`);
  assert.equal(removal?.metadata?.userName, other.user.displayName);
});

test('enterprise ownership alone does not manage project participants', async () => {
  const target = project(), other = member();
  participate(target, other);
  const path = `/projects/${target.id}/members/${other.user.id}`;
  const denied = await request(path, owner, 'DELETE');
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, 'project_member_manage_denied');
  assert.match(denied.body.message, /当前负责人/);
  sql.prepare('UPDATE tasks SET assignee_user_id = ? WHERE id = ?').run(owner.user.id, target.rootTaskId);
  assert.equal((await request(path, owner, 'DELETE')).status, 200);
});

test('BOM persists typed fields, images and layout without altering quote prices; legacy edits retain additions', async () => {
  const target = project();
  const image = (await request(`${endpoint(target)}/images`, owner, 'POST', { name: 'Plate.png', dataUrl: pixel })).body.image;
  const quote = db.createQuote({ organizationId: owner.organization.id, userId: owner.user.id, projectId: target.id, quoteNo: 'BOM-PRICE', lines: [{ name: 'Plate', quantity: 1, unitPriceCents: 250 }] });
  const created = await request(endpoint(target), owner, 'POST', { title: 'Rich BOM', sourceQuoteId: quote.id, layout: customLayout(),
    items: [{ name: 'Plate', quantity: 1, imageId: image.id, customValues: customValues() }] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const list = created.body.list;
  assert.deepEqual(list.items[0].customValues, customValues());
  assert.equal(list.items[0].imageId, image.id);
  assert.equal(list.layout.columns.find(column => column.key === 'custom_note').visible, false);
  const employee = member(); participate(target, employee);
  grant(employee, { 'project.list.read': true, 'project.list.write': true });
  const plain = { ...list.items[0] }; delete plain.customValues; delete plain.imageId;
  const edited = await request(`${endpoint(target)}/${list.id}`, employee, 'PUT', { title: 'Legacy edit', revision: 1, items: [{ ...plain, quantity: 3 }] });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.deepEqual(edited.body.list.layout, list.layout);
  assert.deepEqual(edited.body.list.items[0].customValues, customValues());
  assert.equal(edited.body.list.items[0].imageId, image.id);
  assert.equal(db.getQuote(owner.organization.id, target.id, quote.id).lines[0].unitPriceCents, 250);
  const partial = await request(`${endpoint(target)}/${list.id}`, employee, 'PUT', { title: 'Partial fields', revision: 2,
    items: [{ ...edited.body.list.items[0], customValues: { custom_mass: 2 } }] });
  assert.equal(partial.status, 200, JSON.stringify(partial.body));
  assert.deepEqual(partial.body.list.items[0].customValues, { ...customValues(), custom_mass: 2 });
  const reopened = await createDatabase({ dbPath: join(directory, 'test.sqlite') });
  try { assert.deepEqual(reopened.getProjectList(owner.organization.id, owner.user.id, target.id, list.id), partial.body.list); }
  finally { reopened.close(); }
});

test('BOM rejects schema injection, duplicate fields, invalid typed values and unsupported financial values', async () => {
  const target = project();
  const invalidLayouts = [
    { ...customLayout(), script: '<script>' },
    { ...customLayout(), style: { ...customLayout().style, headerColor: 'url(javascript:alert(1))' } },
    { ...customLayout(), columns: [...customLayout().columns, customLayout().columns[0]] },
    { ...customLayout(), columns: customLayout().columns.map(column => ({ ...column, visible: false })) }
  ];
  for (const layout of invalidLayouts) assert.equal((await request(endpoint(target), owner, 'POST', { title: 'Invalid', layout, items: [] })).status, 400);
  for (const values of [{ custom_mass: '12' }, { custom_date: '2026-02-30' }, { custom_checked: 'false' }, { custom_grade: 'C' }, { custom_unknown: 'x' }, { custom_mass: 1e15 }, { unitPrice: 5 }]) {
    assert.equal((await request(endpoint(target), owner, 'POST', { title: 'Invalid fields', layout: customLayout(), items: [{ name: 'Part', quantity: 1, customValues: values }] })).status, 400, JSON.stringify(values));
  }
  assert.equal((await request(endpoint(target), owner, 'POST', { title: 'Invalid prices', layout: customLayout(), items: [{ name: 'Part', quantity: 1, unitPrice: 5 }] })).status, 400);
  assert.equal((await request(endpoint(target))).body.lists.length, 0);
});

test('enterprise templates require management grants and retain immutable versions and list snapshots', async () => {
  const target = project(), second = project(), worker = member(), deputy = member('admin');
  participate(target, worker); grant(worker, { 'project.list.read': true, 'project.list.write': true });
  const data = { name: 'Manufacturing', layout: customLayout() };
  assert.equal((await request(`${endpoint(target)}/templates`, worker, 'POST', data)).status, 403);
  assert.deepEqual((await request(`${endpoint(target)}/templates`, worker)).body.capabilities, { canManageTemplates: false });
  assert.equal((await request(`${endpoint(target)}/templates`, deputy)).status, 403);
  grant(deputy, { 'project.list.read': true, 'project.list.write': true });
  const created = await request(`${endpoint(target)}/templates`, deputy, 'POST', data);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const template = created.body.template;
  assert.equal((await request(`${endpoint(second)}/templates`)).body.templates.some(value => value.id === template.id), true);
  const applied = { ...template.layout, templateId: template.id, templateRevision: template.revision };
  const list = (await request(endpoint(target), worker, 'POST', { title: 'Snapshot', layout: applied, items: [] })).body.list;
  const updated = await request(`${endpoint(target)}/templates/${template.id}`, deputy, 'PUT', { name: 'Manufacturing v2', layout: defaultBomLayout(), revision: 1 });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.template.revision, 2);
  assert.equal((await request(`${endpoint(target)}/templates/${template.id}`, deputy, 'PUT', { ...data, revision: 1 })).status, 409);
  assert.deepEqual((await request(`${endpoint(target)}/${list.id}`)).body.list.layout, applied);
  assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM project_list_template_versions WHERE template_id = ?').get(template.id).count, 2);
  assert.equal((await request(endpoint(target), worker, 'POST', { title: 'Old template snapshot', layout: applied, items: [] })).status, 201);
  assert.equal((await request(endpoint(target), worker, 'POST', { title: 'Missing version', layout: { ...applied, templateRevision: 20 }, items: [] })).status, 400);
  grant(deputy, { 'project.list.write': false });
  assert.equal((await request(`${endpoint(target)}/templates/${template.id}`, deputy, 'PUT', { ...data, revision: 2 })).status, 403);
});

test('BOM images and templates enforce tenant, project membership and live permissions', async () => {
  const target = project(), other = project(), employee = member();
  const uploaded = await request(`${endpoint(target)}/images`, owner, 'POST', { name: 'Part.png', dataUrl: pixel });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const image = uploaded.body.image;
  assert.equal(uploaded.headers.get('cache-control'), 'private, no-store');
  const binary = await fetch(`${address}/api/projects/${target.id}/list-images/${image.id}`, { headers: { authorization: `Bearer ${owner.token}` } });
  assert.equal(binary.status, 200);
  assert.equal(binary.headers.get('content-type'), 'image/png');
  assert.equal(binary.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await binary.arrayBuffer()), Buffer.from(pixel.split(',')[1], 'base64'));
  assert.equal((await request(`${endpoint(target)}/images/${image.id}`, null)).status, 401);
  assert.equal((await request(`${endpoint(other)}/images/${image.id}`)).status, 404);
  assert.equal((await request(endpoint(other), owner, 'POST', { title: 'Foreign image', items: [{ name: 'Part', quantity: 1, imageId: image.id }] })).status, 400);
  grant(employee, { 'project.list.read': true, 'project.list.write': true });
  assert.equal((await request(`${endpoint(target)}/images/${image.id}`, employee)).status, 403);
  participate(target, employee);
  assert.deepEqual((await request(`${endpoint(target)}/images/${image.id}`, employee)).body.image, image);
  grant(employee, { 'project.list.write': false });
  assert.equal((await request(`${endpoint(target)}/images`, employee, 'POST', { name: 'Denied.png', dataUrl: pixel })).status, 403);
  grant(employee, { 'project.list.read': false });
  assert.equal((await request(`${endpoint(target)}/images/${image.id}`, employee)).status, 403);
  const foreign = db.createOrganization({ name: 'Foreign BOM', slug: `foreign-bom-${++sequence}`, ownerUserId: employee.user.id });
  const foreignProject = db.createProject({ organizationId: foreign.id, userId: employee.user.id, title: 'Foreign', stage: '立项沟通' });
  const foreignActor = { user: employee.user, ...db.createSession(employee.user.id, foreign.id) };
  assert.equal((await request(`${endpoint(target)}/images/${image.id}`, foreignActor)).status, 404);
  const template = (await request(`${endpoint(target)}/templates`, owner, 'POST', { name: 'Private', layout: customLayout() })).body.template;
  assert.equal((await request(`${endpoint(foreignProject)}/templates`, foreignActor)).body.templates.some(value => value.id === template.id), false);
  assert.equal((await request(`${endpoint(foreignProject)}/templates/${template.id}`, foreignActor, 'PUT', { name: 'Invalid', layout: customLayout(), revision: 1 })).status, 404);
  assert.equal((await request(endpoint(foreignProject), foreignActor, 'POST', { title: 'Invalid', layout: { ...template.layout, templateId: template.id, templateRevision: 1 }, items: [] })).status, 400);
  const recycled = db.recycleResource(owner.organization.id, owner.user.id, 'project', target.id);
  assert.equal((await request(`${endpoint(target)}/images/${image.id}`)).status, 404);
  assert.equal((await request(`${endpoint(target)}/templates`)).status, 404);
  db.restoreRecycledResource(owner.organization.id, owner.user.id, recycled.id);
  assert.deepEqual((await request(`${endpoint(target)}/images/${image.id}`)).body.image, image);
});

test('BOM image upload validates actual signatures, base64 encoding and decoded size', async () => {
  const target = project();
  for (const dataUrl of [
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    pixel.replace('image/png', 'image/jpeg'),
    'data:image/png;base64,SGVsbG8=',
    `${pixel}extra`,
    'data:image/png;base64,a',
    `data:image/png;base64,${Buffer.alloc(524_289).toString('base64')}`
  ]) assert.equal((await request(`${endpoint(target)}/images`, owner, 'POST', { name: 'Invalid.png', dataUrl })).status, 400);
  assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM project_list_images WHERE project_id = ?').get(target.id).count, 0);
});

test('template versions and image records roll back atomically on audit failure', () => {
  const target = project(), args = [owner.organization.id, owner.user.id, target.id];
  const template = db.createProjectListTemplate(...args, { name: 'Before', layout: customLayout() }).template;
  const snapshot = () => ['project_list_templates', 'project_list_template_versions', 'project_list_images', 'audit_events'].map(table => sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  const before = snapshot(), original = db.addAudit;
  db.addAudit = () => { throw new Error('BOM audit failure'); };
  try {
    assert.throws(() => db.createProjectListImage(...args, { name: 'Part.png', dataUrl: pixel }), /BOM audit failure/);
    assert.throws(() => db.createProjectListTemplate(...args, { name: 'New', layout: customLayout() }), /BOM audit failure/);
    assert.throws(() => db.updateProjectListTemplate(...args, template.id, { name: 'After', layout: customLayout(), revision: 1 }), /BOM audit failure/);
    assert.deepEqual(snapshot(), before);
  } finally { db.addAudit = original; }
});

test('upgrading an existing project-list database preserves legacy rows and revisions without rewriting items', async () => {
  const location = join(directory, 'pre-bom.sqlite');
  let legacy = await createDatabase({ dbPath: location }), raw = new DatabaseSync(location);
  try {
    const actor = legacy.authenticate('admin', 'bom-owner-123');
    const organizationId = actor.organization.id, userId = actor.user.id;
    const target = legacy.createProject({ organizationId, userId, title: 'Legacy BOM', stage: '立项沟通' });
    const list = legacy.createProjectList(organizationId, userId, target.id, { title: 'Original', items: [{ name: 'Preserved', quantity: 7, notes: 'Keep original data' }] }).list;
    raw.exec('ALTER TABLE project_lists DROP COLUMN layout_json; DROP TABLE project_list_template_versions; DROP TABLE project_list_templates; DROP TABLE project_list_images;');
    raw.prepare('DELETE FROM project_list_migrations WHERE version = ?').run('project-lists-bom-v1');
    const oldRows = raw.prepare('SELECT * FROM project_lists ORDER BY id').all().map(row => ({ ...row }));
    const oldSelection = raw.prepare('SELECT * FROM project_list_selections ORDER BY project_id').all();
    raw.close(); legacy.close();
    legacy = await createDatabase({ dbPath: location }); raw = new DatabaseSync(location);
    assert.deepEqual(legacy.getProjectList(organizationId, userId, target.id, list.id), list);
    const upgradedRows = raw.prepare('SELECT * FROM project_lists ORDER BY id').all().map(({ layout_json, ...row }) => row);
    assert.deepEqual(upgradedRows, oldRows);
    assert.deepEqual(raw.prepare('SELECT * FROM project_list_selections ORDER BY project_id').all(), oldSelection);
    assert.equal(raw.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { raw.close(); legacy.close(); }
});

test('explicit BOM layouts support empty business cells and free columns while legacy requests keep validation', async () => {
  const target = project();
  const layout = { ...defaultBomLayout(), columns: [{ key: 'custom_free', label: '', type: 'text', width: 180, visible: true }] };
  const response = await request(endpoint(target), owner, 'POST', { title: 'Free table', layout,
    items: [{ name: '', quantity: '', customValues: { custom_free: 'Only a note' } }, { name: '', quantity: null }, {}] });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const list = response.body.list;
  assert.deepEqual(list.items.map(item => [item.name, item.quantity]), [['', null], ['', null], ['', null]]);
  assert.equal(list.layout.columns[0].label, '');
  const withoutLayout = await request(`${endpoint(target)}/${list.id}`, owner, 'PUT', { title: 'Old client edit', revision: 1, items: list.items });
  assert.equal(withoutLayout.status, 200, JSON.stringify(withoutLayout.body));
  assert.deepEqual(withoutLayout.body.list.layout, list.layout);
  for (const quantity of [0, -1, 1.5, '2', 1_000_000_001]) {
    assert.equal((await request(endpoint(target), owner, 'POST', { title: 'Bad numeric cell', layout, items: [{ name: '', quantity }] })).status, 400);
  }
  for (const row of [{ name: '', quantity: 1 }, { name: 'Part', quantity: null }, { name: 'Part', quantity: '' }, {}]) {
    assert.equal((await request(endpoint(target), owner, 'POST', { title: 'Old API', items: [row] })).status, 400);
  }
  const legacy = (await request(endpoint(target), owner, 'POST', { title: 'Legacy', items: [{ name: 'Part', quantity: 1 }] })).body.list;
  assert.equal((await request(`${endpoint(target)}/${legacy.id}`, owner, 'PUT', { title: 'Invalid old edit', revision: 1, items: [{ ...legacy.items[0], name: '', quantity: null }] })).status, 400);
  assert.equal((await request(`${endpoint(target)}/${legacy.id}`, owner, 'PUT', { title: 'Converted table', revision: 1, layout, items: [{ ...legacy.items[0], name: '', quantity: null }] })).status, 200);
});

test('cell styles persist, survive old clients and hidden columns, prune removed columns and clear explicitly', async () => {
  const target = project(), layout = customLayout();
  const cellStyles = { name: { bold: true, color: '#aabbcc', background: '#123456', align: 'center' }, custom_note: { italic: true } };
  const created = await request(endpoint(target), owner, 'POST', { title: 'Styled', layout, items: [{ name: '', quantity: null, cellStyles }] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  let list = created.body.list;
  const rowWithoutStyles = () => { const { cellStyles: omitted, ...row } = list.items[0]; return row; };
  assert.deepEqual(list.items[0].cellStyles, cellStyles);
  const hiddenLayout = { ...list.layout, columns: list.layout.columns.map(column => column.key === 'name' ? { ...column, label: '', visible: false } : column) };
  let edited = await request(`${endpoint(target)}/${list.id}`, owner, 'PUT', { title: list.title, revision: list.revision, layout: hiddenLayout, items: [rowWithoutStyles()] });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  list = edited.body.list;
  assert.deepEqual(list.items[0].cellStyles, cellStyles);
  const prunedLayout = { ...list.layout, columns: list.layout.columns.filter(column => column.key !== 'custom_note') };
  edited = await request(`${endpoint(target)}/${list.id}`, owner, 'PUT', { title: list.title, revision: list.revision, layout: prunedLayout, items: [rowWithoutStyles()] });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  list = edited.body.list;
  assert.deepEqual(list.items[0].cellStyles, { name: cellStyles.name });
  const unchangedRevision = list.revision;
  for (const styles of [{ unknown: { bold: true } }, { custom_note: { italic: true } }, { name: { fontSize: 500 } }, { name: { color: '#fff' } }, { name: { bold: 'true' } }, null, []]) {
    const invalid = await request(`${endpoint(target)}/${list.id}`, owner, 'PUT', { title: list.title, revision: list.revision, items: [{ ...list.items[0], cellStyles: styles }] });
    assert.equal(invalid.status, 400, JSON.stringify(styles));
  }
  assert.equal((await request(`${endpoint(target)}/${list.id}`)).body.list.revision, unchangedRevision);
  edited = await request(`${endpoint(target)}/${list.id}`, owner, 'PUT', { title: list.title, revision: list.revision, items: [{ ...list.items[0], cellStyles: {} }] });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.deepEqual(edited.body.list.items[0].cellStyles, {});
  const reopened = await createDatabase({ dbPath: join(directory, 'test.sqlite') });
  try { assert.deepEqual(reopened.getProjectList(owner.organization.id, owner.user.id, target.id, list.id), edited.body.list); }
  finally { reopened.close(); }
});

test('BOM templates accept free column layouts but reject row values and cell styles', async () => {
  const target = project(), layout = { ...defaultBomLayout(), columns: [{ key: 'custom_free', label: '', type: 'text', width: 120, visible: true }] };
  const created = await request(`${endpoint(target)}/templates`, owner, 'POST', { name: 'Free template', layout });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  for (const input of [{ name: 'Invalid', layout, items: [] }, { name: 'Invalid', layout, cellStyles: {} }, { name: 'Invalid', layout: { ...layout, cellStyles: {} } }]) {
    assert.equal((await request(`${endpoint(target)}/templates`, owner, 'POST', input)).status, 400);
  }
});

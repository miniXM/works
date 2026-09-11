import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../server/db.js';

test('Chinese compiler rejects unknown lines and supports nested Boolean branches', async () => {
  const language = await import('../automation-language.js').catch(() => null);
  assert.ok(language?.compileAutomation, 'shared Chinese compiler exists');
  const source = '当 独立任务 创建时\n如果 当前任务的状态 等于 「进行中」 并且 当前任务的优先级 不等于 「普通」\n如果 当前任务的标题 包含 「订单」\n记录 「符合」\n否则\n记录 「其他」\n结束判断\n否则\n将 当前任务的执行者 设为 创建人\n结束判断';
  assert.equal(language.compileAutomation(source).body[0].type, 'if');
  assert.throws(() => language.compileAutomation('当 独立任务 创建时\n执行任意代码'), /第 2 行/);
  assert.throws(() => language.compileAutomation('当 独立任务 创建时\n如果 当前任务的状态 等于 「进行中」'), /结束判断/);
  for (const template of language.AUTOMATION_TEMPLATES) assert.ok(language.compileAutomation(template.source));
});

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'mfggo-automation-'));
  const dbPath = join(directory, 'test.sqlite');
  let db = await createDatabase({ dbPath });
  try { await run({ db, reopen: async () => { db.close(); db = await createDatabase({ dbPath }); return db; } }); }
  finally { db.close(); await rm(directory, { recursive: true, force: true }); }
}
const org = 'org_demo', owner = 'user_admin';
const input = title => ({ organizationId: org, userId: owner, title });

test('multiline conditions support creator attributes and retain Boolean precedence', async () => fixture(async ({ db }) => {
  const { compileAutomation } = await import('../automation-language.js');
  const source = '当 独立任务 创建时\n如果 创建人的账号 等于 「admin」\n并且 当前任务的标题 包含 「报价」\n或者 创建人的岗位 等于 「业务员」\n  记录 「符合条件」\n否则\n  记录 「不符合」\n结束判断';
  const ast = compileAutomation(source);
  assert.equal(ast.body[0].condition.groups.length, 2);
  assert.equal(ast.body[0].condition.groups[0].length, 2);
  db.createAutomation(org, owner, { name: '创建人筛选', enabled: true, source });
  db.createTask(input('报价需求'));
  assert.equal(db.listAutomations(org, owner).runs[0].message, '符合条件');
  assert.throws(() => compileAutomation('当 独立任务 创建时\n并且 当前任务的标题 等于 「报价」'), /第 2 行/);
}));

test('default rules persist, can be disabled, and do not assign project roots', async () => fixture(async ({ db, reopen }) => {
  assert.equal(typeof db.listAutomations, 'function');
  const rules = db.listAutomations(org, owner).rules;
  assert.equal(rules.length, 3);
  assert.equal(db.createTask(input('默认分配')).assigneeUserId, owner);
  const rule = rules.find(r => r.source.includes('独立任务'));
  db.updateAutomation(org, owner, rule.id, { ...rule, enabled: false });
  assert.equal(db.createTask(input('关闭后无分配')).assigneeUserId, '');
  db = await reopen();
  assert.equal(db.listAutomations(org, owner).rules.find(r => r.id === rule.id).enabled, false);
  assert.equal(db.createTask(input('重启后')).assigneeUserId, '');
  const project = db.createProject({ ...input('项目'), ownerUserId: owner });
  assert.equal(db.getTask(org, project.rootTaskId).assigneeUserId, '');
  assert.equal(db.createTaskSubtask({ ...input('子任务'), taskId: project.rootTaskId }).assigneeUserId, owner);
}));

test('automation rules and member sets are isolated between enterprises', async () => fixture(({ db }) => {
  const other = db.createOrganization({ name: '另一个企业', slug: 'automation-isolation', ownerUserId: owner });
  const rule = db.listAutomations(org, owner).rules[0];
  assert.throws(() => db.updateAutomation(other.id, owner, rule.id, rule), /规则不存在/);
  assert.throws(() => db.deleteAutomation(other.id, owner, rule.id, rule.revision), /规则不存在/);
  const member = db.createMember({ organizationId: org, username: 'only-this-org', displayName: '独有成员', password: 'test-123456', role: 'member' });
  assert.throws(() => db.createAutomationSet(other.id, owner, { name: '跨企业', userIds: [member.id] }), /不属于当前企业/);
  const set = db.createAutomationSet(org, owner, { name: '本企业', userIds: [member.id] });
  assert.throws(() => db.deleteAutomationSet(other.id, owner, set.id), /集合不存在/);
  assert.equal(db.listAutomations(other.id, owner).sets.length, 0);
}));

test('ordered rules rollback failed actions, continue, accumulate participants, and emit once on status transition', async () => fixture(({ db }) => {
  assert.equal(typeof db.createAutomation, 'function');
  const member = db.createMember({ organizationId: org, username: 'automation_member', displayName: '规则成员', password: 'test-123456', role: 'member' });
  const project = db.createProject({ ...input('项目'), ownerUserId: owner });
  db.createAutomationSet(org, owner, { name: '测试集合', userIds: [member.id] });
  const event = '当 项目根任务 状态变化时\n';
  db.createAutomation(org, owner, { name: '先分配', enabled: true, source: event + '将 当前任务的执行者 设为 从 集合「测试集合」 随机选择一人\n添加 创建人 为 当前任务的参与者' });
  const bad = db.createAutomation(org, owner, { name: '失败回滚', enabled: true, source: event + '将 当前任务的执行者 设为 创建人\n添加 集合「测试集合」 为 当前任务的参与者' });
  db.deleteAutomationSet(org, owner, db.listAutomations(org, owner).sets[0].id);
  // Replace the first rule's now-deleted set reference with a direct member.
  const first = db.listAutomations(org, owner).rules.find(r => r.name === '先分配');
  db.updateAutomation(org, owner, first.id, { ...first, source: event + '将 当前任务的执行者 设为 成员「规则成员」\n添加 创建人 为 当前任务的参与者' });
  db.createAutomation(org, owner, { name: '最后继续', enabled: true, source: event + '记录 「后续规则执行」' });
  db.updateTask(org, project.rootTaskId, { status: '进行中' }, { actorUserId: owner });
  assert.equal(db.getTask(org, project.rootTaskId).assigneeUserId, member.id);
  assert.ok(db.isProjectMember(org, project.id, member.id));
  assert.equal(db.getProject(org, project.id).executorUserId, member.id);
  const runs = db.listAutomations(org, owner).runs;
  assert.equal(runs.find(r => r.ruleName === bad.name).status, 'failed');
  assert.ok(runs.some(r => r.message.includes('后续规则执行')));
  const count = runs.length;
  db.updateTask(org, project.rootTaskId, { status: '进行中' }, { actorUserId: owner });
  assert.equal(db.listAutomations(org, owner).runs.length, count);
  assert.ok(db.listTaskHistory(org, project.rootTaskId).some(r => r.assigneeUserId === member.id));
}));

test('personnel arrays require prior top-level declarations and preserve quoted member names', async () => {
  const { compileAutomation } = await import('../automation-language.js');
  const event = '当 项目根任务 状态变化时\n';
  const declaration = '设 人员数组「报价工程师」 为 [成员「alice, engineering」, 成员「bob」]';
  const pick = '将 当前任务的执行者 设为 从 人员数组「报价工程师」 随机选择一人';
  const ast = compileAutomation(event + declaration + '\n如果 当前任务的状态 等于 「内部报价」\n' + pick + '\n否则\n添加 人员数组「报价工程师」 为 当前任务的参与者\n结束判断');
  assert.deepEqual(ast.body[0].members.map(member => member.name), ['alice, engineering', 'bob']);
  assert.equal(ast.body[1].then[0].recipient.type, 'random_array');
  assert.equal(compileAutomation(event + '设 人员数组「空」 为 []').body[0].members.length, 0);
  assert.throws(() => compileAutomation(event + pick + '\n' + declaration), /第 2 行.*先定义/);
  assert.throws(() => compileAutomation(event + '如果 当前任务的状态 等于 「内部报价」\n' + declaration + '\n结束判断'), /第 3 行.*判断之外/);
  assert.throws(() => compileAutomation(event + declaration + '\n' + declaration), /已经定义/);
  assert.throws(() => compileAutomation(event + declaration.replace('成员「bob」', '创建人')), /人员数组应为/);
  assert.throws(() => compileAutomation(event + declaration.replace('成员「bob」]', '成员「bob」,]')), /多余的逗号/);
});

test('personnel arrays are local to each event, select members, add participants, and rollback empty selection', async () => fixture(async ({ db, reopen }) => {
  const members = ['array-a', 'array-b'].map(username => db.createMember({ organizationId: org, username, displayName: username, password: 'test-123456', role: 'member' }));
  const event = '当 项目根任务 状态变化时\n';
  const declaration = '设 人员数组「工程师」 为 [成员「array-a」, 成员「array-b」, 成员「array-a」]\n';
  const pick = '将 当前任务的执行者 设为 从 人员数组「工程师」 随机选择一人';
  db.createAutomation(org, owner, { name: '数组分配', enabled: true, source: event + declaration + pick + '\n添加 人员数组「工程师」 为 当前任务的参与者' });
  db.createAutomation(org, owner, { name: '本事件空数组', enabled: true, source: event + '设 人员数组「工程师」 为 []\n将 当前任务的执行者 设为 创建人\n' + pick });
  db.createAutomation(org, owner, { name: '继续执行', enabled: true, source: event + '记录 「数组事件后续正常」' });
  assert.equal(db.listAutomations(org, owner).sets.length, 0, 'script arrays need no shared collection');
  db = await reopen();
  const project = db.createProject({ ...input('局部数组项目'), ownerUserId: owner });
  db.updateTask(org, project.rootTaskId, { status: '内部报价' }, { actorUserId: owner });
  assert.ok(members.some(member => member.id === db.getTask(org, project.rootTaskId).assigneeUserId));
  for (const member of members) assert.ok(db.isProjectMember(org, project.id, member.id));
  const runs = db.listAutomations(org, owner).runs;
  assert.equal(runs.find(run => run.ruleName === '数组分配').status, 'success');
  assert.match(runs.find(run => run.ruleName === '本事件空数组').message, /第 4 行.*为空/);
  assert.equal(runs.find(run => run.ruleName === '本事件空数组').status, 'failed');
  assert.equal(runs.find(run => run.ruleName === '继续执行').message, '数组事件后续正常');
}));

test('array members are tenant-scoped and ambiguous display names require unique accounts', async () => fixture(({ db }) => {
  const other = db.createOrganization({ name: '数组另一企业', slug: 'array-isolation', ownerUserId: owner });
  for (const username of ['array-first', 'array-second']) db.createMember({ organizationId: org, username, displayName: '同名工程师', password: 'test-123456', role: 'member' });
  // A display name that looks like another account must not make the stable account ambiguous.
  db.createMember({ organizationId: org, username: 'array-third', displayName: 'array-first', password: 'test-123456', role: 'member' });
  const source = account => `当 独立任务 创建时\n设 人员数组「工程师」 为 [成员「${account}」]\n将 当前任务的执行者 设为 从 人员数组「工程师」 随机选择一人`;
  assert.throws(() => db.createAutomation(org, owner, { name: '同名', enabled: true, source: source('同名工程师') }), /第 2 行.*重名/);
  assert.throws(() => db.createAutomation(other.id, owner, { name: '外企业', enabled: true, source: source('array-first') }), /第 2 行.*不属于当前企业/);
  const rule = db.createAutomation(org, owner, { name: '唯一账号', enabled: true, source: source('array-first') });
  assert.equal(db.createTask(input('账号分配')).assigneeUserId, db.listMembers(org).find(member => member.username === 'array-first').id);
  assert.throws(() => db.setAutomationEnabled(other.id, owner, rule.id, { enabled: false, revision: rule.revision }), /规则不存在/);
}));

test('legacy collections remain executable alongside local arrays', async () => fixture(({ db }) => {
  const member = db.createMember({ organizationId: org, username: 'legacy-engineer', displayName: '旧集合工程师', password: 'test-123456', role: 'member' });
  db.createAutomationSet(org, owner, { name: '旧工程组', userIds: [member.id] });
  const source = '当 项目根任务 状态变化时\n设 人员数组「审核员」 为 [成员「admin」]\n将 当前任务的执行者 设为 从 集合「旧工程组」 随机选择一人\n添加 集合「旧工程组」 为 当前任务的参与者\n添加 人员数组「审核员」 为 当前任务的参与者';
  db.createAutomation(org, owner, { name: '兼容已有规则', enabled: true, source });
  const project = db.createProject({ ...input('兼容项目'), ownerUserId: owner });
  db.updateTask(org, project.rootTaskId, { status: '内部报价' }, { actorUserId: owner });
  assert.equal(db.getTask(org, project.rootTaskId).assigneeUserId, member.id);
  assert.ok(db.isProjectMember(org, project.id, member.id));
  assert.equal(db.listAutomations(org, owner).rules.find(rule => rule.name === '兼容已有规则').source, source);
}));

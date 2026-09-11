import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { normalizeTaskHistoryFilters, taskHistoryCsv } from '../server/task-history.js';

async function databaseFixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'machquote-task-history-'));
  const dbPath = join(directory, 'test.sqlite');
  let db = await createDatabase({ dbPath });
  const raw = new DatabaseSync(dbPath);
  try { await run({ db, raw, dbPath, reopen: async () => { db.close(); db = await createDatabase({ dbPath }); return db; } }); }
  finally { raw.close(); db.close(); await rm(directory, { recursive: true, force: true }); }
}

const projectInput = title => ({ organizationId: 'org_demo', userId: 'user_admin', title, stage: '立项沟通', ownerUserId: 'user_admin' });

test('正式履历记录根任务分配、看板阶段、释放、认领、完成及重新打开', async () => databaseFixture(({ db, raw }) => {
  const project = db.createProject(projectInput('正式执行履历'));
  const rootId = project.rootTaskId;
  db.claimTask('org_demo', rootId, 'user_admin');
  db.updateProject('org_demo', project.id, { stage: '内部报价' }, { actorUserId: 'user_admin' });
  db.transferTask('org_demo', rootId, 'user_admin', null);
  db.claimTask('org_demo', rootId, 'user_admin');
  db.updateTask('org_demo', rootId, { status: '已完成' }, { actorUserId: 'user_admin' });
  db.updateTask('org_demo', rootId, { status: '进行中' }, { actorUserId: 'user_admin' });
  const history = db.listTaskHistory('org_demo', rootId).reverse();
  assert.deepEqual(history.map(item => item.eventType), ['created', 'claimed', 'status_changed', 'released', 'claimed', 'completed', 'reopened']);
  assert.ok(history.every(item => item.entityKind === 'project' && item.projectId === project.id));
  assert.equal(history[2].previousStage, '立项沟通');
  assert.equal(history[2].stage, '内部报价');
  assert.equal(history[3].assigneeUserId, null);
  assert.equal(history[3].previousAssigneeUserId, 'user_admin');
  assert.equal(history[3].responsibleUserId, 'user_admin');
  assert.equal(history[4].actorUserId, 'user_admin');
  assert.ok(history[4].assignmentStartedAt);
  assert.ok(history[5].holdingDurationMs >= 0);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM task_assignment_periods WHERE entity_id = ? AND ended_at IS NULL').get(rootId).n, 1);
  const count = history.length;
  db.updateTask('org_demo', rootId, { title: '只更改标题', description: '备注不属于执行履历' });
  assert.equal(db.listTaskHistory('org_demo', rootId).length, count);
}));

test('历史写入失败时，任务、项目投影、分配期间与创建操作全部回滚', async () => databaseFixture(({ db, raw }) => {
  const project = db.createProject(projectInput('原子履历'));
  db.transferTask('org_demo', project.rootTaskId, 'user_admin', null);
  const count = db.listTaskHistory('org_demo', project.rootTaskId).length;
  raw.exec("CREATE TRIGGER reject_history BEFORE INSERT ON task_history_events BEGIN SELECT RAISE(ABORT, 'history_write_failed'); END");
  assert.throws(() => db.claimTask('org_demo', project.rootTaskId, 'user_admin'), /history_write_failed/);
  assert.equal(db.getTask('org_demo', project.rootTaskId).assigneeUserId, '');
  assert.equal(db.listTaskHistory('org_demo', project.rootTaskId).length, count);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM task_assignment_periods WHERE entity_id = ? AND ended_at IS NULL').get(project.rootTaskId).n, 0);
  assert.throws(() => db.updateProject('org_demo', project.id, { stage: '询盘发布' }, { actorUserId: 'user_admin' }), /history_write_failed/);
  assert.equal(db.getProject('org_demo', project.id).stage, '立项沟通');
  assert.equal(db.getTask('org_demo', project.rootTaskId).status, '立项沟通');
  assert.throws(() => db.createProject(projectInput('不应残留')), /history_write_failed/);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM projects WHERE title = '不应残留'").get().n, 0);
}));

test('升级旧数据只建立未知分配时间的迁移快照，重启不重复生成', async () => databaseFixture(async ({ db, raw, reopen }) => {
  const project = db.createProject(projectInput('历史存量任务'));
  raw.prepare('DELETE FROM task_history_events WHERE entity_id = ?').run(project.rootTaskId);
  raw.prepare('DELETE FROM task_assignment_periods WHERE entity_id = ?').run(project.rootTaskId);
  raw.prepare("UPDATE tasks SET created_at = '2021-01-01T00:00:00.000Z', updated_at = '2022-02-02T00:00:00.000Z' WHERE id = ?").run(project.rootTaskId);
  db = await reopen();
  let history = db.listTaskHistory('org_demo', project.rootTaskId);
  assert.equal(history.length, 1);
  assert.equal(history[0].eventType, 'migration_snapshot');
  assert.equal(history[0].source, 'migration');
  assert.equal(history[0].assignmentStartedAt, null);
  assert.equal(history[0].holdingDurationMs, null);
  assert.equal(history[0].actorUserId, null);
  assert.notEqual(history[0].occurredAt, '2021-01-01T00:00:00.000Z');
  const report = db.getTaskHistoryReport('org_demo', { projectId: project.id });
  assert.equal(report.summary.assignedCount, 0);
  assert.equal(report.summary.claimedCount, 0);
  assert.equal(report.summary.baselineCount, 1);
  db = await reopen();
  history = db.listTaskHistory('org_demo', project.rootTaskId);
  assert.equal(history.length, 1);
  db.transferTask('org_demo', project.rootTaskId, 'user_admin', null);
  assert.equal(db.listTaskHistory('org_demo', project.rootTaskId)[0].assignmentStartedAt, null);
}));

test('独立任务和多层子任务覆盖相同履历，删除保留所有后代的正式记录', async () => databaseFixture(({ db, raw }) => {
  const task = db.createTask({ organizationId: 'org_demo', userId: 'user_admin', title: '独立任务' });
  const child = db.createTaskSubtask({ organizationId: 'org_demo', taskId: task.id, userId: 'user_admin', title: '一级', assigneeUserId: 'user_admin' });
  const nested = db.createTaskSubtask({ organizationId: 'org_demo', taskId: task.id, parentSubtaskId: child.id, userId: 'user_admin', title: '二级', assigneeUserId: 'user_admin' });
  db.updateTaskSubtask('org_demo', task.id, nested.id, { completed: true }, { actorUserId: 'user_admin' });
  const nestedHistory = db.listTaskHistory('org_demo', task.id, nested.id);
  assert.deepEqual(nestedHistory.map(item => item.eventType), ['completed', 'created']);
  assert.equal(nestedHistory[0].entityKind, 'subtask');
  // Creation and the configured automation assignment are separately traceable.
  assert.equal(db.listTaskHistory('org_demo', task.id).length, 2);
  db.deleteTask('org_demo', task.id, { actorUserId: 'user_admin' });
  assert.equal(db.listTaskHistory('org_demo', task.id)[0].eventType, 'deleted');
  assert.equal(db.listTaskHistory('org_demo', task.id, child.id)[0].eventType, 'deleted');
  assert.equal(db.listTaskHistory('org_demo', task.id, nested.id)[0].eventType, 'deleted');
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM task_assignment_periods WHERE ended_at IS NULL AND entity_id IN (?, ?, ?)').get(task.id, child.id, nested.id).n, 0);
}));

test('统计按发生时间、人员、阶段和状态筛选，并明确北京时间日期边界', async () => databaseFixture(({ db, raw }) => {
  const project = db.createProject(projectInput('统计任务'));
  db.claimTask('org_demo', project.rootTaskId, 'user_admin');
  db.updateTask('org_demo', project.rootTaskId, { status: '内部报价' }, { actorUserId: 'user_admin' });
  const history = db.listTaskHistory('org_demo', project.rootTaskId);
  const event = history.find(item => item.eventType === 'status_changed');
  const created = history.find(item => item.eventType === 'created');
  assert.ok(event);
  assert.ok(created);
  raw.prepare('UPDATE task_history_events SET occurred_at = ? WHERE id = ?').run('2026-09-06T16:00:00.000Z', event.id);
  raw.prepare('UPDATE task_history_events SET occurred_at = ? WHERE id = ?').run('2026-09-06T15:59:59.999Z', created.id);
  const filters = { userId: 'user_admin', projectId: project.id, stage: '内部报价', status: '内部报价', from: '2026-09-07', to: '2026-09-07', pageSize: 1 };
  const report = db.getTaskHistoryReport('org_demo', filters);
  assert.equal(report.total, 1);
  assert.equal(report.records[0].id, event.id);
  assert.equal(report.summary.taskCount, 1);
  assert.equal(report.byStage[0].stage, '内部报价');
  assert.equal(report.byPerson[0].userId, 'user_admin');
  assert.equal(report.timeSemantics.timezone, 'Asia/Shanghai');
  assert.equal(db.getTaskHistoryReport('org_demo', { ...filters, page: 2 }).records.length, 0);
  assert.equal(db.getTaskHistoryReport('org_demo', { ...filters, page: 2 }, { exportAll: true }).records.length, 1);
  assert.equal(db.getTaskHistoryReport('org_other', filters).total, 0);
  assert.throws(() => normalizeTaskHistoryFilters({ from: '2026-02-30' }), /invalid_history_date/);
  assert.throws(() => normalizeTaskHistoryFilters({ from: '2026-02-30T12:00:00+08:00' }), /invalid_history_date/);
  assert.throws(() => normalizeTaskHistoryFilters({ from: '2026-09-08', to: '2026-09-07' }), /invalid_history_date_range/);
  assert.throws(() => normalizeTaskHistoryFilters({ pageSize: 10001 }), /invalid_history_pagination/);
  assert.throws(() => normalizeTaskHistoryFilters({ userId: ['one', 'two'] }), /invalid_history_filter/);
}));

test('CSV 使用 BOM、标准引号转义和公式防护', () => {
  const csv = taskHistoryCsv([{ title: '=HYPERLINK("https://example.com")', projectTitle: '含,逗号\n换行', actorName: ' @SUM(1+1)', assigneeName: '\t=1+1' }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes('"\'=HYPERLINK(""https://example.com"")"'));
  assert.ok(csv.includes('"含,逗号\n换行"'));
  assert.ok(csv.includes('"\' @SUM(1+1)"'));
  assert.ok(csv.includes('"\'\t=1+1"'));
});

test('API 履历遵守项目读取权限，统计及 CSV 仅管理员可用，拒绝变更不留假记录', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'machquote-task-history-api-'));
  const previousPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'history-admin-123';
  const app = await createApp({ dbPath: join(directory, 'test.sqlite') });
  const server = createServer(app.callback());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (path, token = '', method = 'GET', body) => {
    const response = await fetch(`${base}${path}`, { method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const admin = (await request('/auth/login', '', 'POST', { username: 'admin', password: 'history-admin-123' })).body;
    const member = await request('/members', admin.token, 'POST', { username: 'history_viewer', displayName: '履历参与者', temporaryPassword: 'history-viewer-123', role: 'viewer' });
    assert.equal(member.status, 201);
    const viewer = (await request('/auth/login', '', 'POST', { username: 'history_viewer', password: 'history-viewer-123' })).body;
    const project = (await request('/projects', admin.token, 'POST', { title: '=统计导出测试', stage: '立项沟通' })).body.project;
    assert.equal((await request(`/tasks/${project.rootTaskId}/detail`, viewer.token)).status, 403);
    assert.equal((await request(`/tasks/${project.rootTaskId}`, admin.token, 'PUT', { assigneeUserId: admin.user.id })).status, 200);
    assert.equal((await request(`/projects/${project.id}/members`, admin.token, 'POST', { userId: viewer.user.id })).status, 201);
    assert.equal((await request(`/tasks/${project.rootTaskId}`, admin.token, 'PUT', { assigneeUserId: '' })).status, 200);
    assert.equal((await request(`/tasks/${project.rootTaskId}`, viewer.token, 'PUT', { assigneeUserId: viewer.user.id })).status, 200);
    const before = (await request(`/tasks/${project.rootTaskId}/detail`, viewer.token)).body.history;
    assert.equal((await request(`/tasks/${project.rootTaskId}`, admin.token, 'PUT', { status: '已完成' })).status, 403);
    assert.equal((await request(`/tasks/${project.rootTaskId}/detail`, viewer.token)).body.history.length, before.length);
    const finished = await request(`/tasks/${project.rootTaskId}`, viewer.token, 'PUT', { assigneeUserId: admin.user.id, status: '已完成' });
    assert.equal(finished.status, 200);
    const history = (await request(`/tasks/${project.rootTaskId}/detail`, viewer.token)).body.history;
    assert.equal(history[0].eventType, 'completed');
    assert.equal(history[0].actorUserId, viewer.user.id);
    assert.equal(history[0].responsibleUserId, viewer.user.id, '同时交接和完成时，完成归属原执行者');
    assert.equal(history[0].assigneeUserId, admin.user.id);
    assert.equal(history[1].eventType, 'transferred');
    const outgoingReport = await request(`/stats/task-history?projectId=${project.id}&userId=${viewer.user.id}`, admin.token);
    const incomingReport = await request(`/stats/task-history?projectId=${project.id}&userId=${admin.user.id}`, admin.token);
    assert.equal(outgoingReport.body.summary.completedCount, 1);
    assert.equal(incomingReport.body.summary.completedCount, 0, '接收交接的人不能获得原执行者的完成次数');
    assert.equal((await request('/stats/task-history', viewer.token)).status, 403);
    assert.equal((await request('/stats/task-history/export.csv', viewer.token)).status, 403);
    assert.equal((await request('/stats/task-history?from=2026-02-30', admin.token)).status, 400);
    const report = await request(`/stats/task-history?projectId=${project.id}&pageSize=1`, admin.token);
    assert.equal(report.status, 200);
    assert.equal(report.body.records.length, 1);
    assert.equal(report.body.summary.claimedCount, 2);
    assert.equal(report.body.summary.completedCount, 1);
    const exported = await fetch(`${base}/stats/task-history/export.csv?projectId=${project.id}&pageSize=1`, { headers: { authorization: `Bearer ${admin.token}` } });
    assert.equal(exported.status, 200);
    const bytes = Buffer.from(await exported.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.ok(bytes.toString('utf8').includes("'=统计导出测试"));
    assert.equal(bytes.toString('utf8').split('\r\n').length - 2, report.body.total, '导出所有符合筛选的记录，而非当前页');
  } finally {
    await new Promise(resolve => server.close(resolve));
    app.close();
    await rm(directory, { recursive: true, force: true });
    if (previousPassword === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
    else process.env.INITIAL_ADMIN_PASSWORD = previousPassword;
  }
});

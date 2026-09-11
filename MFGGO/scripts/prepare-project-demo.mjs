import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, PROJECT_WORKFLOW_STAGES } from '../server/db.js';

const directory = fileURLToPath(new URL('..', import.meta.url));
const orgId = 'org_demo';
const action = 'project.demo.machining.v1';
const demoNote = '机加工业务演示数据，数量、交期及任务状态仅供测试。';
const date = day => `2026-09-${String(day).padStart(2, '0')}`;
const child = (title, user, day, status = '待处理', existingId = null) => ({ title, user, day, status, existingId });

export const projectDemoPlan = [
  { id: 'project_0a716863-c1ca-4545-be86-e2e4c02bea67', title: '0443 系列铝件工艺报价', stage: 2, user: 'zhang.gong', due: 11,
    description: '按现有 CAD 和清单核对 6061 铝件加工面、装夹次数及表面处理，输出工时和报价依据。',
    children: [child('核对 CAD 与 BOM 版本', 'test.user01', 8, '已完成'), child('评估装夹方案与加工工时', 'zhang.gong', 10, '进行中'), child('汇总材料和外协成本', 'test.user04', 11)] },
  { id: 'project_be0a9b38-b846-42cb-ade3-1c28f7594764', title: '自动化夹具底板询价', stage: 1, user: 'zhang.gong', due: 10,
    description: '示例需求：6061 夹具底板 20 件，确认定位孔公差、平面度及交货周期。',
    children: [child('确认定位孔与平面度要求', 'test.user01', 8, '进行中'), child('收集材料及加工询价', 'test.user04', 9), child('整理技术答疑与交期', 'zhang.gong', 10)] },
  { id: 'project_bdf5677b-a041-45a3-b785-448afab51ade', title: '机器人末端支架打样', stage: 0, user: 'test.user01', due: 14,
    description: '示例需求：末端执行器铝合金支架 5 套，先确认安装接口、避让空间及样件验收尺寸。',
    children: [child('确认安装接口和载荷', 'chen.pm', 8, '进行中'), child('完善支架图纸与公差', 'test.user01', 11), child('评审打样工艺', 'zhang.gong', 14)] },
  { id: 'project_9bf210b4-bbba-41d2-80d2-118ff8aae946', title: '输送线定位板改型', stage: 0, user: 'chen.pm', due: 16,
    description: '示例需求：调整定位孔距及安装槽，确认新旧版本差异后安排 10 件试制。',
    children: [child('整理现场安装尺寸', 'admin', 9, '进行中', 'subtask_69027909-8d40-46f3-bbb6-1c5d969016db'), child('修订定位板图纸', 'test.user01', 12), child('确认改型版本与试制数量', 'chen.pm', 16)] },
  { id: 'project_fd42826d-e4ca-4923-92a1-20b6c0485228', title: '0443 系列铝件首批交付', stage: 9, user: 'admin', start: 1, due: 6,
    description: '已完成示例：保留原 CAD、报价及清单，用于查看交付后的任务和资料。',
    children: [child('完成成品尺寸复核', 'test.user03', 4, '已完成', 'subtask_c0877c81-66d7-4dfe-8d8f-9124e29178ac'), child('核对包装与交付清单', 'test.user04', 5, '已完成'), child('归档交付资料', 'admin', 6, '已完成')] },
  { id: 'project_75233e97-48cd-440a-8999-cd85d6b0ff3b', title: '0443 系列铝件样件验收', stage: 9, user: 'wang.qa', start: 1, due: 5,
    description: '已完成示例：保留原样件资料，用于测试验收记录和 BOM 查询。',
    children: [child('核对样件关键尺寸', 'test.user03', 3, '已完成'), child('复核检验结果', 'wang.qa', 4, '已完成'), child('整理样件验收资料', 'test.user04', 5, '已完成')] },
  { id: 'project_9f6d3052-04a1-4fb5-b6d8-c89f7217f479', title: '304 不锈钢定位销询价', stage: 1, user: 'admin', due: 10,
    description: '示例需求：304 不锈钢定位销 100 件，确认外径配合、倒角和去毛刺要求。',
    children: [child('确认材质与配合公差', 'zhang.gong', 8, '进行中'), child('核对采购数量及交期', 'test.user04', 9), child('汇总询价信息', 'admin', 10)] },
  { id: 'project_19d7a690-592e-4d4d-8d6e-0d3cb25d0873', title: '减速机连接法兰成本核算', stage: 2, user: 'zhang.gong', due: 12,
    description: '示例需求：45 钢法兰 30 件，评估车铣工序、热处理余量及材料利用率。',
    children: [child('确定毛坯与热处理余量', 'zhang.gong', 9, '进行中'), child('核算车铣工时', 'li.gong', 11), child('复核成本与报价边界', 'chen.pm', 12)] },
  { id: 'project_83f0a4da-c613-49b1-8546-c921132f96fb', title: '检测工装底座加工报价', stage: 3, user: 'chen.pm', due: 11,
    description: '示例需求：检测工装底座 8 套，确认精加工、表面处理及报价有效期。',
    children: [child('复核加工工艺与成本', 'zhang.gong', 8, '已完成'), child('整理报价及交期条件', 'chen.pm', 10, '进行中'), child('登记报价反馈', 'test.user04', 11)] },
  { id: 'project_1ce7877c-19bb-4aee-9ff4-edb85289b614', title: '0443 系列铝件复购排产', stage: 5, user: 'li.gong', due: 18,
    description: '复购排产示例：沿用现有 CAD 和 BOM，安排编程、首件确认及批量加工。',
    children: [child('确认程序与装夹方案', 'li.gong', 9, '进行中'), child('完成首件加工及确认', 'test.user02', 12), child('安排批量加工与巡检', 'liu.manager', 18)] },
  { id: 'project_57980204-4c3b-4b76-a623-85422733b459', title: '薄壁铝壳尺寸异常复核', stage: 6, user: 'wang.qa', due: 8,
    description: '异常处理示例：薄壁件卸夹后尺寸偏差，隔离样件并复核测量基准、夹紧力与补加工方案。',
    children: [child('隔离样件并复测尺寸', 'test.user03', 7, '已完成'), child('分析装夹变形原因', 'zhang.gong', 8, '进行中'), child('确认处置方案与复检要求', 'wang.qa', 8)] },
  { id: 'project_52b2e3e6-ae5f-440b-9480-d34fccc4fffe', title: '精密轴套小批量加工', stage: 4, user: 'liu.manager', due: 16,
    description: '示例需求：40Cr 轴套 50 件，排产前确认材料、内外径配合和检验量具。',
    children: [child('核对订单图纸与数量', 'admin', 9, '进行中', 'subtask_80a850d4-8b4b-4f3b-9706-d9c4116fcda6'), child('确认设备和人员排期', 'liu.manager', 11), child('准备刀具与检验量具', 'test.user02', 16)] },
  { id: 'project_51a6ee22-530f-40b1-9d90-c351c0c9c71a', title: '装配治具图纸确认', stage: 0, user: 'admin', due: 12,
    description: '示例需求：装配定位治具 2 套，明确装配基准、可调行程和图纸版本。',
    children: [child('图纸与关键尺寸确认', 'admin', 9, '进行中', 'subtask_e8da0925-5114-466e-9df2-a6ab8e2b0787'), child('校核装配干涉与行程', 'test.user01', 11), child('确认治具试制方案', 'zhang.gong', 12)] },
  { id: 'project_99d059d3-8f4a-4e84-8de5-deadc883c590', title: '不锈钢支撑座首件检验', stage: 7, user: 'test.user03', due: 9,
    description: '首件检验示例：核对孔距、垂直度和表面外观，复核通过后再放行。',
    children: [child('核对来料与首件标识', 'lin.employee', 7, '已完成'), child('测量关键尺寸并记录', 'test.user03', 8, '进行中'), child('复核首件检验结果', 'wang.qa', 9)] },
  { id: 'project_5e3e3ed8-3fee-4b3b-983d-198a1442ee4b', title: '铝合金安装座包装发货', stage: 8, user: 'test.user04', due: 9,
    description: '发货示例：核对现有清单、包装标签和收货信息，完成出库资料整理。',
    children: [child('核对成品数量与防护包装', 'zhou.employee', 8, '进行中'), child('整理装箱单与物流信息', 'test.user04', 9), child('复核发货资料', 'admin', 9)] },
  { id: 'project_94112cea-2212-425c-b17e-2a0359760e22', title: '别墅栏杆连接件加工报价', stage: 3, user: 'admin', due: 25,
    description: '沿用别墅项目背景的机加工示例：核对栏杆连接件材质、表面处理和安装数量。',
    children: [child('确认连接件图纸与数量', 'test.user01', 15, '进行中'), child('核算加工及表面处理费用', 'zhang.gong', 20), child('整理对外报价', 'admin', 25)] }
];

const quote = name => `"${name.replaceAll('"', '""')}"`;
const rows = (db, table) => db.prepare(`SELECT * FROM ${quote(table)} ORDER BY rowid`).all();
function snapshot(db) {
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(({ name }) => [name, rows(db, name)]));
}
function inspect(db) {
  const marker = db.prepare('SELECT created_at FROM audit_events WHERE organization_id = ? AND action = ?').get(orgId, action);
  if (marker) return { alreadyApplied: true, appliedAt: marker.created_at };
  const members = db.prepare(`SELECT u.id, u.username, m.role, COALESCE(NULLIF(m.display_name_override, ''), u.display_name) AS name
    FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ?`).all(orgId);
  const byUsername = new Map(members.map(member => [member.username, member]));
  assert.equal(byUsername.get('admin')?.role, 'owner', 'Expected demo enterprise owner');
  const projects = projectDemoPlan.map(plan => {
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND organization_id = ?').get(plan.id, orgId);
    assert.ok(project, `Missing project ${plan.id}`);
    assert.equal(project.owner_user_id, byUsername.get('admin').id, 'Unexpected project ownership');
    assert.equal(db.prepare("SELECT count(*) n FROM task_recycle_entries WHERE organization_id = ? AND resource_type = 'project' AND resource_id = ? AND restored_at IS NULL").get(orgId, plan.id).n, 0, 'Project is recycled');
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND organization_id = ?').get(project.root_task_id, orgId);
    assert.equal(task?.project_id, project.id, 'Missing project root task');
    for (const user of [plan.user, ...plan.children.map(item => item.user)]) assert.ok(byUsername.has(user), `Missing member ${user}`);
    for (const item of plan.children.filter(item => item.existingId)) {
      assert.ok(db.prepare('SELECT id FROM task_subtasks WHERE id = ? AND task_id = ? AND organization_id = ?').get(item.existingId, task.id, orgId), 'Missing existing subtask');
    }
    return { ...plan, stage: PROJECT_WORKFLOW_STAGES[plan.stage], fromTitle: project.title, rootTaskId: task.id, project, task };
  });
  return { alreadyApplied: false, projects, byUsername };
}
const publicPlan = plan => plan.alreadyApplied ? plan : { alreadyApplied: false, projectCount: plan.projects.length,
  subtaskCount: plan.projects.reduce((sum, project) => sum + project.children.length, 0),
  projects: plan.projects.map(({ id, fromTitle, title, stage, user, due, children }) => ({ id, fromTitle, title, stage,
    executor: plan.byUsername.get(user).name, dueAt: date(due), subtasks: children.map(item => item.title) })) };

function mutateCopy(api, plan, backupPath) {
  const actorId = plan.byUsername.get('admin').id;
  for (const project of plan.projects) {
    const members = new Set(api.listProjectMembers(orgId, project.id).map(member => member.id));
    for (const username of new Set([project.user, ...project.children.map(item => item.user)])) {
      const userId = plan.byUsername.get(username).id;
      if (!members.has(userId)) api.addProjectMember({ organizationId: orgId, projectId: project.id, userId, createdBy: actorId });
    }
    const assignee = plan.byUsername.get(project.user);
    const description = [project.task.description, demoNote, project.description].filter(Boolean).join('\n');
    const task = api.updateTask(orgId, project.rootTaskId, { title: project.title, status: project.stage,
      description, assigneeUserId: assignee.id, owner: assignee.name,
      startAt: date(project.start || 7), dueAt: date(project.due) },
    { actorUserId: actorId, expectedAssigneeUserId: project.task.assignee_user_id });
    assert.ok(task, 'Root task assignment changed during setup');
    assert.ok(api.syncProjectFromRootTask(orgId, task));
    const children = [];
    for (const [position, item] of project.children.entries()) {
      const changes = { title: item.title, description: demoNote, status: item.status,
        assigneeUserId: plan.byUsername.get(item.user).id, startAt: date(project.start || 7), dueAt: date(item.day), position };
      let result;
      if (item.existingId) {
        const previous = api.getTaskSubtask(orgId, task.id, item.existingId);
        changes.description = [previous.description, demoNote].filter(Boolean).join('\n');
        result = api.updateTaskSubtask(orgId, task.id, item.existingId, changes, { actorUserId: actorId, expectedAssigneeUserId: previous.assigneeUserId });
      } else result = api.createTaskSubtask({ organizationId: orgId, taskId: task.id, userId: actorId, ...changes });
      assert.ok(result, 'Subtask setup failed');
      children.push(result.id);
    }
    api.addAudit({ organizationId: orgId, userId: actorId, action: `${action}.project`, entityType: 'project', entityId: project.id,
      metadata: { reason: '用户授权整理机加工演示项目', from: { title: project.fromTitle, status: project.task.status,
        assigneeUserId: project.task.assignee_user_id, dueAt: project.task.due_at },
      to: { title: project.title, status: project.stage, assigneeUserId: assignee.id, dueAt: date(project.due) }, subtaskIds: children } });
  }
  api.addAudit({ organizationId: orgId, userId: actorId, action, entityType: 'organization', entityId: orgId,
    metadata: { reason: '用户授权整理机加工演示项目', projectCount: plan.projects.length, subtaskCount: 48, backupPath } });
}

// Prepare with the application's history-aware helpers, then commit only their
// verified row changes. This avoids running startup migrations against live data.
function collectChanges(db, before, after, plan) {
  const allowed = new Set(['projects', 'tasks', 'task_subtasks', 'project_members', 'task_history_events', 'task_assignment_periods', 'audit_events']);
  const projectIds = new Set(plan.projects.map(project => project.id));
  const taskIds = new Set(plan.projects.map(project => project.rootTaskId));
  const entityIds = new Set([...taskIds, ...after.task_subtasks.filter(item => taskIds.has(item.task_id)).map(item => item.id)]);
  const changes = [];
  assert.deepEqual(Object.keys(after), Object.keys(before), 'Unexpected schema change');
  for (const table of Object.keys(before)) {
    if (!allowed.has(table)) { assert.deepEqual(after[table], before[table], `Unrelated table changed: ${table}`); continue; }
    const pk = db.prepare(`PRAGMA table_info(${quote(table)})`).all().filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name);
    const key = row => JSON.stringify(pk.map(column => row[column]));
    const oldRows = new Map(before[table].map(row => [key(row), row]));
    for (const row of after[table]) {
      const old = oldRows.get(key(row));
      oldRows.delete(key(row));
      if (JSON.stringify(old) === JSON.stringify(row)) continue;
      assert.equal(row.organization_id, orgId, 'Cross-enterprise change');
      if (table === 'projects') {
        assert.ok(old && projectIds.has(row.id));
        for (const field of ['id', 'owner_user_id', 'owner_name', 'created_by', 'created_at', 'root_task_id', 'step', 'tag']) assert.equal(row[field], old[field], `Project ${field} changed`);
      } else if (table === 'tasks') {
        assert.ok(old && taskIds.has(row.id));
        for (const field of ['id', 'project_id', 'customer_profile', 'customer_management', 'project_list', 'stage', 'priority', 'created_at']) assert.equal(row[field], old[field], `Task ${field} changed`);
      } else if (table === 'task_subtasks') assert.ok(taskIds.has(row.task_id));
      else if (table === 'project_members') assert.ok(!old && projectIds.has(row.project_id) && row.project_role === 'member');
      else if (table === 'task_history_events') assert.ok(!old && taskIds.has(row.task_id));
      else if (table === 'task_assignment_periods') assert.ok(entityIds.has(row.entity_id));
      else if (table === 'audit_events') assert.ok(!old && row.action.startsWith(action));
      changes.push({ table, pk, before: old || null, after: row });
    }
    assert.equal(oldRows.size, 0, `Rows deleted from ${table}`);
  }
  return changes;
}

export async function prepareProjectDemo({ dbPath = join(directory, 'data', 'machquote.sqlite'), apply = false,
  outputDirectory = join(directory, 'tmp') } = {}) {
  const absolutePath = resolve(dbPath);
  const db = new DatabaseSync(absolutePath, { readOnly: !apply });
  let transaction = false;
  let api;
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');
    const plan = inspect(db);
    if (!apply || plan.alreadyApplied) return { applied: false, ...publicPlan(plan) };
    const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const backupPath = join(dirname(absolutePath), 'backups', `machquote-pre-project-demo-${runId}.sqlite`);
    const workingPath = resolve(outputDirectory, `project-demo-staging-${runId}.sqlite`);
    const manifestPath = resolve(outputDirectory, `project-demo-changes-${runId}.json`);
    await mkdir(dirname(backupPath), { recursive: true });
    await mkdir(outputDirectory, { recursive: true });
    await backup(db, backupPath);
    const saved = new DatabaseSync(backupPath, { readOnly: true });
    let before;
    try {
      assert.equal(saved.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      before = snapshot(saved);
      await backup(saved, workingPath);
    } finally { saved.close(); }
    api = await createDatabase({ dbPath: workingPath });
    const staging = new DatabaseSync(workingPath);
    let changes;
    try {
      assert.deepEqual(snapshot(staging), before, 'Startup would change existing data; review before proceeding');
      mutateCopy(api, inspect(staging), backupPath);
      assert.equal(staging.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.deepEqual(staging.prepare('PRAGMA foreign_key_check').all(), []);
      changes = collectChanges(staging, before, snapshot(staging), plan);
    } finally { staging.close(); api.close(); api = null; }
    await writeFile(manifestPath, `${JSON.stringify({ database: absolutePath, backupPath, ...publicPlan(plan), changes }, null, 2)}\n`, { flag: 'wx' });
    db.exec('BEGIN IMMEDIATE');
    transaction = true;
    assert.equal(inspect(db).alreadyApplied, false, 'Setup was already applied concurrently');
    for (const table of ['memberships', 'organization_member_permissions', 'project_members', 'task_recycle_entries', 'task_history_events', 'task_assignment_periods']) {
      assert.deepEqual(rows(db, table), before[table], `Concurrent change in ${table}; retry from a fresh snapshot`);
    }
    for (const change of changes) {
      const { table, pk, before: previous, after } = change;
      const where = pk.map(column => `${quote(column)} = ?`).join(' AND ');
      const found = db.prepare(`SELECT * FROM ${quote(table)} WHERE ${where}`).get(...pk.map(column => after[column]));
      assert.deepEqual(found || null, previous, `Concurrent change in ${table}; nothing applied`);
    }
    // Close existing assignment periods before inserting replacements.
    for (const { table, pk, before: previous, after } of changes.sort((a, b) => Number(!a.before) - Number(!b.before))) {
      const columns = Object.keys(after).filter(column => !(table === 'task_history_events' && column === 'sequence'));
      if (previous) {
        const fields = columns.filter(column => !pk.includes(column) && after[column] !== previous[column]);
        db.prepare(`UPDATE ${quote(table)} SET ${fields.map(column => `${quote(column)} = ?`).join(', ')} WHERE ${pk.map(column => `${quote(column)} = ?`).join(' AND ')}`)
          .run(...fields.map(column => after[column]), ...pk.map(column => after[column]));
      } else db.prepare(`INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...columns.map(column => after[column]));
    }
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    db.exec('COMMIT');
    transaction = false;
    return { applied: true, database: absolutePath, backupPath, manifestPath, changedRows: changes.length, ...publicPlan(plan) };
  } catch (error) {
    if (transaction) db.exec('ROLLBACK');
    throw error;
  } finally { api?.close(); db.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (let index = 2; index < process.argv.length; index += 1) {
      const argument = process.argv[index];
      if (argument === '--apply') options.apply = true;
      else if (argument === '--db' || argument === '--output-dir') {
        const value = process.argv[++index];
        if (!value || value.startsWith('--')) throw new Error(`${argument} requires a path`);
        options[argument === '--db' ? 'dbPath' : 'outputDirectory'] = value;
      } else throw new Error(`Unknown argument: ${argument}`);
    }
    console.log(JSON.stringify(await prepareProjectDemo(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

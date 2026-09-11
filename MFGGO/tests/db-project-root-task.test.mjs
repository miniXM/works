import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../server/db.js';

test('backfills a root task when upgrading a legacy project without one', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'machquote-project-root-backfill-'));
  const dbPath = join(directory, 'test.sqlite');
  let db;
  let raw;
  try {
    db = await createDatabase({ dbPath });
    const project = db.createProject({
      organizationId: 'org_demo',
      userId: 'user_admin',
      title: '旧项目根任务回填',
      stage: '内部报价',
      status: '内部报价',
      owner: 'admin',
      ownerUserId: 'user_admin',
      tag: '历史项目标签',
      progress: 33,
      step: '1/3'
    });
    const previousRootTaskId = project.rootTaskId;
    db.close();
    db = null;

    raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA foreign_keys = ON');
    assert.equal(raw.prepare('SELECT executor_user_id FROM projects WHERE id = ?').get(project.id).executor_user_id, null);
    raw.prepare('DELETE FROM tasks WHERE organization_id = ? AND id = ?')
      .run('org_demo', previousRootTaskId);
    const orphaned = raw.prepare('SELECT root_task_id, executor_user_id FROM projects WHERE id = ?').get(project.id);
    assert.equal(orphaned.root_task_id, null);
    assert.equal(orphaned.executor_user_id, null, '未认领项目不应带有过期负责人');
    raw.close();
    raw = null;

    db = await createDatabase({ dbPath });
    const repairedProject = db.getProject('org_demo', project.id);
    const rootTask = db.getProjectRootTask('org_demo', project.id);
    assert.ok(repairedProject.rootTaskId);
    assert.notEqual(repairedProject.rootTaskId, previousRootTaskId);
    assert.equal(rootTask.id, repairedProject.rootTaskId);
    assert.equal(rootTask.title, '旧项目根任务回填');
    assert.equal(rootTask.stage, '历史项目标签');
    assert.equal(rootTask.owner, '');
    assert.equal(rootTask.assigneeUserId, '');
    assert.equal(rootTask.status, '内部报价');
  } finally {
    raw?.close();
    db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('clears an executor pointer when a legacy root-task reference dangles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'machquote-project-root-dangling-'));
  const dbPath = join(directory, 'test.sqlite');
  let db;
  let raw;
  try {
    db = await createDatabase({ dbPath });
    const project = db.createProject({
      organizationId: 'org_demo',
      userId: 'user_admin',
      title: '悬空根任务引用',
      stage: '内部报价',
      status: '内部报价',
      owner: 'admin',
      ownerUserId: 'user_admin',
      tag: '',
      progress: 0,
      step: '0/1'
    });
    db.close();
    db = null;

    raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA foreign_keys = OFF');
    raw.prepare('UPDATE projects SET root_task_id = ?, executor_user_id = ? WHERE id = ?')
      .run('task_missing_from_legacy_store', 'user_admin', project.id);
    raw.close();
    raw = null;

    db = await createDatabase({ dbPath });
    const repairedProject = db.getProject('org_demo', project.id);
    const rootTask = db.getProjectRootTask('org_demo', project.id);
    assert.ok(rootTask);
    assert.notEqual(rootTask.id, 'task_missing_from_legacy_store');
    assert.equal(rootTask.assigneeUserId, '');
    assert.equal(repairedProject.executorUserId, '');
  } finally {
    raw?.close();
    db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('repairs stale project-card fields from the canonical root task at startup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'machquote-project-root-task-'));
  const dbPath = join(directory, 'test.sqlite');
  let db;
  try {
    db = await createDatabase({ dbPath });
    const worker = db.createMember({
      organizationId: 'org_demo',
      username: 'root_task_repair_worker',
      displayName: '根任务执行者',
      password: 'worker-pass',
      role: 'engineer'
    });
    const project = db.createProject({
      organizationId: 'org_demo',
      userId: 'user_admin',
      title: '待修复项目卡',
      stage: '内部报价',
      status: '待处理',
      owner: 'admin',
      ownerUserId: 'user_admin',
      tag: '原始标签',
      progress: 0,
      step: '0/1'
    });
    const rootTask = db.getProjectRootTask('org_demo', project.id);
    db.updateTask('org_demo', rootTask.id, {
      title: '根任务的真实标题',
      description: '根任务的真实备注',
      stage: '根任务标签',
      owner: worker.displayName,
      assigneeUserId: worker.id,
      progress: 72,
      status: '进行中',
      priority: '紧急',
      startAt: '2026-08-27',
      dueAt: '2026-09-03'
    });
    db.close();
    db = null;

    const raw = new DatabaseSync(dbPath);
    raw.prepare(`UPDATE projects SET title = ?, owner_name = ?, owner_user_id = ?, tag = ?, progress = ?, status = ?, description = ?, priority = ?, start_at = ?, due_at = ? WHERE id = ?`).run(
      '历史错误标题',
      '历史错误执行者',
      'user_admin',
      '历史错误标签',
      3,
      '阻塞',
      '历史错误备注',
      '普通',
      '2026-01-01',
      '2026-01-02',
      project.id
    );
    raw.close();

    db = await createDatabase({ dbPath });
    const repaired = db.getProject('org_demo', project.id);
    const canonicalTask = db.getTask('org_demo', rootTask.id);
    assert.equal(repaired.rootTaskId, canonicalTask.id);
    assert.equal(repaired.title, canonicalTask.title);
    assert.equal(repaired.owner, 'admin', '项目管理者名称必须保持为创建者');
    assert.equal(repaired.ownerUserId, 'user_admin', '项目管理者不能被根任务执行者覆盖');
    assert.equal(repaired.managerUserId, 'user_admin');
    assert.equal(repaired.executorUserId, canonicalTask.assigneeUserId);
    assert.equal(repaired.tag, canonicalTask.stage);
    assert.equal(repaired.progress, canonicalTask.progress);
    assert.equal(repaired.status, canonicalTask.status);
    assert.equal(repaired.description, canonicalTask.description);
    assert.equal(repaired.priority, canonicalTask.priority);
    assert.equal(repaired.startAt, canonicalTask.startAt);
    assert.equal(repaired.dueAt, canonicalTask.dueAt);
    assert.equal(repaired.stage, '内部报价', '项目看板阶段必须保持独立');
  } finally {
    db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('removes legacy project child tasks while preserving task subtask storage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'machquote-project-child-task-cleanup-'));
  const dbPath = join(directory, 'test.sqlite');
  let db;
  let raw;
  try {
    db = await createDatabase({ dbPath });
    const project = db.createProject({
      organizationId: 'org_demo',
      userId: 'user_admin',
      title: '只保留根任务的项目',
      stage: '内部报价',
      status: '待处理',
      owner: 'admin',
      ownerUserId: 'user_admin',
      tag: '',
      progress: 0,
      step: '0/1'
    });
    const rootTask = db.getProjectRootTask('org_demo', project.id);
    db.close();
    db = null;

    const timestamp = '2026-08-27T00:00:00.000Z';
    const childTaskId = 'task_legacy_project_child';
    raw = new DatabaseSync(dbPath);
    raw.prepare(`INSERT INTO tasks(id, organization_id, project_id, title, description, customer_profile, customer_management, project_list, stage, owner_name, assignee_user_id, progress, status, priority, start_at, due_at, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(childTaskId, 'org_demo', project.id, '历史项目子任务', '', '', '', '', '未分组', 'admin', 'user_admin', 0, '待处理', '普通', null, null, timestamp, timestamp);
    raw.prepare('INSERT INTO task_comments(id, organization_id, task_id, user_id, body, created_at) VALUES(?, ?, ?, ?, ?, ?)')
      .run('comment-root-keep', 'org_demo', rootTask.id, 'user_admin', '根任务评论保留', timestamp);
    raw.prepare('INSERT INTO task_comments(id, organization_id, task_id, user_id, body, created_at) VALUES(?, ?, ?, ?, ?, ?)')
      .run('comment-child-remove', 'org_demo', childTaskId, 'user_admin', '子任务评论删除', timestamp);
    raw.prepare('INSERT INTO task_subtasks(id, organization_id, task_id, title, completed, created_by, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
      .run('subtask-legacy', 'org_demo', rootTask.id, '历史子任务', 0, 'user_admin', timestamp, timestamp);
    const insertAudit = raw.prepare('INSERT INTO audit_events(id, organization_id, user_id, action, entity_type, entity_id, metadata_json, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)');
    insertAudit.run('audit-root-keep', 'org_demo', 'user_admin', 'task.update', 'task', rootTask.id, JSON.stringify({ taskId: rootTask.id }), timestamp);
    insertAudit.run('audit-child-remove', 'org_demo', 'user_admin', 'task.update', 'task', childTaskId, JSON.stringify({ taskId: childTaskId }), timestamp);
    insertAudit.run('audit-child-comment-remove', 'org_demo', 'user_admin', 'task.comment.create', 'task_comment', 'comment-child-remove', JSON.stringify({ taskId: childTaskId }), timestamp);
    insertAudit.run('audit-subtask-remove', 'org_demo', 'user_admin', 'task.subtask.create', 'task_subtask', 'subtask-legacy', JSON.stringify({ taskId: rootTask.id }), timestamp);
    raw.close();
    raw = null;

    db = await createDatabase({ dbPath });
    assert.equal(db.getTask('org_demo', rootTask.id)?.id, rootTask.id, '根任务必须保留');
    assert.equal(db.getTask('org_demo', childTaskId), null, '项目非根任务必须清理');
    assert.deepEqual(db.listTaskComments('org_demo', rootTask.id).map(comment => comment.body), ['根任务评论保留']);
    const audit = db.listAudit('org_demo');
    assert.ok(audit.some(event => event.id === 'audit-root-keep'));
    assert.ok(!audit.some(event => event.id === 'audit-child-remove' || event.id === 'audit-child-comment-remove'));
    assert.ok(audit.some(event => event.id === 'audit-subtask-remove'), '子任务审计必须保留');
    assert.equal(db.listTaskSubtasks('org_demo', rootTask.id).length, 1, '根任务子任务必须保留');
    db.close();
    db = null;

    raw = new DatabaseSync(dbPath);
    assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'task_subtasks'").get().count, 1);
    assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM task_subtasks WHERE id = ?').get('subtask-legacy').count, 1);
    assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM task_comments WHERE id = ?').get('comment-child-remove').count, 0);
    raw.close();
    raw = null;
  } finally {
    raw?.close();
    db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

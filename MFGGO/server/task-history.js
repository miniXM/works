import { randomUUID } from 'node:crypto';

const DONE_STATUSES = new Set(['已完成', '订单结束/已完成']);
const EVENT_LABELS = {
  migration_snapshot: '迁移快照', created: '创建分配', claimed: '认领',
  transferred: '交接', released: '释放', status_changed: '状态变更',
  completed: '完成', reopened: '重新打开', deleted: '删除', recycled: '移入回收站', restored: '从回收站恢复'
};

export const TASK_HISTORY_TIME_SEMANTICS = {
  dateField: 'occurredAt', timezone: 'Asia/Shanghai',
  fromInclusive: true, toExclusive: true, dateEndInclusive: true,
  description: '按操作发生时间筛选；日期按北京时间整日计算，时间戳按其时区计算。迁移快照仅表示启用履历时的当前状态，不计入认领或完成次数。持有时长不代表实际工时。',
  migration: 'unknown_assignment_start'
};

const schema = `
CREATE TABLE IF NOT EXISTS task_history_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL CHECK(entity_kind IN ('project', 'task', 'subtask')),
  task_id TEXT NOT NULL,
  subtask_id TEXT,
  project_id TEXT,
  title TEXT NOT NULL,
  project_title TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  actor_user_id TEXT,
  actor_name TEXT NOT NULL DEFAULT '',
  previous_assignee_user_id TEXT,
  previous_assignee_name TEXT NOT NULL DEFAULT '',
  assignee_user_id TEXT,
  assignee_name TEXT NOT NULL DEFAULT '',
  responsible_user_id TEXT,
  responsible_name TEXT NOT NULL DEFAULT '',
  previous_stage TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT '',
  previous_status TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('live', 'migration')),
  assignment_started_at TEXT,
  holding_duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_task_history_entity ON task_history_events(organization_id, entity_id, sequence);
CREATE INDEX IF NOT EXISTS idx_task_history_time ON task_history_events(organization_id, occurred_at, sequence);
CREATE INDEX IF NOT EXISTS idx_task_history_assignee ON task_history_events(organization_id, assignee_user_id, occurred_at);
CREATE TABLE IF NOT EXISTS task_assignment_periods (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL,
  assignee_user_id TEXT NOT NULL,
  started_at TEXT,
  observed_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT,
  source TEXT NOT NULL CHECK(source IN ('live', 'migration'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_assignment_active
  ON task_assignment_periods(organization_id, entity_id) WHERE ended_at IS NULL;
`;

function rowToEvent(row) {
  return {
    id: row.id, sequence: row.sequence, organizationId: row.organization_id,
    entityId: row.entity_id, entityKind: row.entity_kind, taskId: row.task_id,
    subtaskId: row.subtask_id || null, projectId: row.project_id || null,
    title: row.title, projectTitle: row.project_title, eventType: row.event_type,
    eventLabel: EVENT_LABELS[row.event_type] || row.event_type,
    actorUserId: row.actor_user_id || null, actorName: row.actor_name,
    previousAssigneeUserId: row.previous_assignee_user_id || null,
    previousAssigneeName: row.previous_assignee_name,
    assigneeUserId: row.assignee_user_id || null, assigneeName: row.assignee_name,
    responsibleUserId: row.responsible_user_id || null, responsibleName: row.responsible_name,
    previousStage: row.previous_stage, stage: row.stage,
    previousStatus: row.previous_status, status: row.status,
    occurredAt: row.occurred_at, source: row.source,
    assignmentStartedAt: row.assignment_started_at || null,
    holdingDurationMs: row.holding_duration_ms ?? null
  };
}

function filterDate(value, end = false) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error('invalid_history_date');
  let date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date = new Date(`${value}T00:00:00+08:00`);
    if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10) !== value) throw new Error('invalid_history_date');
    if (end) date = new Date(date.getTime() + 86400000);
  } else {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('invalid_history_date');
    const calendarDay = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(calendarDay.getTime()) || calendarDay.toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error('invalid_history_date');
    date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('invalid_history_date');
  }
  return date.toISOString();
}

export function normalizeTaskHistoryFilters(input = {}) {
  const result = {};
  for (const key of ['userId', 'stage', 'status', 'projectId', 'kind', 'eventType']) {
    if (input[key] === undefined || input[key] === '') continue;
    if (typeof input[key] !== 'string' || input[key].length > 160) throw new Error('invalid_history_filter');
    result[key] = input[key].trim();
  }
  if (result.kind && !['project', 'task', 'subtask'].includes(result.kind)) throw new Error('invalid_history_filter');
  if (result.eventType && !Object.hasOwn(EVENT_LABELS, result.eventType)) throw new Error('invalid_history_filter');
  result.from = filterDate(input.from);
  result.to = filterDate(input.to, true);
  if (result.from && result.to && result.from >= result.to) throw new Error('invalid_history_date_range');
  for (const [key, fallback, maximum] of [['page', 1, 1000000], ['pageSize', 25, 100]]) {
    const value = input[key] === undefined || input[key] === '' ? fallback : Number(input[key]);
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error('invalid_history_pagination');
    result[key] = value;
  }
  return result;
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function taskHistoryCsv(records) {
  const columns = [
    ['发生时间(UTC)', 'occurredAt'], ['项目', 'projectTitle'], ['任务', 'title'],
    ['类型', 'entityKind'], ['操作', 'eventLabel'], ['操作人', 'actorName'],
    ['原负责人', 'previousAssigneeName'], ['负责人', 'assigneeName'], ['归属人员', 'responsibleName'],
    ['原阶段', 'previousStage'], ['阶段', 'stage'], ['原状态', 'previousStatus'],
    ['状态', 'status'], ['分配开始时间(UTC)', 'assignmentStartedAt'],
    ['持有时长(毫秒，非工时)', 'holdingDurationMs'], ['记录来源', 'source']
  ];
  return '\uFEFF' + [columns.map(([label]) => csvCell(label)).join(','),
    ...records.map(record => columns.map(([, key]) => csvCell(record[key])).join(','))].join('\r\n') + '\r\n';
}

export function createTaskHistoryStore(db, workflowStages) {
  db.exec(schema);
  const workflow = new Set(workflowStages);
  const nameForUser = (userId, organizationId) => userId
    ? db.prepare(`SELECT COALESCE(NULLIF(p.display_name, ''), NULLIF(u.display_name, ''), u.username) AS name
      FROM users u LEFT JOIN organization_user_profiles p ON p.id = u.id AND p.organization_id = ?
      WHERE u.id = ?`).get(organizationId, userId)?.name || ''
    : '';
  const normalizeSnapshot = (row, subtask = false) => row && ({
    entityId: row.id,
    entityKind: subtask ? 'subtask' : (row.root_task_id === row.id ? 'project' : 'task'),
    taskId: subtask ? row.task_id : row.id, subtaskId: subtask ? row.id : null,
    projectId: row.project_id || null, title: row.title, projectTitle: row.project_title || '',
    assigneeUserId: row.assignee_user_id || null,
    assigneeName: nameForUser(row.assignee_user_id, row.organization_id),
    stage: workflow.has(row.status) ? row.status : (row.project_stage || row.stage || ''),
    status: row.status || '', completed: Boolean(row.completed) || DONE_STATUSES.has(row.status)
  });
  const getTask = (organizationId, taskId) => normalizeSnapshot(db.prepare(`SELECT t.*, p.root_task_id, p.stage AS project_stage, p.title AS project_title
    FROM tasks t LEFT JOIN projects p ON p.organization_id = t.organization_id AND p.id = t.project_id
    WHERE t.organization_id = ? AND t.id = ?`).get(organizationId, taskId));
  const getSubtask = (organizationId, taskId, subtaskId) => normalizeSnapshot(db.prepare(`SELECT s.*, t.project_id, t.stage,
      p.stage AS project_stage, p.title AS project_title
    FROM task_subtasks s JOIN tasks t ON t.organization_id = s.organization_id AND t.id = s.task_id
    LEFT JOIN projects p ON p.organization_id = t.organization_id AND p.id = t.project_id
    WHERE s.organization_id = ? AND s.task_id = ? AND s.id = ?`).get(organizationId, taskId, subtaskId), true);
  const activePeriod = (organizationId, entityId) => db.prepare(`SELECT * FROM task_assignment_periods
    WHERE organization_id = ? AND entity_id = ? AND ended_at IS NULL`).get(organizationId, entityId);
  const insertPeriod = (organizationId, snapshot, timestamp, source) => {
    if (!snapshot.assigneeUserId) return null;
    db.prepare(`INSERT INTO task_assignment_periods(id, organization_id, entity_id, assignee_user_id, started_at, observed_at, source)
      VALUES(?, ?, ?, ?, ?, ?, ?)`).run(`assignment_${randomUUID()}`, organizationId, snapshot.entityId,
        snapshot.assigneeUserId, source === 'migration' ? null : timestamp, timestamp, source);
    return activePeriod(organizationId, snapshot.entityId);
  };
  const writeEvent = (organizationId, snapshot, before, eventType, actorUserId, timestamp, source, period) => {
    const responsible = ['released', 'deleted', 'completed'].includes(eventType) && before?.assigneeUserId ? before : snapshot;
    const duration = period?.started_at ? Math.max(0, Date.parse(timestamp) - Date.parse(period.started_at)) : null;
    db.prepare(`INSERT INTO task_history_events(id, organization_id, entity_id, entity_kind, task_id, subtask_id,
        project_id, title, project_title, event_type, actor_user_id, actor_name, previous_assignee_user_id,
        previous_assignee_name, assignee_user_id, assignee_name, responsible_user_id, responsible_name, previous_stage, stage, previous_status, status,
        occurred_at, source, assignment_started_at, holding_duration_ms)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        `history_${randomUUID()}`, organizationId, snapshot.entityId, snapshot.entityKind,
        snapshot.taskId, snapshot.subtaskId, snapshot.projectId, snapshot.title, snapshot.projectTitle,
        eventType, actorUserId || null, nameForUser(actorUserId, organizationId), before?.assigneeUserId || null,
        before?.assigneeName || '', eventType === 'deleted' ? null : snapshot.assigneeUserId,
        eventType === 'deleted' ? '' : snapshot.assigneeName, responsible?.assigneeUserId || null, responsible?.assigneeName || '',
        before?.stage || '', snapshot.stage, before?.status || '', snapshot.status,
        timestamp, source, period?.started_at || null, duration);
  };
  const record = (organizationId, before, after, actorUserId, source = 'live', timestamp = new Date().toISOString()) => {
    const snapshot = after || before;
    if (!snapshot) return;
    let period = activePeriod(organizationId, snapshot.entityId);
    const priorPeriod = period;
    if (source === 'migration') {
      period = insertPeriod(organizationId, snapshot, timestamp, source);
      writeEvent(organizationId, snapshot, null, 'migration_snapshot', null, timestamp, source, period);
      return;
    }
    if (!before) {
      period = insertPeriod(organizationId, after, timestamp, source);
      writeEvent(organizationId, after, null, 'created', actorUserId, timestamp, source, period);
      if (after.completed) writeEvent(organizationId, after, null, 'completed', actorUserId, timestamp, source, period);
      return;
    }
    if (!after || before.assigneeUserId !== after.assigneeUserId) {
      const eventType = !after ? 'deleted' : (!after.assigneeUserId ? 'released' : (!before.assigneeUserId ? 'claimed' : 'transferred'));
      const oldPeriod = period;
      if (period) db.prepare('UPDATE task_assignment_periods SET ended_at = ?, end_reason = ? WHERE id = ?')
        .run(timestamp, eventType, period.id);
      period = after ? insertPeriod(organizationId, after, timestamp, source) : null;
      writeEvent(organizationId, snapshot, before, eventType, actorUserId, timestamp, source,
        eventType === 'released' || eventType === 'deleted' ? oldPeriod : period);
    }
    if (after && (before.status !== after.status || before.stage !== after.stage || before.completed !== after.completed)) {
      const eventType = !before.completed && after.completed ? 'completed'
        : (before.completed && !after.completed ? 'reopened' : 'status_changed');
      writeEvent(organizationId, after, before, eventType, actorUserId, timestamp, source,
        eventType === 'completed' && before.assigneeUserId ? priorPeriod : period);
    }
  };
  const transaction = operation => {
    const nested = db.isTransaction;
    const savepoint = `task_history_${randomUUID().replaceAll('-', '')}`;
    db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
    try {
      const result = operation();
      db.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT');
      return result;
    } catch (error) {
      db.exec(nested ? `ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}` : 'ROLLBACK');
      throw error;
    }
  };
  const baseline = () => transaction(() => {
    const timestamp = new Date().toISOString();
    const tasks = db.prepare(`SELECT organization_id, id FROM tasks t WHERE NOT EXISTS
      (SELECT 1 FROM task_history_events h WHERE h.organization_id = t.organization_id AND h.entity_id = t.id)`).all();
    for (const task of tasks) record(task.organization_id, null, getTask(task.organization_id, task.id), null, 'migration', timestamp);
    const subtasks = db.prepare(`SELECT organization_id, task_id, id FROM task_subtasks s WHERE NOT EXISTS
      (SELECT 1 FROM task_history_events h WHERE h.organization_id = s.organization_id AND h.entity_id = s.id)`).all();
    for (const subtask of subtasks) record(subtask.organization_id, null, getSubtask(subtask.organization_id, subtask.task_id, subtask.id), null, 'migration', timestamp);
  });
  baseline();

  const descendants = (organizationId, taskId, subtaskId = null) => {
    const rows = subtaskId ? db.prepare(`WITH RECURSIVE subtree(id) AS (
      SELECT id FROM task_subtasks WHERE organization_id = ? AND task_id = ? AND id = ?
      UNION ALL SELECT s.id FROM task_subtasks s JOIN subtree p ON s.parent_subtask_id = p.id
        WHERE s.organization_id = ? AND s.task_id = ?)
      SELECT id FROM subtree`).all(organizationId, taskId, subtaskId, organizationId, taskId)
      : db.prepare('SELECT id FROM task_subtasks WHERE organization_id = ? AND task_id = ?').all(organizationId, taskId);
    return rows.map(row => getSubtask(organizationId, taskId, row.id));
  };
  const report = (organizationId, input = {}, { exportAll = false } = {}) => {
    const filters = normalizeTaskHistoryFilters(input);
    const clauses = ['organization_id = ?'];
    const args = [organizationId];
    for (const [key, column] of [['stage', 'stage'], ['status', 'status'], ['projectId', 'project_id'], ['kind', 'entity_kind'], ['eventType', 'event_type']]) {
      if (filters[key]) { clauses.push(`${column} = ?`); args.push(filters[key]); }
    }
    if (filters.userId) {
      clauses.push('responsible_user_id = ?');
      args.push(filters.userId);
    }
    if (filters.from) { clauses.push('occurred_at >= ?'); args.push(filters.from); }
    if (filters.to) { clauses.push('occurred_at < ?'); args.push(filters.to); }
    const where = clauses.join(' AND ');
    const summary = db.prepare(`SELECT COUNT(*) AS eventCount, COUNT(DISTINCT entity_id) AS taskCount,
      COUNT(DISTINCT responsible_user_id) AS peopleCount,
      SUM(CASE WHEN event_type = 'created' AND assignee_user_id IS NOT NULL THEN 1 ELSE 0 END) AS assignedCount,
      SUM(CASE WHEN event_type = 'claimed' THEN 1 ELSE 0 END) AS claimedCount,
      SUM(CASE WHEN event_type = 'transferred' THEN 1 ELSE 0 END) AS transferredCount,
      SUM(CASE WHEN event_type = 'released' THEN 1 ELSE 0 END) AS releasedCount,
      SUM(CASE WHEN event_type = 'completed' THEN 1 ELSE 0 END) AS completedCount,
      COUNT(DISTINCT CASE WHEN event_type = 'completed' THEN entity_id END) AS completedTaskCount,
      SUM(CASE WHEN source = 'migration' THEN 1 ELSE 0 END) AS baselineCount
      FROM task_history_events WHERE ${where}`).get(...args);
    for (const key of Object.keys(summary)) summary[key] = Number(summary[key] || 0);
    const group = column => db.prepare(`SELECT ${column} AS key, COUNT(*) AS eventCount,
      COUNT(DISTINCT entity_id) AS taskCount,
      SUM(CASE WHEN event_type = 'claimed' THEN 1 ELSE 0 END) AS claimedCount,
      SUM(CASE WHEN event_type = 'completed' THEN 1 ELSE 0 END) AS completedCount
      FROM task_history_events WHERE ${where} GROUP BY ${column} ORDER BY eventCount DESC, key`).all(...args);
    const records = exportAll
      ? db.prepare(`SELECT * FROM task_history_events WHERE ${where} ORDER BY occurred_at DESC, sequence DESC`).all(...args)
      : db.prepare(`SELECT * FROM task_history_events WHERE ${where} ORDER BY occurred_at DESC, sequence DESC LIMIT ? OFFSET ?`)
        .all(...args, filters.pageSize, (filters.page - 1) * filters.pageSize);
    return { records: records.map(rowToEvent), total: summary.eventCount, page: filters.page, pageSize: filters.pageSize,
      summary, byPerson: group('responsible_user_id').map(row => ({ ...row, userId: row.key || null, name: nameForUser(row.key, organizationId) })),
      byStage: group('stage').map(row => ({ ...row, stage: row.key })), filters, timeSemantics: TASK_HISTORY_TIME_SEMANTICS };
  };

  return { getTask, getSubtask, descendants, record, transaction, report,
    recycleLifecycle(organizationId, taskIds, eventType, actorUserId, timestamp) {
      if (!['recycled', 'restored'].includes(eventType)) throw new Error('invalid_recycle_event');
      for (const taskId of taskIds) {
        for (const snapshot of [getTask(organizationId, taskId), ...descendants(organizationId, taskId)].filter(Boolean)) {
          let period = activePeriod(organizationId, snapshot.entityId);
          if (eventType === 'recycled' && period) {
            db.prepare('UPDATE task_assignment_periods SET ended_at = ?, end_reason = ? WHERE id = ?')
              .run(timestamp, eventType, period.id);
          } else if (eventType === 'restored' && !period) {
            period = insertPeriod(organizationId, snapshot, timestamp, 'live');
          }
          writeEvent(organizationId, snapshot, snapshot, eventType, actorUserId, timestamp, 'live', period);
        }
      }
    },
    list(organizationId, taskId, subtaskId = null) {
      return db.prepare(`SELECT * FROM task_history_events WHERE organization_id = ? AND task_id = ?
        AND ${subtaskId ? 'subtask_id = ?' : 'subtask_id IS NULL'} ORDER BY sequence DESC`)
        .all(...(subtaskId ? [organizationId, taskId, subtaskId] : [organizationId, taskId])).map(rowToEvent);
    }
  };
}

// Wrap the database boundary so API calls and internal callers share the same
// atomic history contract. Existing project transactions use nested savepoints.
export function instrumentTaskHistory(api, db, workflowStages) {
  const history = createTaskHistoryStore(db, workflowStages);
  const wrap = (method, resolve) => {
    const mutate = api[method];
    api[method] = function (...args) {
      return history.transaction(() => {
        const scope = resolve(args);
        const before = scope.before();
        const result = mutate.apply(api, args);
        if (!result) return result;
        const after = scope.after(result);
        const timestamp = new Date().toISOString();
        for (const entityId of new Set([...before.keys(), ...after.keys()])) {
          history.record(scope.organizationId, before.get(entityId), after.get(entityId), scope.actorUserId, 'live', timestamp);
        }
        return result;
      });
    };
  };
  const map = snapshots => new Map(snapshots.filter(Boolean).map(snapshot => [snapshot.entityId, snapshot]));
  const taskScope = ([organizationId, taskId, , options = {}]) => ({ organizationId, actorUserId: options.actorUserId,
    before: () => map([history.getTask(organizationId, taskId)]),
    after: () => map([history.getTask(organizationId, taskId)]) });
  wrap('createProject', ([input]) => ({ organizationId: input.organizationId, actorUserId: input.userId,
    before: () => map([]), after: project => map([history.getTask(input.organizationId, project.rootTaskId)]) }));
  wrap('createTask', ([input]) => ({ organizationId: input.organizationId, actorUserId: input.userId,
    before: () => map([]), after: task => map([history.getTask(input.organizationId, task.id)]) }));
  wrap('createTaskSubtask', ([input]) => ({ organizationId: input.organizationId, actorUserId: input.userId,
    before: () => map([]), after: subtask => map([history.getSubtask(input.organizationId, input.taskId, subtask.id)]) }));
  wrap('updateTask', taskScope);
  wrap('updateProject', ([organizationId, projectId, , options = {}]) => {
    const taskId = api.getProject(organizationId, projectId)?.rootTaskId;
    return taskScope([organizationId, taskId, null, options]);
  });
  for (const method of ['claimTask', 'transferTask']) wrap(method, args => ({
    ...taskScope([args[0], args[1]]), actorUserId: args[2]
  }));
  const subtaskScope = ([organizationId, taskId, subtaskId, , options = {}]) => ({ organizationId, actorUserId: options.actorUserId,
    before: () => map([history.getSubtask(organizationId, taskId, subtaskId)]),
    after: () => map([history.getSubtask(organizationId, taskId, subtaskId)]) });
  wrap('updateTaskSubtask', subtaskScope);
  for (const method of ['claimTaskSubtask', 'transferTaskSubtask']) wrap(method, args => ({
    ...subtaskScope([args[0], args[1], args[2]]), actorUserId: args[3]
  }));
  wrap('deleteTask', ([organizationId, taskId, options = {}]) => ({ organizationId, actorUserId: options.actorUserId,
    before: () => map([history.getTask(organizationId, taskId), ...history.descendants(organizationId, taskId)]), after: () => map([]) }));
  wrap('deleteTaskSubtask', ([organizationId, taskId, subtaskId, options = {}]) => ({ organizationId, actorUserId: options.actorUserId,
    before: () => map(history.descendants(organizationId, taskId, subtaskId)), after: () => map([]) }));
  api.listTaskHistory = history.list;
  api.getTaskHistoryReport = history.report;
  api.recordRecycleLifecycle = (...args) => history.transaction(() => history.recycleLifecycle(...args));
  return api;
}

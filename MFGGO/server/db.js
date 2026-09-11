import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { instrumentTaskHistory } from './task-history.js';
import { instrumentOrganizationAccess } from './organization-access.js';
import { instrumentOrganizationAssignments } from './organization-assignment.js';
import { instrumentPlatformAccess } from './platform-access.js';
import { instrumentTaskRecycle } from './task-recycle.js';
import { instrumentProjectLists } from './project-lists.js';
import { instrumentProjectLinks } from './project-links.js';
import { instrumentAutomations } from './automation.js';

const schema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(organization_id, user_id)
);
CREATE TABLE IF NOT EXISTS organization_modules (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(organization_id, module_key)
);
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  stage TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  owner_user_id TEXT REFERENCES users(id),
  -- Project manager is independent from the person executing its root task.
  -- Older databases receive this column in createDatabase() below.
  executor_user_id TEXT REFERENCES users(id),
  root_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  tag TEXT NOT NULL DEFAULT '',
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  step TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '待处理',
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT '普通',
  start_at TEXT,
  due_at TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_members (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_role TEXT NOT NULL DEFAULT 'member',
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, user_id)
);
CREATE TABLE IF NOT EXISTS parts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  format TEXT NOT NULL,
  material TEXT NOT NULL DEFAULT '',
  finish TEXT NOT NULL DEFAULT '',
  dimensions TEXT NOT NULL DEFAULT '',
  volume TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  uploaded_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  part_id TEXT REFERENCES parts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  storage_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
-- User-uploaded files that live in the personal or enterprise file space.
-- Keep this separate from office_documents and task_attachments so their
-- existing lifecycle, editor integration, and message semantics stay intact.
CREATE TABLE IF NOT EXISTS storage_files (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  scope TEXT NOT NULL DEFAULT 'personal' CHECK(scope IN ('personal', 'enterprise')),
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  extension TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(size_bytes >= 0),
  storage_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS office_documents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'xlsx',
  storage_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  scope TEXT NOT NULL DEFAULT 'private',
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS office_document_permissions (
  document_id TEXT NOT NULL REFERENCES office_documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'view',
  created_at TEXT NOT NULL,
  PRIMARY KEY(document_id,user_id)
);
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  quote_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  total_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CNY',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quote_lines (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  part_id TEXT REFERENCES parts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  material TEXT NOT NULL DEFAULT '',
  process TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fair_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  part_id TEXT REFERENCES parts(id) ON DELETE SET NULL,
  characteristic TEXT NOT NULL,
  nominal TEXT NOT NULL DEFAULT '',
  tolerance TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  customer_profile TEXT NOT NULL DEFAULT '',
  customer_management TEXT NOT NULL DEFAULT '',
  project_list TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  assignee_user_id TEXT REFERENCES users(id),
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT '待处理',
  priority TEXT NOT NULL DEFAULT '普通',
  start_at TEXT,
  due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Checklist-style work items that belong to a task.  They are deliberately
-- separate from the tasks table: project cards still have one canonical root
-- task, while the detail panel can track actionable child items as needed.
CREATE TABLE IF NOT EXISTS task_subtasks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  parent_subtask_id TEXT REFERENCES task_subtasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
  status TEXT NOT NULL DEFAULT '待处理',
  priority TEXT NOT NULL DEFAULT '普通',
  assignee_user_id TEXT REFERENCES users(id),
  start_at TEXT,
  due_at TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_comments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  subtask_id TEXT REFERENCES task_subtasks(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_attachments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  subtask_id TEXT REFERENCES task_subtasks(id) ON DELETE CASCADE,
  uploader_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  storage_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_comments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_user_states (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT,
  last_read_message_rowid INTEGER,
  saved_for_later INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS chat_attachments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  pending_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  uploader_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  storage_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`;

const now = () => new Date().toISOString();
const id = prefix => `${prefix}_${randomUUID()}`;

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

export function verifyPassword(password, encoded) {
  const [salt, expected] = String(encoded || '').split(':');
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 32);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return expectedBuffer.length === actual.length && timingSafeEqual(actual, expectedBuffer);
}

export const PROJECT_WORKFLOW_STAGES = Object.freeze([
  '立项沟通',
  '询盘发布',
  '内部报价',
  '对外报价',
  '订单发布/待办',
  '已排产/处理中',
  '异常/优先处理',
  '已到货/质检',
  '发货',
  '订单结束/已完成'
]);

export const LEGACY_TASK_STATUSES = Object.freeze(['待处理', '进行中', '阻塞', '已完成']);
const SUBTASK_DONE_STATUSES = Object.freeze(new Set(['已完成', '订单结束/已完成']));

function workflowProgressFromNode(node) {
  const value = String(node ?? '').trim();
  const index = PROJECT_WORKFLOW_STAGES.indexOf(value);
  if (index < 0) return null;
  if (PROJECT_WORKFLOW_STAGES.length <= 1) return 0;
  return Math.round(index / (PROJECT_WORKFLOW_STAGES.length - 1) * 100);
}

function projectFromRow(row) {
  if (!row) return null;
  return { id: row.id, organizationId: row.organization_id, title: row.title, stage: row.stage, owner: row.owner_name, ownerUserId: row.owner_user_id || '', managerUserId: row.owner_user_id || '', executorUserId: row.executor_user_id || '', rootTaskId: row.root_task_id || '', tag: row.tag, progress: row.progress, step: row.step, status: row.status, description: row.description || '', priority: row.priority || '普通', startAt: row.start_at || null, dueAt: row.due_at || null, createdAt: row.created_at, updatedAt: row.updated_at };
}

function partFromRow(row) {
  if (!row) return null;
  return { id: row.id, organizationId: row.organization_id, projectId: row.project_id, name: row.name, project: row.project_title || '', order: row.project_order || '', format: row.format, material: row.material, finish: row.finish, size: row.dimensions, volume: row.volume, quantity: row.quantity, uploaded: row.uploaded_at };
}

function userFromRow(row) {
  return row ? { id: row.id, username: row.username, displayName: row.display_name } : null;
}

function organizationFromRow(row) {
  return row ? { id: row.id, slug: row.slug, name: row.name } : null;
}

function quoteFromRow(row, lines = []) {
  if (!row) return null;
  return { id: row.id, organizationId: row.organization_id, projectId: row.project_id, quoteNo: row.quote_no, status: row.status, totalCents: row.total_cents, currency: row.currency, createdAt: row.created_at, updatedAt: row.updated_at, lines };
}

function quoteLineFromRow(row) {
  return { id: row.id, quoteId: row.quote_id, partId: row.part_id, name: row.name, material: row.material, process: row.process, quantity: row.quantity, unitPriceCents: row.unit_price_cents, subtotalCents: row.subtotal_cents };
}

function fairFromRow(row) {
  return { id: row.id, organizationId: row.organization_id, projectId: row.project_id, partId: row.part_id, characteristic: row.characteristic, nominal: row.nominal, tolerance: row.tolerance, status: row.status, createdAt: row.created_at };
}

function taskFromRow(row) {
  if (!row) return null;
  return { id: row.id, organizationId: row.organization_id, projectId: row.project_id, title: row.title, description: row.description || '', customerProfile: row.customer_profile || '', customerManagement: row.customer_management || '', projectList: row.project_list || '', stage: row.stage || '未分组', owner: row.owner_name, assigneeUserId: row.assignee_user_id || '', progress: row.progress, status: row.status, priority: row.priority || '普通', startAt: row.start_at || '', dueAt: row.due_at || '', createdAt: row.created_at, updatedAt: row.updated_at || row.created_at };
}

function taskSubtaskFromRow(row) {
  if (!row) return null;
  const completed = Boolean(row.completed);
  return {
    id: row.id,
    organizationId: row.organization_id,
    taskId: row.task_id,
    parentSubtaskId: row.parent_subtask_id || '',
    title: row.title,
    description: row.description || '',
    completed,
    status: row.status || (completed ? '已完成' : '待处理'),
    priority: row.priority || '普通',
    assigneeUserId: row.assignee_user_id || '',
    assigneeUsername: row.assignee_username || '',
    assigneeDisplayName: row.assignee_display_name || row.assignee_username || '',
    startAt: row.start_at || '',
    dueAt: row.due_at || '',
    position: Number.isFinite(Number(row.position)) ? Number(row.position) : 0,
    createdBy: row.created_by || '',
    createdByUsername: row.created_by_username || '',
    createdByDisplayName: row.created_by_display_name || row.created_by_username || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at
  };
}

function taskCommentFromRow(row) { return row ? { id: row.id, taskId: row.task_id, subtaskId: row.subtask_id || '', userId: row.user_id || '', username: row.username || '', displayName: row.display_name || row.username || '', body: row.body, createdAt: row.created_at } : null; }
function taskAttachmentFromRow(row) {
  return row ? {
    id: row.id,
    taskId: row.task_id,
    subtaskId: row.subtask_id || '',
    uploaderUserId: row.uploader_user_id || '',
    uploaderUsername: row.uploader_username || '',
    uploaderDisplayName: row.uploader_display_name || row.uploader_username || '',
    name: row.name,
    mimeType: row.mime_type || 'application/octet-stream',
    sizeBytes: Number(row.size_bytes || 0),
    createdAt: row.created_at
  } : null;
}
function projectCommentFromRow(row) { return row ? { id: row.id, projectId: row.project_id, userId: row.user_id || '', username: row.username || '', displayName: row.display_name || row.username || '', body: row.body, createdAt: row.created_at } : null; }

function conversationFromRow(row) {
  return row ? {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    projectTitle: row.project_title || '',
    title: row.title,
    preview: row.preview || '',
    lastSender: row.last_sender || '',
    lastMessageAt: row.last_message_at || '',
    messageCount: Number(row.message_count || 0),
    unreadCount: Number(row.unread_count || 0),
    mentionCount: Number(row.mention_count || 0),
    savedForLater: Boolean(row.saved_for_later),
    createdAt: row.created_at
  } : null;
}
function attachmentFromRow(row) { return row ? { id: row.id, messageId: row.message_id || '', pendingConversationId: row.pending_conversation_id || '', name: row.name, mimeType: row.mime_type || 'application/octet-stream', sizeBytes: Number(row.size_bytes || 0), createdAt: row.created_at } : null; }
function messageFromRow(row, attachments = []) { return row ? { id: row.id, organizationId: row.organization_id, conversationId: row.conversation_id, userId: row.user_id, username: row.username || '', displayName: row.display_name || row.username || '', body: row.body, attachments, createdAt: row.created_at } : null; }

function storagePreviewKind(row) {
  const mimeType = String(row?.mime_type || '').toLowerCase();
  const extension = String(row?.extension || '').toLowerCase();
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (mimeType.startsWith('text/') || ['csv', 'json', 'xml', 'md', 'txt', 'log'].includes(extension)) return 'text';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(extension)
      || mimeType.includes('word') || mimeType.includes('spreadsheet') || mimeType.includes('presentation')) return 'office';
  if (['step', 'stp', 'iges', 'igs', 'stl', 'obj', 'glb', 'gltf', '3mf', 'dxf', 'dwg'].includes(extension)
      || mimeType.startsWith('model/') || mimeType.includes('dxf') || mimeType.includes('dwg')) return 'cad';
  return 'file';
}

function storageFileFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    ownerUserId: row.owner_user_id || '',
    ownerUsername: row.owner_username || '',
    ownerDisplayName: row.owner_display_name || row.owner_username || '',
    projectId: row.project_id || null,
    scope: row.scope === 'enterprise' ? 'enterprise' : 'personal',
    name: row.name,
    mimeType: row.mime_type || 'application/octet-stream',
    extension: row.extension || '',
    sizeBytes: Number(row.size_bytes || 0),
    status: row.status || 'ready',
    previewKind: storagePreviewKind(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at
  };
}

const conversationDetailsSql = `SELECT c.*, p.title AS project_title,
  (SELECT CASE WHEN TRIM(lm.body) != '' THEN lm.body ELSE COALESCE((SELECT '[附件] ' || a.name FROM chat_attachments a WHERE a.organization_id = c.organization_id AND a.message_id = lm.id ORDER BY a.created_at, a.rowid LIMIT 1), '') END FROM messages lm WHERE lm.organization_id = c.organization_id AND lm.conversation_id = c.id ORDER BY lm.created_at DESC, lm.rowid DESC LIMIT 1) AS preview,
  (SELECT COALESCE(u.display_name, u.username, '') FROM messages lm LEFT JOIN organization_user_profiles u ON u.id = lm.user_id AND u.organization_id = lm.organization_id WHERE lm.organization_id = c.organization_id AND lm.conversation_id = c.id ORDER BY lm.created_at DESC, lm.rowid DESC LIMIT 1) AS last_sender,
  (SELECT lm.created_at FROM messages lm WHERE lm.organization_id = c.organization_id AND lm.conversation_id = c.id ORDER BY lm.created_at DESC, lm.rowid DESC LIMIT 1) AS last_message_at,
  (SELECT COUNT(*) FROM messages lm WHERE lm.organization_id = c.organization_id AND lm.conversation_id = c.id) AS message_count
  FROM conversations c LEFT JOIN projects p ON p.organization_id = c.organization_id AND p.id = c.project_id`;

async function seed(db) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM organizations').get().count;
  if (Number(count) > 0) {
    const insertModule = db.prepare('INSERT OR IGNORE INTO organization_modules(organization_id, module_key, enabled, updated_at) VALUES(?, ?, 1, ?)');
    const organizationIds = db.prepare('SELECT id FROM organizations').all();
    for (const organization of organizationIds) for (const moduleKey of ['projects', 'workspace', 'bom', 'parts', 'communication', 'chat', 'tasks', 'stats']) insertModule.run(organization.id, moduleKey, now());
    return;
  }
  const createdAt = now();
  const organization = { id: 'org_demo', slug: 'mfggo-demo', name: 'MFGGO 制造中心' };
  const initialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD || '123456';
  const admin = { id: 'user_admin', username: 'admin', displayName: 'admin', passwordHash: hashPassword(initialAdminPassword) };
  db.prepare('INSERT INTO organizations(id, slug, name, created_at) VALUES(?, ?, ?, ?)').run(organization.id, organization.slug, organization.name, createdAt);
  db.prepare('INSERT INTO users(id, username, password_hash, display_name, created_at) VALUES(?, ?, ?, ?, ?)').run(admin.id, admin.username, admin.passwordHash, admin.displayName, createdAt);
  db.prepare('INSERT INTO memberships(id, organization_id, user_id, role, created_at) VALUES(?, ?, ?, ?, ?)').run(id('membership'), organization.id, admin.id, 'owner', createdAt);
  db.prepare('INSERT OR IGNORE INTO platform_admins(user_id, created_at) VALUES(?, ?)').run(admin.id, createdAt);
  const insertModule = db.prepare('INSERT OR IGNORE INTO organization_modules(organization_id, module_key, enabled, updated_at) VALUES(?, ?, 1, ?)');
  for (const moduleKey of ['projects', 'workspace', 'bom', 'parts', 'communication', 'chat', 'tasks', 'stats']) insertModule.run(organization.id, moduleKey, createdAt);

}

function normalizedTaskStatus(status, fallback = '待处理') {
  const value = String(status ?? '').trim();
  if (PROJECT_WORKFLOW_STAGES.includes(value) || LEGACY_TASK_STATUSES.includes(value)) return value;
  return fallback;
}

function canonicalTaskStatus(status, stage, fallback = '待处理') {
  const normalized = normalizedTaskStatus(status, fallback);
  const node = String(stage ?? '').trim();
  // A legacy import may carry a generic state (for example "进行中") while
  // its stage already names one of the real project workflow nodes. Persist
  // the node so the API, board, and task detail all agree after a reload.
  return PROJECT_WORKFLOW_STAGES.includes(node) && LEGACY_TASK_STATUSES.includes(normalized)
    ? node
    : normalized;
}

// Legacy standalone tasks sometimes stored the workflow node in `stage` and
// the generic four-state value in `status`. Promote only those unambiguous
// rows; project root tasks keep their legacy status compatibility because the
// project record remains the canonical board projection for them.
function reconcileStandaloneTaskWorkflowStatuses(db) {
  const legacyPlaceholders = LEGACY_TASK_STATUSES.map(() => '?').join(', ');
  const stagePlaceholders = PROJECT_WORKFLOW_STAGES.map(() => '?').join(', ');
  return db.prepare(`UPDATE tasks
    SET status = stage, updated_at = COALESCE(updated_at, created_at)
    WHERE project_id IS NULL
      AND status IN (${legacyPlaceholders})
      AND stage IN (${stagePlaceholders})`)
    .run(...LEGACY_TASK_STATUSES, ...PROJECT_WORKFLOW_STAGES).changes;
}

// Older installations stored the project card as the only record. Give every
// existing project one explicit root task rather than guessing from a title.
function backfillProjectRootTasks(db) {
  const projects = db.prepare(`SELECT p.* FROM projects p
    LEFT JOIN tasks t ON t.organization_id = p.organization_id AND t.id = p.root_task_id
    WHERE p.root_task_id IS NULL OR t.id IS NULL`).all();
  if (!projects.length) return;

  const findMemberByName = db.prepare(`SELECT u.id, u.display_name FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.organization_id = ? AND u.display_name = ?
    ORDER BY m.created_at LIMIT 1`);
  const findMemberById = db.prepare(`SELECT u.id, u.display_name FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.organization_id = ? AND u.id = ? LIMIT 1`);
  const findProjectMember = db.prepare(`SELECT u.id, u.display_name FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.organization_id = ? AND pm.project_id = ?
    ORDER BY pm.created_at LIMIT 1`);
  const addProjectMember = db.prepare(`INSERT OR IGNORE INTO project_members(organization_id, project_id, user_id, project_role, created_by, created_at)
    VALUES(?, ?, ?, 'member', ?, ?)`);
  const createTask = db.prepare(`INSERT INTO tasks(id, organization_id, project_id, title, description, customer_profile, customer_management, project_list, stage, owner_name, assignee_user_id, progress, status, priority, start_at, due_at, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const linkTask = db.prepare(`UPDATE projects
    SET root_task_id = ?, executor_user_id = ?, updated_at = ?
    WHERE organization_id = ? AND id = ?`);

  db.exec('BEGIN');
  try {
    for (const project of projects) {
      const owner = findMemberByName.get(project.organization_id, project.owner_name)
        || (project.owner_user_id ? findMemberById.get(project.organization_id, project.owner_user_id) : null)
        || (project.created_by ? findMemberById.get(project.organization_id, project.created_by) : null)
        || findProjectMember.get(project.organization_id, project.id);
      if (!owner) continue;

      // A missing root task is a broken historical projection. Do not carry
      // over the project's stale executor pointer when creating its fresh
      // root task; the task can be explicitly claimed or assigned afterwards.
      const executor = null;

      const timestamp = now();
      const taskId = id('task');
      addProjectMember.run(project.organization_id, project.id, owner.id, project.created_by || owner.id, timestamp);
      createTask.run(
        taskId,
        project.organization_id,
        project.id,
        project.title,
        project.description || '',
        '',
        '',
        '',
        project.tag || '未分组',
        '',
        null,
        Math.max(0, Math.min(100, Number(project.progress) || 0)),
        canonicalTaskStatus(project.status, project.stage),
        project.priority || '普通',
        project.start_at || null,
        project.due_at || null,
        project.created_at || timestamp,
        timestamp
      );
      linkTask.run(taskId, null, timestamp, project.organization_id, project.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// A project card is a board placement for its root task, not a second task
// record. Older builds wrote task fields to both tables, which allowed the
// card and its detail dialog to disagree after a reload. Preserve the board
// stage on projects, but rebuild every other display field from the root task.
function reconcileProjectRootTaskProjections(db) {
  const rows = db.prepare(`SELECT
      p.id AS project_id,
      p.organization_id,
      p.title AS project_title,
      p.stage AS project_stage,
      p.owner_name AS project_owner_name,
      p.owner_user_id AS project_owner_user_id,
      p.executor_user_id AS project_executor_user_id,
      p.tag AS project_tag,
      p.progress AS project_progress,
      p.status AS project_status,
      p.description AS project_description,
      p.priority AS project_priority,
      p.start_at AS project_start_at,
      p.due_at AS project_due_at,
      p.updated_at AS project_updated_at,
      t.title AS task_title,
      t.owner_name AS task_owner_name,
      t.assignee_user_id AS task_assignee_user_id,
      t.stage AS task_stage,
      t.progress AS task_progress,
      t.status AS task_status,
      t.description AS task_description,
      t.priority AS task_priority,
      t.start_at AS task_start_at,
      t.due_at AS task_due_at,
      t.created_at AS task_created_at,
      t.updated_at AS task_updated_at
    FROM projects p
    JOIN tasks t ON t.organization_id = p.organization_id AND t.id = p.root_task_id`).all();
  if (!rows.length) return 0;

  const update = db.prepare(`UPDATE projects
    SET title = ?, stage = ?, tag = ?, progress = ?, status = ?, description = ?,
      priority = ?, start_at = ?, due_at = ?, executor_user_id = ?,
      updated_at = ?
    WHERE organization_id = ? AND id = ?`);
  let repaired = 0;
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      const projection = {
        title: row.task_title || row.project_title,
        stage: PROJECT_WORKFLOW_STAGES.includes(row.task_status) ? row.task_status : (row.project_stage || '立项沟通'),
        executorUserId: row.task_assignee_user_id || null,
        tag: row.task_stage || '',
        progress: Math.max(0, Math.min(100, Number(row.task_progress) || 0)),
        status: normalizedTaskStatus(row.task_status),
        description: row.task_description || '',
        priority: row.task_priority || '普通',
        startAt: row.task_start_at || null,
        dueAt: row.task_due_at || null
      };
      const differs = projection.title !== row.project_title
        || projection.tag !== (row.project_tag || '')
        || projection.progress !== Number(row.project_progress || 0)
        || projection.status !== normalizedTaskStatus(row.project_status)
        || projection.description !== (row.project_description || '')
        || projection.priority !== (row.project_priority || '普通')
        || projection.startAt !== (row.project_start_at || null)
        || projection.dueAt !== (row.project_due_at || null)
        || projection.executorUserId !== (row.project_executor_user_id || null)
        // A workflow status is the canonical board placement. Legacy status
        // values remain compatible and intentionally do not move the card.
        || (PROJECT_WORKFLOW_STAGES.includes(projection.status) && projection.status !== (row.project_stage || ''));
      if (!differs) continue;

      const taskUpdatedAt = row.task_updated_at || row.task_created_at || now();
      const updatedAt = taskUpdatedAt > (row.project_updated_at || '') ? taskUpdatedAt : row.project_updated_at;
      update.run(
        projection.title,
        projection.stage,
        projection.tag,
        projection.progress,
        projection.status,
        projection.description,
        projection.priority,
        projection.startAt,
        projection.dueAt,
        projection.executorUserId,
        updatedAt || taskUpdatedAt,
        row.organization_id,
        row.project_id
      );
      repaired += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return repaired;
}

// The project card is the sole project task. Remove records created by the
// former nested-task implementation only after every project has a root task.
// Subtasks are a separate checklist table and must survive this cleanup.
function removeLegacyProjectChildTasks(db) {
  const staleTaskIds = new Set(db.prepare(`SELECT t.id FROM tasks t
    JOIN projects p ON p.organization_id = t.organization_id AND p.id = t.project_id
    WHERE p.root_task_id IS NOT NULL AND t.id <> p.root_task_id`).all().map(row => row.id));
  const staleAuditIds = db.prepare('SELECT id, action, entity_type, entity_id, metadata_json FROM audit_events').all()
    .filter(event => {
      if (staleTaskIds.has(event.entity_id)) return true;
      try { return staleTaskIds.has(JSON.parse(event.metadata_json || '{}')?.taskId); }
      catch { return false; }
    })
    .map(event => event.id);
  if (!staleTaskIds.size && !staleAuditIds.length) return;

  db.exec('BEGIN IMMEDIATE');
  try {
    const deleteAudit = db.prepare('DELETE FROM audit_events WHERE id = ?');
    for (const auditId of staleAuditIds) deleteAudit.run(auditId);
    const deleteTask = db.prepare('DELETE FROM tasks WHERE id = ?');
    for (const taskId of staleTaskIds) deleteTask.run(taskId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// Early participant-removal audit rows stored only the user ID. Preserve the
// history, but enrich it with the display name so the task activity stream is
// understandable after that participant has left the project.
function backfillProjectMemberAuditNames(db) {
  const rows = db.prepare(`SELECT id, organization_id, entity_id, metadata_json
    FROM audit_events
    WHERE action IN ('project.member.add', 'project.member.remove')`).all();
  const findUser = db.prepare(`SELECT COALESCE(NULLIF(u.display_name, ''), u.username) AS display_name
    FROM users u
    WHERE u.id = ?`);
  const update = db.prepare('UPDATE audit_events SET metadata_json = ? WHERE id = ?');
  let changed = 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      let metadata;
      try { metadata = JSON.parse(row.metadata_json || '{}'); } catch { metadata = {}; }
      if (metadata.userName) continue;
      const userId = metadata.userId || String(row.entity_id || '').split(':').at(-1);
      if (!userId) continue;
      const user = findUser.get(userId);
      if (!user?.display_name) continue;
      metadata.userId = userId;
      metadata.userName = user.display_name;
      update.run(JSON.stringify(metadata), row.id);
      changed += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return changed;
}

export async function createDatabase({ dbPath }) {
  await mkdir(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(schema);
  try { db.exec('ALTER TABLE office_documents ADD COLUMN deleted_at TEXT'); } catch {}
  try { db.exec('ALTER TABLE office_documents ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL'); } catch {}
    try { db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT '普通'"); } catch {}
    try { db.exec("ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''"); } catch {}
    try { db.exec("ALTER TABLE tasks ADD COLUMN customer_profile TEXT NOT NULL DEFAULT ''"); } catch {}
    try { db.exec("ALTER TABLE tasks ADD COLUMN customer_management TEXT NOT NULL DEFAULT ''"); } catch {}
    try { db.exec("ALTER TABLE tasks ADD COLUMN project_list TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec('ALTER TABLE tasks ADD COLUMN start_at TEXT'); } catch {}
  try { db.exec('ALTER TABLE tasks ADD COLUMN due_at TEXT'); } catch {}
  try { db.exec('ALTER TABLE tasks ADD COLUMN updated_at TEXT'); } catch {}
  // Older builds shipped a minimal task_subtasks table. Add the richer
  // checklist fields in place so existing rows remain visible after upgrade.
  try { db.exec("ALTER TABLE task_subtasks ADD COLUMN description TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE task_subtasks ADD COLUMN status TEXT NOT NULL DEFAULT '待处理'"); } catch {}
  try { db.exec("ALTER TABLE task_subtasks ADD COLUMN priority TEXT NOT NULL DEFAULT '普通'"); } catch {}
  try { db.exec('ALTER TABLE task_subtasks ADD COLUMN assignee_user_id TEXT REFERENCES users(id)'); } catch {}
  try { db.exec('ALTER TABLE task_subtasks ADD COLUMN due_at TEXT'); } catch {}
  try { db.exec('ALTER TABLE task_subtasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0'); } catch {}
    try { db.exec('ALTER TABLE task_subtasks ADD COLUMN parent_subtask_id TEXT REFERENCES task_subtasks(id) ON DELETE CASCADE'); } catch {}
    try { db.exec('ALTER TABLE task_subtasks ADD COLUMN start_at TEXT'); } catch {}
  try { db.exec('ALTER TABLE task_comments ADD COLUMN subtask_id TEXT REFERENCES task_subtasks(id) ON DELETE CASCADE'); } catch {}
  try { db.exec('ALTER TABLE task_attachments ADD COLUMN subtask_id TEXT REFERENCES task_subtasks(id) ON DELETE CASCADE'); } catch {}
  // Keep the legacy boolean representation and the visible status label in
  // sync when upgrading rows created by the original checklist schema.
  db.exec("UPDATE task_subtasks SET status = '已完成' WHERE completed = 1 AND (status IS NULL OR TRIM(status) = '' OR status = '待处理')");
  try { db.exec("ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN priority TEXT NOT NULL DEFAULT '普通'"); } catch {}
  try { db.exec('ALTER TABLE projects ADD COLUMN executor_user_id TEXT REFERENCES users(id)'); } catch {}
  try { db.exec('ALTER TABLE projects ADD COLUMN start_at TEXT'); } catch {}
  try { db.exec('ALTER TABLE projects ADD COLUMN due_at TEXT'); } catch {}
  try { db.exec('ALTER TABLE projects ADD COLUMN root_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL'); } catch {}
  try { db.exec('ALTER TABLE conversation_user_states ADD COLUMN last_read_message_rowid INTEGER'); } catch {}
  try { db.exec('ALTER TABLE chat_attachments ADD COLUMN pending_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL'); } catch {}
  db.exec('UPDATE tasks SET updated_at = COALESCE(updated_at, created_at)');
  db.exec("UPDATE projects SET status = '待处理' WHERE status IS NULL OR TRIM(status) = '' OR status = 'active'");
  // Migrate the former overloaded owner field. A project's manager is its
  // creator; an existing root-task assignee is retained independently as the
  // executor. These statements are idempotent on every startup.
  db.exec(`UPDATE projects
    SET owner_user_id = COALESCE(created_by, owner_user_id)
    WHERE created_by IS NOT NULL`);
  db.exec(`UPDATE projects
    SET owner_name = COALESCE((SELECT u.display_name FROM users u WHERE u.id = projects.owner_user_id), owner_name)
    WHERE owner_user_id IS NOT NULL`);
  db.exec(`UPDATE projects
    SET executor_user_id = (SELECT t.assignee_user_id FROM tasks t
      WHERE t.organization_id = projects.organization_id AND t.id = projects.root_task_id)
    WHERE (executor_user_id IS NULL OR TRIM(executor_user_id) = '')
      AND root_task_id IS NOT NULL`);
  // A deleted or never-created root task leaves no valid executor scope. Clear
  // the old project-level pointer before backfill so the replacement task is
  // intentionally unassigned rather than inheriting stale ownership. The
  // NOT EXISTS branch also handles old databases that retained a dangling,
  // non-null root_task_id after deletion.
  db.exec(`UPDATE projects
    SET executor_user_id = NULL
    WHERE root_task_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.organization_id = projects.organization_id
          AND t.id = projects.root_task_id
      )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_office_documents_project ON office_documents(organization_id, project_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_storage_files_scope ON storage_files(organization_id, scope, updated_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_storage_files_owner ON storage_files(organization_id, owner_user_id, updated_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_storage_files_project ON storage_files(organization_id, project_id, updated_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(organization_id, user_id, project_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(organization_id, project_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_task_subtasks_task ON task_subtasks(organization_id, task_id, position, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_task_subtasks_parent ON task_subtasks(organization_id, task_id, parent_subtask_id, position, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(organization_id, task_id, subtask_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(organization_id, task_id, subtask_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_task_attachments_uploader ON task_attachments(organization_id, uploader_user_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversation_user_states_user ON conversation_user_states(organization_id, user_id, saved_for_later)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_chat_attachments_message ON chat_attachments(organization_id, message_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_chat_attachments_pending_conversation ON chat_attachments(organization_id, pending_conversation_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(organization_id, conversation_id, created_at)');
  db.prepare(`INSERT OR IGNORE INTO project_members(organization_id, project_id, user_id, project_role, created_by, created_at)
    SELECT organization_id, id, COALESCE(owner_user_id, created_by), 'member', created_by, created_at
    FROM projects WHERE COALESCE(owner_user_id, created_by) IS NOT NULL`).run();
  // Historical rows used owner/manager labels. They are not project
  // permissions: all project members are participants now.
  db.prepare("UPDATE project_members SET project_role = 'member' WHERE project_role != 'member'").run();
  backfillProjectMemberAuditNames(db);
  await seed(db);
  backfillProjectRootTasks(db);
  removeLegacyProjectChildTasks(db);
  reconcileProjectRootTaskProjections(db);
  reconcileStandaloneTaskWorkflowStatuses(db);
  const decorateConversationForUser = (row, organizationId, userId) => {
    const conversation = conversationFromRow(row);
    if (!conversation || !userId) return conversation;
    const state = db.prepare('SELECT * FROM conversation_user_states WHERE organization_id = ? AND conversation_id = ? AND user_id = ?').get(organizationId, conversation.id, userId);
    const lastReadMessageRowId = state?.last_read_message_rowid ?? null;
    const lastReadAt = state?.last_read_at || null;
    const unreadRows = db.prepare(`SELECT body FROM messages
      WHERE organization_id = ? AND conversation_id = ? AND COALESCE(user_id, ?) != ?
        AND CASE WHEN ? IS NOT NULL THEN rowid > ? ELSE (? IS NULL OR created_at > ?) END
      ORDER BY created_at, rowid`).all(organizationId, conversation.id, '', userId, lastReadMessageRowId, lastReadMessageRowId, lastReadAt, lastReadAt);
    const user = db.prepare('SELECT username, display_name FROM organization_user_profiles WHERE id = ? AND organization_id = ?').get(userId, organizationId);
    const mentionTokens = [...new Set([user?.username, user?.display_name].filter(Boolean).map(value => `@${value}`))];
    conversation.unreadCount = unreadRows.length;
    conversation.mentionCount = unreadRows.filter(message => mentionTokens.some(token => String(message.body || '').includes(token))).length;
    conversation.savedForLater = Boolean(state?.saved_for_later);
    return conversation;
  };
  const messagesFromRows = (rows, organizationId) => rows.map(row => {
    const attachments = db.prepare('SELECT * FROM chat_attachments WHERE organization_id = ? AND message_id = ? ORDER BY created_at, rowid').all(organizationId, row.id).map(attachmentFromRow);
    return messageFromRow(row, attachments);
  });
  const api = {
    close: () => db.close(),
    authenticate(username, password) {
      const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!row || !verifyPassword(password, row.password_hash)) return null;
      const membership = db.prepare('SELECT * FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1').get(row.id);
      if (!membership) return null;
      const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(membership.organization_id);
      return { user: { ...userFromRow(row), displayName: membership.display_name_override || row.display_name }, organization: organizationFromRow(org), role: membership.role };
    },
    createSession(userId, organizationId) {
      const token = randomBytes(32).toString('hex');
      const createdAt = now();
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
      db.prepare('INSERT INTO sessions(token, user_id, organization_id, created_at, expires_at) VALUES(?, ?, ?, ?, ?)').run(token, userId, organizationId, createdAt, expiresAt);
      return { token, expiresAt };
    },
    getSession(token) {
      const row = db.prepare("SELECT s.*, u.username, COALESCE(NULLIF(m.display_name_override, ''), u.display_name) AS display_name, o.slug, o.name AS organization_name, m.role, m.department_id, m.job_title FROM sessions s JOIN users u ON u.id = s.user_id JOIN organizations o ON o.id = s.organization_id JOIN memberships m ON m.user_id = s.user_id AND m.organization_id = s.organization_id WHERE s.token = ? AND s.expires_at > ?").get(token, now());
      if (!row) return null;
      const platform = this.getPlatformAccess?.(row.user_id) || { role: null, permissions: {} };
      return { token: row.token, userId: row.user_id, organizationId: row.organization_id,
        user: { id: row.user_id, username: row.username, displayName: row.display_name, departmentId: row.department_id || null, jobTitle: row.job_title || '' },
        organization: { id: row.organization_id, slug: row.slug, name: row.organization_name }, role: row.role,
        permissions: this.getMemberPermissions(row.organization_id, row.user_id), grantablePermissions: this.getMemberGrantablePermissions(row.organization_id, row.user_id),
        platformRole: platform.role, platformPermissions: platform.permissions, expiresAt: row.expires_at };
    },
    getMembership(userId, organizationId) { return db.prepare('SELECT * FROM memberships WHERE user_id = ? AND organization_id = ?').get(userId, organizationId); },
    isPlatformAdmin(userId) { return Boolean(db.prepare('SELECT 1 FROM platform_admins WHERE user_id = ?').get(userId)); },
    deleteSession(token) { db.prepare('DELETE FROM sessions WHERE token = ?').run(token); },
    listOfficeDocuments(organizationId, userId, projectId = undefined) {
      const projectFilter = projectId === undefined ? '' : ' AND d.project_id = ?';
      const parameters = [userId, userId, organizationId, userId];
      if (projectId !== undefined) parameters.push(projectId);
      return db.prepare(`SELECT d.*,u.display_name AS owner_name,CASE WHEN d.owner_user_id=? THEN 'edit' ELSE COALESCE(p.permission,CASE WHEN d.scope='organization' THEN 'view' END) END AS permission FROM office_documents d JOIN organization_user_profiles u ON u.id=d.owner_user_id AND u.organization_id=d.organization_id LEFT JOIN office_document_permissions p ON p.document_id=d.id AND p.user_id=? WHERE d.organization_id=? AND d.deleted_at IS NULL AND (d.owner_user_id=? OR d.scope='organization' OR p.user_id IS NOT NULL)${projectFilter} ORDER BY d.updated_at DESC`).all(...parameters).map(row=>({id:row.id,projectId:row.project_id||null,title:row.title,fileType:row.file_type,sizeBytes:row.size_bytes,version:row.version,scope:row.owner_user_id===userId?'mine':row.scope,owner:row.owner_name,permission:row.permission,updatedAt:row.updated_at}));
    },
    getOfficeDocument(organizationId, userId, documentId) { return this.listOfficeDocuments(organizationId,userId).find(item=>item.id===documentId)||null; },
    createOfficeDocument({organizationId,projectId=null,userId,title,storageKey,sizeBytes=0,scope='private',fileType='xlsx'}) { const createdAt=now(),documentId=id('document'); db.prepare('INSERT INTO office_documents(id,organization_id,project_id,owner_user_id,title,file_type,storage_key,size_bytes,scope,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(documentId,organizationId,projectId,userId,title,fileType,storageKey,sizeBytes,scope,createdAt,createdAt); return this.getOfficeDocument(organizationId,userId,documentId); },
    getOfficeDocumentStorage(organizationId, documentId) { return db.prepare('SELECT * FROM office_documents WHERE organization_id=? AND id=?').get(organizationId,documentId)||null; },
    touchOfficeDocument(documentId,sizeBytes) { db.prepare('UPDATE office_documents SET size_bytes=?,version=version+1,updated_at=? WHERE id=?').run(sizeBytes,now(),documentId); },
    renameOfficeDocument(organizationId,userId,documentId,title) { const result=db.prepare('UPDATE office_documents SET title=?,updated_at=? WHERE id=? AND organization_id=? AND owner_user_id=? AND deleted_at IS NULL').run(title,now(),documentId,organizationId,userId); return result.changes?this.getOfficeDocument(organizationId,userId,documentId):null; },
    trashOfficeDocument(organizationId,userId,documentId) { return db.prepare('UPDATE office_documents SET deleted_at=?,updated_at=? WHERE id=? AND organization_id=? AND owner_user_id=? AND deleted_at IS NULL').run(now(),now(),documentId,organizationId,userId).changes>0; },
    listTrashedOfficeDocuments(organizationId,userId) { return db.prepare('SELECT d.*,u.display_name owner_name FROM office_documents d JOIN organization_user_profiles u ON u.id=d.owner_user_id AND u.organization_id=d.organization_id WHERE d.organization_id=? AND d.owner_user_id=? AND d.deleted_at IS NOT NULL ORDER BY d.deleted_at DESC').all(organizationId,userId).map(row=>({id:row.id,projectId:row.project_id||null,title:row.title,fileType:row.file_type,sizeBytes:row.size_bytes,version:row.version,scope:'trash',owner:row.owner_name,permission:'edit',updatedAt:row.updated_at,deletedAt:row.deleted_at})); },
    restoreOfficeDocument(organizationId,userId,documentId) { return db.prepare('UPDATE office_documents SET deleted_at=NULL,updated_at=? WHERE id=? AND organization_id=? AND owner_user_id=? AND deleted_at IS NOT NULL').run(now(),documentId,organizationId,userId).changes>0; },
    deleteOfficeDocument(organizationId,userId,documentId) { const row=db.prepare('SELECT * FROM office_documents WHERE id=? AND organization_id=? AND owner_user_id=? AND deleted_at IS NOT NULL').get(documentId,organizationId,userId); if(!row)return null; db.prepare('DELETE FROM office_documents WHERE id=?').run(documentId); return row; },
    listStorageFiles(organizationId, userId, options = {}) {
      const scope = options?.scope === 'personal' || options?.scope === 'enterprise' ? options.scope : 'all';
      const projectId = options?.projectId === undefined ? undefined : (options.projectId || null);
      const clauses = ['f.organization_id = ?', 'f.deleted_at IS NULL'];
      const parameters = [organizationId];
      if (scope === 'personal') {
        clauses.push("f.scope = 'personal'", 'f.owner_user_id = ?');
        parameters.push(userId);
      } else if (scope === 'enterprise') {
        clauses.push("f.scope = 'enterprise'");
      } else {
        clauses.push("(f.scope = 'enterprise' OR f.owner_user_id = ?)");
        parameters.push(userId);
      }
      if (projectId !== undefined) {
        clauses.push('f.project_id = ?');
        parameters.push(projectId);
      }
      return db.prepare(`SELECT f.*, u.username AS owner_username, u.display_name AS owner_display_name
        FROM storage_files f LEFT JOIN organization_user_profiles u ON u.id = f.owner_user_id AND u.organization_id = f.organization_id
        WHERE ${clauses.join(' AND ')} ORDER BY f.updated_at DESC, f.rowid DESC`).all(...parameters).map(storageFileFromRow);
    },
    getStorageFile(organizationId, userId, fileId) {
      return storageFileFromRow(db.prepare(`SELECT f.*, u.username AS owner_username, u.display_name AS owner_display_name
        FROM storage_files f LEFT JOIN organization_user_profiles u ON u.id = f.owner_user_id AND u.organization_id = f.organization_id
        WHERE f.organization_id = ? AND f.id = ? AND f.deleted_at IS NULL
          AND (f.scope = 'enterprise' OR f.owner_user_id = ?)`)
        .get(organizationId, fileId, userId));
    },
    getStorageFileStorage(organizationId, fileId) {
      return db.prepare(`SELECT f.*, u.username AS owner_username, u.display_name AS owner_display_name
        FROM storage_files f LEFT JOIN organization_user_profiles u ON u.id = f.owner_user_id AND u.organization_id = f.organization_id
        WHERE f.organization_id = ? AND f.id = ? AND f.deleted_at IS NULL`).get(organizationId, fileId) || null;
    },
    createStorageFile({ organizationId, ownerUserId, projectId = null, scope = 'personal', name, mimeType, extension = '', sizeBytes = 0, storageKey, status = 'ready' }) {
      const normalizedScope = scope === 'enterprise' ? 'enterprise' : 'personal';
      const createdAt = now();
      const file = {
        id: id('storage-file'), organizationId, ownerUserId, projectId: projectId || null,
        scope: normalizedScope, name, mimeType: mimeType || 'application/octet-stream',
        extension: extension || '', sizeBytes: Math.max(0, Number(sizeBytes) || 0), storageKey,
        status: status || 'ready', createdAt, updatedAt: createdAt
      };
      db.prepare(`INSERT INTO storage_files(
        id, organization_id, owner_user_id, project_id, scope, name, mime_type,
        extension, size_bytes, storage_key, status, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        file.id, file.organizationId, file.ownerUserId, file.projectId, file.scope, file.name,
        file.mimeType, file.extension, file.sizeBytes, file.storageKey, file.status, file.createdAt, file.updatedAt
      );
      return storageFileFromRow(db.prepare(`SELECT f.*, u.username AS owner_username, u.display_name AS owner_display_name
        FROM storage_files f LEFT JOIN organization_user_profiles u ON u.id = f.owner_user_id AND u.organization_id = f.organization_id WHERE f.organization_id = ? AND f.id = ?`)
        .get(organizationId, file.id));
    },
    deleteStorageFile(organizationId, fileId) {
      const row = db.prepare('SELECT * FROM storage_files WHERE organization_id = ? AND id = ? AND deleted_at IS NULL').get(organizationId, fileId);
      if (!row) return null;
      db.prepare('DELETE FROM storage_files WHERE organization_id = ? AND id = ?').run(organizationId, fileId);
      return row;
    },
    listOrganizations() {
      return db.prepare(`SELECT o.*, COUNT(DISTINCT m.user_id) AS member_count, COUNT(DISTINCT p.id) AS project_count
        FROM organizations o
        LEFT JOIN memberships m ON m.organization_id = o.id
        LEFT JOIN projects p ON p.organization_id = o.id AND NOT EXISTS
          (SELECT 1 FROM task_recycle_entries r WHERE r.organization_id = p.organization_id AND r.resource_type = 'project' AND r.resource_id = p.id AND r.restored_at IS NULL)
        GROUP BY o.id ORDER BY o.created_at DESC`).all().map(row => ({ ...organizationFromRow(row), memberCount: row.member_count, projectCount: row.project_count, createdAt: row.created_at }));
    },
    listPlatformUsers() {
      return db.prepare(`SELECT u.id, u.username, u.display_name, u.created_at,
        GROUP_CONCAT(DISTINCT o.name) AS organization_names,
        GROUP_CONCAT(DISTINCT m.role) AS roles
        FROM users u
        LEFT JOIN memberships m ON m.user_id = u.id
        LEFT JOIN organizations o ON o.id = m.organization_id
        GROUP BY u.id ORDER BY u.created_at DESC`).all().map(row => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        organizations: row.organization_names ? row.organization_names.split(',') : [],
        roles: row.roles ? row.roles.split(',') : [],
        createdAt: row.created_at
      }));
    },
    createOrganization({ name, slug, ownerUserId }) {
      const createdAt = now();
      const organization = { id: id('org'), slug, name, createdAt };
      db.prepare('INSERT INTO organizations(id, slug, name, created_at) VALUES(?, ?, ?, ?)').run(organization.id, organization.slug, organization.name, organization.createdAt);
      db.prepare('INSERT INTO memberships(id, organization_id, user_id, role, created_at) VALUES(?, ?, ?, ?, ?)').run(id('membership'), organization.id, ownerUserId, 'owner', createdAt);
      const insertModule = db.prepare('INSERT INTO organization_modules(organization_id, module_key, enabled, updated_at) VALUES(?, ?, 1, ?)');
      for (const moduleKey of ['projects', 'workspace', 'bom', 'parts', 'communication', 'chat', 'tasks', 'stats']) insertModule.run(organization.id, moduleKey, createdAt);
      return { ...organizationFromRow(organization), memberCount: 1, projectCount: 0, createdAt };
    },
    listOrganizationModules(organizationId) {
      return db.prepare("SELECT module_key, enabled FROM organization_modules WHERE organization_id = ? AND module_key <> 'files' ORDER BY module_key").all(organizationId).reduce((result, row) => ({ ...result, [row.module_key]: Boolean(row.enabled) }), {});
    },
    setOrganizationModules(organizationId, modules) {
      const allowed = ['projects', 'workspace', 'bom', 'parts', 'communication', 'chat', 'tasks', 'stats'];
      const statement = db.prepare(`INSERT INTO organization_modules(organization_id, module_key, enabled, updated_at) VALUES(?, ?, ?, ?)
        ON CONFLICT(organization_id, module_key) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`);
      const updatedAt = now();
      for (const moduleKey of allowed) statement.run(organizationId, moduleKey, modules[moduleKey] ? 1 : 0, updatedAt);
      return this.listOrganizationModules(organizationId);
    },
    listProjects(organizationId) { return db.prepare('SELECT * FROM projects WHERE organization_id = ? ORDER BY updated_at DESC').all(organizationId).map(projectFromRow); },
    listProjectsForUser(organizationId, userId, role) {
      if (['owner', 'admin'].includes(role)) return this.listProjects(organizationId);
      return db.prepare(`SELECT p.* FROM projects p
        WHERE p.organization_id = ?
          AND EXISTS (SELECT 1 FROM project_members pm WHERE pm.organization_id = p.organization_id AND pm.project_id = p.id AND pm.user_id = ?)
        ORDER BY p.updated_at DESC`).all(organizationId, userId).map(projectFromRow);
    },
    getProject(organizationId, projectId) { return projectFromRow(db.prepare('SELECT * FROM projects WHERE organization_id = ? AND id = ?').get(organizationId, projectId)); },
    getProjectRootTask(organizationId, projectId) {
      return taskFromRow(db.prepare(`SELECT t.* FROM projects p
        JOIN tasks t ON t.organization_id = p.organization_id AND t.id = p.root_task_id
        WHERE p.organization_id = ? AND p.id = ?`).get(organizationId, projectId));
    },
    isProjectMember(organizationId, projectId, userId) {
      return Boolean(db.prepare('SELECT 1 FROM project_members WHERE organization_id = ? AND project_id = ? AND user_id = ?').get(organizationId, projectId, userId));
    },
    listProjectMembers(organizationId, projectId) {
      return db.prepare(`SELECT pm.project_role, pm.created_at, u.id, u.username,
        COALESCE(NULLIF(m.display_name_override, ''), u.display_name) AS display_name
        FROM project_members pm JOIN users u ON u.id = pm.user_id
        JOIN memberships m ON m.organization_id = pm.organization_id AND m.user_id = pm.user_id
        WHERE pm.organization_id = ? AND pm.project_id = ? ORDER BY pm.created_at`)
        .all(organizationId, projectId)
        .map(row => ({ id: row.id, username: row.username, displayName: row.display_name, projectRole: 'member', createdAt: row.created_at }));
    },
    addProjectMember({ organizationId, projectId, userId, projectRole = 'member', createdBy }) {
      const createdAt = now();
      db.prepare(`INSERT INTO project_members(organization_id, project_id, user_id, project_role, created_by, created_at)
        VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, user_id) DO UPDATE SET project_role = excluded.project_role`)
        .run(organizationId, projectId, userId, 'member', createdBy || null, createdAt);
      return db.prepare(`SELECT pm.project_role, pm.created_at, u.id, u.username,
        COALESCE(NULLIF(m.display_name_override, ''), u.display_name) AS display_name
        FROM project_members pm JOIN users u ON u.id = pm.user_id
        JOIN memberships m ON m.organization_id = pm.organization_id AND m.user_id = pm.user_id
        WHERE pm.organization_id = ? AND pm.project_id = ? AND pm.user_id = ?`).get(organizationId, projectId, userId);
    },
    removeProjectMember(organizationId, projectId, userId, actorId) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const project = this.getProject(organizationId, projectId);
        if (!project) throw new Error('project_not_found');
        const member = db.prepare(`SELECT COALESCE(NULLIF(m.display_name_override, ''), u.display_name, u.username) AS display_name
          FROM project_members pm JOIN users u ON u.id = pm.user_id
          LEFT JOIN memberships m ON m.organization_id = pm.organization_id AND m.user_id = pm.user_id
          WHERE pm.organization_id = ? AND pm.project_id = ? AND pm.user_id = ?`)
          .get(organizationId, projectId, userId);
        if (!member) throw new Error('project_member_not_found');
        const assigned = db.prepare(`SELECT id FROM tasks WHERE organization_id = ? AND project_id = ? AND assignee_user_id = ?
          UNION ALL SELECT s.id FROM task_subtasks s JOIN tasks t ON t.id = s.task_id
          WHERE t.organization_id = ? AND t.project_id = ? AND s.assignee_user_id = ? LIMIT 1`)
          .get(organizationId, projectId, userId, organizationId, projectId, userId);
        if (assigned) throw new Error('project_member_assigned');
        const result = db.prepare('DELETE FROM project_members WHERE organization_id = ? AND project_id = ? AND user_id = ?').run(organizationId, projectId, userId);
        if (result.changes) this.addAudit({ organizationId, userId: actorId, action: 'project.member.remove', entityType: 'project_member', entityId: `${projectId}:${userId}`, metadata: { projectId, userId, userName: member?.display_name || '' } });
        db.exec('COMMIT');
        return { removed: Boolean(result.changes) };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    updateProject(organizationId, projectId, changes, options = {}) {
      const current = db.prepare('SELECT * FROM projects WHERE organization_id = ? AND id = ?').get(organizationId, projectId);
      if (!current) return null;
      const title = changes.title ?? current.title;
      const stage = changes.stage ?? current.stage;
      if (changes.stage !== undefined && !PROJECT_WORKFLOW_STAGES.includes(stage)) throw new Error('invalid_project_stage');
      const workflowStatus = changes.stage !== undefined && PROJECT_WORKFLOW_STAGES.includes(stage) ? stage : null;
      const workflowProgress = workflowStatus ? workflowProgressFromNode(workflowStatus) : null;
      const expectedAssigneeProvided = Object.hasOwn(options, 'expectedAssigneeUserId');
      const expectedAssigneeUserId = options.expectedAssigneeUserId || null;
      const updatedAt = now();
      // The card and root task share one workflow node. A drag on the board
      // updates the root-task status, while legacy free-form stages remain
      // readable without being written into the status field.
      db.exec('SAVEPOINT project_update');
      try {
        if (current.root_task_id && (title !== current.title || workflowStatus)) {
          const taskUpdate = db.prepare(`UPDATE tasks SET title = ?, status = COALESCE(?, status), progress = COALESCE(?, progress), updated_at = ?
            WHERE organization_id = ? AND id = ?${expectedAssigneeProvided ? " AND COALESCE(TRIM(assignee_user_id), '') = COALESCE(TRIM(?), '')" : ''}`);
          const parameters = [title, workflowStatus, workflowProgress, updatedAt, organizationId, current.root_task_id];
          if (expectedAssigneeProvided) parameters.push(expectedAssigneeUserId);
          const result = taskUpdate.run(...parameters);
          if (expectedAssigneeProvided && !result.changes) {
            db.exec('ROLLBACK TO SAVEPOINT project_update; RELEASE SAVEPOINT project_update');
            return null;
          }
        }
        db.prepare(`UPDATE projects SET title = ?, stage = ?, status = COALESCE(?, status), progress = COALESCE(?, progress), updated_at = ?
          WHERE organization_id = ? AND id = ?`).run(title, stage, workflowStatus, workflowProgress, updatedAt, organizationId, projectId);
        db.exec('RELEASE SAVEPOINT project_update');
      } catch (error) {
        db.exec('ROLLBACK TO SAVEPOINT project_update; RELEASE SAVEPOINT project_update');
        throw error;
      }
      return projectFromRow(db.prepare('SELECT * FROM projects WHERE organization_id = ? AND id = ?').get(organizationId, projectId));
    },
    createProject({ organizationId, userId, title, stage, status, owner, ownerUserId = userId, tag, progress, step }) {
      const ownerMember = db.prepare(`SELECT u.id, COALESCE(NULLIF(m.display_name_override, ''), u.display_name) AS display_name FROM memberships m
        JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = ? AND m.user_id = ?`).get(organizationId, ownerUserId);
      if (!ownerMember) throw new Error('project_owner_not_found');
      const creatorMember = db.prepare(`SELECT u.id, COALESCE(NULLIF(m.display_name_override, ''), u.display_name) AS display_name FROM memberships m
        JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = ? AND m.user_id = ?`).get(organizationId, userId);
      if (!creatorMember) throw new Error('project_creator_not_found');
      const normalizedStage = stage || '立项沟通';
      if (!PROJECT_WORKFLOW_STAGES.includes(normalizedStage)) throw new Error('invalid_project_stage');
      const createdAt = now();
      const projectStatus = normalizedTaskStatus(status, normalizedStage);
      const project = {
        id: id('project'),
        organizationId,
        title,
        stage: normalizedStage,
        owner: ownerMember.display_name || owner || 'admin',
        ownerUserId: ownerMember.id,
        tag: tag || '',
        progress: workflowProgressFromNode(projectStatus) ?? workflowProgressFromNode(stage) ?? Math.max(0, Math.min(100, Number(progress) || 0)),
        step: step || '0/1',
        // Project status is the workflow node selected on the project board.
        // Keep legacy task states readable for older clients, but use the
        // first real node when no status is supplied.
        status: projectStatus,
        createdAt
      };
      const rootTaskId = id('task');
      db.exec('SAVEPOINT project_create');
      try {
        db.prepare('INSERT INTO projects(id, organization_id, title, stage, owner_name, owner_user_id, executor_user_id, root_task_id, tag, progress, step, status, created_by, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)').run(project.id, organizationId, project.title, project.stage, project.owner, project.ownerUserId, project.tag, project.progress, project.step, project.status, userId, createdAt, createdAt);
        db.prepare('INSERT INTO project_members(organization_id, project_id, user_id, project_role, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(organizationId, project.id, project.ownerUserId, 'member', userId, createdAt);
        if (project.ownerUserId !== creatorMember.id) {
          db.prepare('INSERT OR IGNORE INTO project_members(organization_id, project_id, user_id, project_role, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(organizationId, project.id, creatorMember.id, 'member', userId, createdAt);
        }
        // The creator may be a salesperson. A new project has no responsible
        // person until a participant claims it or it is handed over.
        db.prepare('INSERT INTO tasks(id, organization_id, project_id, title, description, customer_profile, customer_management, project_list, stage, owner_name, assignee_user_id, progress, status, priority, start_at, due_at, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)').run(rootTaskId, organizationId, project.id, project.title, '', '', '', '', project.tag || '未分组', '', project.progress, project.status, '普通', null, null, createdAt, createdAt);
        db.prepare('UPDATE projects SET root_task_id = ? WHERE organization_id = ? AND id = ?').run(rootTaskId, organizationId, project.id);
        db.exec('RELEASE SAVEPOINT project_create');
      } catch (error) {
        db.exec('ROLLBACK TO SAVEPOINT project_create; RELEASE SAVEPOINT project_create');
        throw error;
      }
      return projectFromRow(db.prepare('SELECT * FROM projects WHERE organization_id = ? AND id = ?').get(organizationId, project.id));
    },
    listTasks(organizationId, userId) {
      return db.prepare(`SELECT t.* FROM tasks t
        WHERE t.organization_id = ? AND t.assignee_user_id = ?
        ORDER BY t.created_at DESC`).all(organizationId, userId).map(taskFromRow);
    },
    getTask(organizationId, taskId) { return taskFromRow(db.prepare('SELECT * FROM tasks WHERE organization_id = ? AND id = ?').get(organizationId, taskId)); },
    // Claiming an unassigned project task is a single conditional UPDATE so
    // concurrent members cannot overwrite one another.  The caller must still
    // verify project membership before invoking this method.
    claimTask(organizationId, taskId, userId) {
      const result = db.prepare(`UPDATE tasks
        SET assignee_user_id = ?,
            owner_name = COALESCE((SELECT u.display_name FROM organization_user_profiles u WHERE u.id = ? AND u.organization_id = tasks.organization_id), owner_name),
            updated_at = ?
        WHERE organization_id = ?
          AND id = ?
          AND project_id IS NOT NULL
          AND COALESCE(TRIM(assignee_user_id), '') = ''`).run(userId, userId, now(), organizationId, taskId);
      if (!result.changes) return null;
      return taskFromRow(db.prepare('SELECT * FROM tasks WHERE organization_id = ? AND id = ?').get(organizationId, taskId));
    },
    // Transfer (or release) only when the expected current executor still
    // owns the task. This closes the stale-write window between an HTTP read
    // and a handoff request.
    transferTask(organizationId, taskId, fromUserId, toUserId = null) {
      const timestamp = now();
      const result = db.prepare(`UPDATE tasks
        SET assignee_user_id = ?,
            owner_name = CASE WHEN ? IS NULL THEN ''
              ELSE COALESCE((SELECT u.display_name FROM organization_user_profiles u WHERE u.id = ? AND u.organization_id = tasks.organization_id), owner_name) END,
            updated_at = ?
        WHERE organization_id = ? AND id = ? AND project_id IS NOT NULL
          AND assignee_user_id = ?`).run(toUserId || null, toUserId || null, toUserId || null,
          timestamp, organizationId, taskId, fromUserId);
      if (!result.changes) return null;
      return taskFromRow(db.prepare('SELECT * FROM tasks WHERE organization_id = ? AND id = ?').get(organizationId, taskId));
    },
    listTaskSubtasks(organizationId, taskId, parentSubtaskId = null) {
      const hasParent = Boolean(parentSubtaskId);
      const rows = hasParent
        ? db.prepare(`SELECT s.*,
          au.username AS assignee_username, au.display_name AS assignee_display_name,
          cu.username AS created_by_username, cu.display_name AS created_by_display_name
        FROM task_subtasks s
        LEFT JOIN organization_user_profiles au ON au.id = s.assignee_user_id AND au.organization_id = s.organization_id
        LEFT JOIN organization_user_profiles cu ON cu.id = s.created_by AND cu.organization_id = s.organization_id
        WHERE s.organization_id = ? AND s.task_id = ? AND s.parent_subtask_id = ?
        ORDER BY s.position ASC, s.created_at ASC, s.rowid ASC`)
          .all(organizationId, taskId, parentSubtaskId)
        : db.prepare(`SELECT s.*,
          au.username AS assignee_username, au.display_name AS assignee_display_name,
          cu.username AS created_by_username, cu.display_name AS created_by_display_name
        FROM task_subtasks s
        LEFT JOIN organization_user_profiles au ON au.id = s.assignee_user_id AND au.organization_id = s.organization_id
        LEFT JOIN organization_user_profiles cu ON cu.id = s.created_by AND cu.organization_id = s.organization_id
        WHERE s.organization_id = ? AND s.task_id = ? AND s.parent_subtask_id IS NULL
        ORDER BY s.position ASC, s.created_at ASC, s.rowid ASC`)
          .all(organizationId, taskId);
      return rows.map(taskSubtaskFromRow);
    },
    getTaskSubtask(organizationId, taskId, subtaskId) {
      return taskSubtaskFromRow(db.prepare(`SELECT s.*,
          au.username AS assignee_username, au.display_name AS assignee_display_name,
          cu.username AS created_by_username, cu.display_name AS created_by_display_name
        FROM task_subtasks s
        LEFT JOIN organization_user_profiles au ON au.id = s.assignee_user_id AND au.organization_id = s.organization_id
        LEFT JOIN organization_user_profiles cu ON cu.id = s.created_by AND cu.organization_id = s.organization_id
        WHERE s.organization_id = ? AND s.task_id = ? AND s.id = ?`)
        .get(organizationId, taskId, subtaskId));
    },
    claimTaskSubtask(organizationId, taskId, subtaskId, userId) {
      const result = db.prepare(`UPDATE task_subtasks
        SET assignee_user_id = ?, updated_at = ?
        WHERE organization_id = ? AND task_id = ? AND id = ?
          AND COALESCE(TRIM(assignee_user_id), '') = ''`)
        .run(userId, now(), organizationId, taskId, subtaskId);
      if (!result.changes) return null;
      return this.getTaskSubtask(organizationId, taskId, subtaskId);
    },
    transferTaskSubtask(organizationId, taskId, subtaskId, fromUserId, toUserId = null) {
      const result = db.prepare(`UPDATE task_subtasks
        SET assignee_user_id = ?, updated_at = ?
        WHERE organization_id = ? AND task_id = ? AND id = ?
          AND assignee_user_id = ?`)
        .run(toUserId || null, now(), organizationId, taskId, subtaskId, fromUserId);
      if (!result.changes) return null;
      return this.getTaskSubtask(organizationId, taskId, subtaskId);
    },
    createTaskSubtask({ organizationId, taskId, parentSubtaskId = null, userId, title, description = '', completed = false, status, priority = '普通', assigneeUserId = null, startAt = null, dueAt = null, position }) {
      const task = db.prepare('SELECT id FROM tasks WHERE organization_id = ? AND id = ?').get(organizationId, taskId);
      if (!task) return null;
      if (parentSubtaskId) {
        const parent = db.prepare('SELECT id FROM task_subtasks WHERE organization_id = ? AND task_id = ? AND id = ?').get(organizationId, taskId, parentSubtaskId);
        if (!parent) return null;
      }
      const createdAt = now();
      const subtaskId = id('subtask');
      const nextPosition = Number.isFinite(Number(position))
        ? Math.max(0, Math.trunc(Number(position)))
        : Number((parentSubtaskId
          ? db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM task_subtasks WHERE organization_id = ? AND task_id = ? AND parent_subtask_id = ?').get(organizationId, taskId, parentSubtaskId)
          : db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM task_subtasks WHERE organization_id = ? AND task_id = ? AND parent_subtask_id IS NULL').get(organizationId, taskId)
        ).next_position);
      const isCompleted = Boolean(completed) || SUBTASK_DONE_STATUSES.has(status);
      const normalizedStatus = status || (isCompleted ? '已完成' : '待处理');
      db.prepare(`INSERT INTO task_subtasks(
        id, organization_id, task_id, parent_subtask_id, title, description, completed, status,
        priority, assignee_user_id, start_at, due_at, position, created_by, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(subtaskId, organizationId, taskId, parentSubtaskId || null, title, description || '', isCompleted ? 1 : 0,
          normalizedStatus, priority || '普通', assigneeUserId || null, startAt || null, dueAt || null,
          nextPosition, userId || null, createdAt, createdAt);
      return this.getTaskSubtask(organizationId, taskId, subtaskId);
    },
    updateTaskSubtask(organizationId, taskId, subtaskId, changes = {}, options = {}) {
      const current = db.prepare('SELECT * FROM task_subtasks WHERE organization_id = ? AND task_id = ? AND id = ?').get(organizationId, taskId, subtaskId);
      if (!current) return null;
      const title = changes.title === undefined ? current.title : changes.title;
      const description = changes.description === undefined ? (current.description || '') : (changes.description || '');
      let completed = changes.completed === undefined ? Boolean(current.completed) : Boolean(changes.completed);
      let status = changes.status === undefined ? (current.status || (completed ? '已完成' : '待处理')) : changes.status;
      if (changes.completed !== undefined && changes.status === undefined) {
        status = completed ? '已完成' : (SUBTASK_DONE_STATUSES.has(status) ? '待处理' : status);
      }
      if (changes.completed === true && changes.status !== undefined && !SUBTASK_DONE_STATUSES.has(status)) status = '已完成';
      if (changes.status !== undefined) completed = SUBTASK_DONE_STATUSES.has(status);
      const priority = changes.priority === undefined ? (current.priority || '普通') : (changes.priority || '普通');
      const assigneeUserId = changes.assigneeUserId === undefined ? current.assignee_user_id : (changes.assigneeUserId || null);
      const startAt = changes.startAt === undefined ? current.start_at : (changes.startAt || null);
      const dueAt = changes.dueAt === undefined ? current.due_at : (changes.dueAt || null);
      const position = changes.position === undefined
        ? Number(current.position || 0)
        : Math.max(0, Math.trunc(Number(changes.position) || 0));
      const expectedAssigneeProvided = Object.hasOwn(options, 'expectedAssigneeUserId');
      const expectedAssigneeUserId = options.expectedAssigneeUserId || null;
      const update = db.prepare(`UPDATE task_subtasks SET title = ?, description = ?, completed = ?, status = ?,
           priority = ?, assignee_user_id = ?, start_at = ?, due_at = ?, position = ?, updated_at = ?
        WHERE organization_id = ? AND task_id = ? AND id = ?${expectedAssigneeProvided ? " AND COALESCE(TRIM(assignee_user_id), '') = COALESCE(TRIM(?), '')" : ''}`);
      const parameters = [title, description, completed ? 1 : 0, status || (completed ? '已完成' : '待处理'),
        priority, assigneeUserId, startAt, dueAt, position, now(), organizationId, taskId, subtaskId];
      if (expectedAssigneeProvided) parameters.push(expectedAssigneeUserId);
      const result = update.run(...parameters);
      if (expectedAssigneeProvided && !result.changes) return null;
      return this.getTaskSubtask(organizationId, taskId, subtaskId);
    },
    deleteTaskSubtask(organizationId, taskId, subtaskId) {
      const row = db.prepare('SELECT * FROM task_subtasks WHERE organization_id = ? AND task_id = ? AND id = ?').get(organizationId, taskId, subtaskId);
      if (!row) return null;
      db.prepare('DELETE FROM task_subtasks WHERE organization_id = ? AND task_id = ? AND id = ?').run(organizationId, taskId, subtaskId);
      return taskSubtaskFromRow(row);
    },
    getOrganizationStats(organizationId) {
      const activeProject = column => `NOT EXISTS (SELECT 1 FROM task_recycle_entries r WHERE r.organization_id = source.organization_id AND r.resource_type = 'project' AND r.resource_id = source.${column} AND r.restored_at IS NULL)`;
      const count = table => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} source WHERE organization_id = ? AND ${activeProject(table === 'projects' ? 'id' : 'project_id')}`).get(organizationId).count);
      const projects = count('projects'); const parts = count('parts'); const quotes = count('quotes'); const fairItems = count('fair_items');
      const rootTaskFilter = `NOT EXISTS (SELECT 1 FROM projects p WHERE p.organization_id = t.organization_id AND p.root_task_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM task_recycle_entries r WHERE r.organization_id = t.organization_id AND r.restored_at IS NULL
          AND ((r.resource_type = 'task' AND r.resource_id = t.id) OR (r.resource_type = 'project' AND r.resource_id = t.project_id)))`;
      const tasks = Number(db.prepare(`SELECT COUNT(*) AS count FROM tasks t WHERE t.organization_id = ? AND ${rootTaskFilter}`).get(organizationId).count);
      const completedTasks = Number(db.prepare(`SELECT COUNT(*) AS count FROM tasks t WHERE t.organization_id = ? AND ${rootTaskFilter} AND (t.progress >= 100 OR t.status = '已完成')`).get(organizationId).count);
      const quoteTotalCents = Number(db.prepare(`SELECT COALESCE(SUM(total_cents), 0) AS total FROM quotes source WHERE organization_id = ? AND ${activeProject('project_id')}`).get(organizationId).total);
      return { projects, parts, quotes, fairItems, tasks, completedTasks, completionRate: tasks ? Math.round(completedTasks / tasks * 1000) / 10 : 0, quoteTotalCents };
    },
    createTask({ organizationId, projectId, userId, title, description, customerProfile, customerManagement, projectList, stage, owner, assigneeUserId, progress, status, priority, startAt, dueAt }) {
      const taskStage = stage || '未分组';
      const taskStatus = canonicalTaskStatus(status, taskStage);
      const task = { id: id('task'), organizationId, projectId: projectId || null, title, description: description || '', customerProfile: customerProfile || '', customerManagement: customerManagement || '', projectList: projectList || '', stage: taskStage, owner: owner || '', assigneeUserId: assigneeUserId || null, progress: Math.max(0, Math.min(100, Number(progress) || 0)), status: taskStatus, priority: priority || '普通', startAt: startAt || null, dueAt: dueAt || null, createdAt: now() };
      db.prepare('INSERT INTO tasks(id, organization_id, project_id, title, description, customer_profile, customer_management, project_list, stage, owner_name, assignee_user_id, progress, status, priority, start_at, due_at, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(task.id, organizationId, task.projectId, task.title, task.description, task.customerProfile, task.customerManagement, task.projectList, task.stage, task.owner, task.assigneeUserId, task.progress, task.status, task.priority, task.startAt, task.dueAt, task.createdAt, task.createdAt);
      return taskFromRow(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id));
    },
    updateTask(organizationId, taskId, changes, options = {}) {
      const current = db.prepare('SELECT * FROM tasks WHERE organization_id = ? AND id = ?').get(organizationId, taskId); if (!current) return null;
      const title = changes.title === undefined ? current.title : changes.title;
      const description = changes.description === undefined ? (current.description || '') : changes.description || '';
      const customerProfile = changes.customerProfile === undefined ? (current.customer_profile || '') : changes.customerProfile || '';
      const customerManagement = changes.customerManagement === undefined ? (current.customer_management || '') : changes.customerManagement || '';
      const projectList = changes.projectList === undefined ? (current.project_list || '') : changes.projectList || '';
      const stage = changes.stage === undefined ? (current.stage || '未分组') : changes.stage || '未分组';
      // `stage` is the legacy placement field. Promote it only while reading
      // an existing row whose status was not explicitly changed; an explicit
      // compatibility status (for example `已完成`) must remain observable
      // instead of being silently overwritten by the old stage value.
      const status = changes.status === undefined
        ? canonicalTaskStatus(current.status, stage, current.status || '待处理')
        : normalizedTaskStatus(changes.status, current.status || '待处理');
      const progress = changes.progress == null
        ? (workflowProgressFromNode(status) ?? workflowProgressFromNode(stage) ?? current.progress)
        : Math.max(0, Math.min(100, Number(changes.progress) || 0));
      const priority = changes.priority || current.priority || '普通'; const startAt = changes.startAt === undefined ? current.start_at : changes.startAt || null; const dueAt = changes.dueAt === undefined ? current.due_at : changes.dueAt || null;
      const owner = changes.owner === undefined ? current.owner_name : changes.owner;
      const assigneeUserId = changes.assigneeUserId === undefined ? current.assignee_user_id : changes.assigneeUserId || null;
      const expectedAssigneeProvided = Object.hasOwn(options, 'expectedAssigneeUserId');
      const expectedAssigneeUserId = options.expectedAssigneeUserId || null;
      const update = db.prepare(`UPDATE tasks SET title = ?, description = ?, customer_profile = ?, customer_management = ?, project_list = ?, stage = ?, owner_name = ?, assignee_user_id = ?, progress = ?, status = ?, priority = ?, start_at = ?, due_at = ?, updated_at = ?
        WHERE organization_id = ? AND id = ?${expectedAssigneeProvided ? " AND COALESCE(TRIM(assignee_user_id), '') = COALESCE(TRIM(?), '')" : ''}`);
      const parameters = [title, description, customerProfile, customerManagement, projectList, stage, owner, assigneeUserId, progress, status, priority, startAt, dueAt, now(), organizationId, taskId];
      if (expectedAssigneeProvided) parameters.push(expectedAssigneeUserId);
      const result = update.run(...parameters);
      if (expectedAssigneeProvided && !result.changes) return null;
      return taskFromRow(db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId));
    },
    deleteTask(organizationId, taskId) {
      const row = db.prepare('SELECT * FROM tasks WHERE organization_id = ? AND id = ?').get(organizationId, taskId);
      if (!row) return null;
      db.prepare('DELETE FROM tasks WHERE organization_id = ? AND id = ?').run(organizationId, taskId);
      return taskFromRow(row);
    },
    syncProjectFromRootTask(organizationId, task) {
      if (!task?.id || !task.projectId) return null;
      // Re-read the root task while holding a write lock. The caller's task
      // object was produced before the update response was assembled; a
      // concurrent handoff in that gap must win instead of being copied back
      // into the project's executor pointer from a stale snapshot.
      db.exec('BEGIN IMMEDIATE');
      try {
        const project = db.prepare('SELECT * FROM projects WHERE organization_id = ? AND id = ? AND root_task_id = ?').get(organizationId, task.projectId, task.id);
        if (!project) {
          db.exec('COMMIT');
          return null;
        }
        const latestTask = db.prepare('SELECT * FROM tasks WHERE organization_id = ? AND id = ?').get(organizationId, task.id);
        if (!latestTask) {
          db.exec('COMMIT');
          return null;
        }
        const latest = taskFromRow(latestTask);
        const updatedAt = now();
        // Keep the project manager (owner_user_id/owner_name) stable. The root
        // task assignee is an independent executor and is mirrored only into
        // executor_user_id. Workflow statuses also drive the project board
        // placement; legacy four-state values remain status-only for backwards
        // compatibility.
        const nextStage = PROJECT_WORKFLOW_STAGES.includes(latest.status)
          ? latest.status
          : (project.stage || '立项沟通');
        const nextProgress = workflowProgressFromNode(latest.status) ?? latest.progress;
        db.prepare(`UPDATE projects SET title = ?, stage = ?, tag = ?, progress = ?, status = ?, description = ?, priority = ?, start_at = ?, due_at = ?, executor_user_id = ?, updated_at = ?
          WHERE organization_id = ? AND id = ?`).run(latest.title, nextStage, latest.stage || '', nextProgress, latest.status, latest.description || '', latest.priority || '普通', latest.startAt || null, latest.dueAt || null, latest.assigneeUserId || null, updatedAt, organizationId, task.projectId);
        db.exec('COMMIT');
        return projectFromRow(db.prepare('SELECT * FROM projects WHERE organization_id = ? AND id = ?').get(organizationId, task.projectId));
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      }
    },
    listTaskComments(organizationId, taskId, subtaskId = null) {
      const rows = subtaskId
        ? db.prepare(`SELECT c.*, u.username, u.display_name FROM task_comments c
          LEFT JOIN organization_user_profiles u ON u.id = c.user_id AND u.organization_id = c.organization_id
          WHERE c.organization_id = ? AND c.task_id = ? AND c.subtask_id = ?
          ORDER BY c.created_at, c.rowid`).all(organizationId, taskId, subtaskId)
        : db.prepare(`SELECT c.*, u.username, u.display_name FROM task_comments c
          LEFT JOIN organization_user_profiles u ON u.id = c.user_id AND u.organization_id = c.organization_id
          WHERE c.organization_id = ? AND c.task_id = ? AND c.subtask_id IS NULL
          ORDER BY c.created_at, c.rowid`).all(organizationId, taskId);
      return rows.map(taskCommentFromRow);
    },
    listTaskAttachments(organizationId, taskId, subtaskId = null) {
      const rows = subtaskId
        ? db.prepare(`SELECT a.*, u.username AS uploader_username, u.display_name AS uploader_display_name
        FROM task_attachments a LEFT JOIN organization_user_profiles u ON u.id = a.uploader_user_id AND u.organization_id = a.organization_id
        WHERE a.organization_id = ? AND a.task_id = ? AND a.subtask_id = ? ORDER BY a.created_at, a.rowid`)
          .all(organizationId, taskId, subtaskId)
        : db.prepare(`SELECT a.*, u.username AS uploader_username, u.display_name AS uploader_display_name
        FROM task_attachments a LEFT JOIN organization_user_profiles u ON u.id = a.uploader_user_id AND u.organization_id = a.organization_id
        WHERE a.organization_id = ? AND a.task_id = ? AND a.subtask_id IS NULL ORDER BY a.created_at, a.rowid`)
          .all(organizationId, taskId);
      return rows.map(taskAttachmentFromRow);
    },
    // Internal cleanup view. Public attachment DTOs intentionally omit the
    // storage key, but task deletion must still remove every blob belonging to
    // the task, including attachments on recursively nested subtasks.
    listTaskAttachmentStorage(organizationId, taskId, subtaskId = null) {
      if (subtaskId) {
        return db.prepare(`WITH RECURSIVE subtree(id) AS (
            SELECT id FROM task_subtasks
            WHERE organization_id = ? AND task_id = ? AND id = ?
            UNION ALL
            SELECT child.id FROM task_subtasks child
            JOIN subtree parent ON child.parent_subtask_id = parent.id
            WHERE child.organization_id = ? AND child.task_id = ?
          )
          SELECT a.id, a.storage_key
          FROM task_attachments a
          WHERE a.organization_id = ? AND a.task_id = ?
            AND a.subtask_id IN (SELECT id FROM subtree)`)
          .all(organizationId, taskId, subtaskId, organizationId, taskId, organizationId, taskId);
      }
      return db.prepare(`SELECT id, storage_key
        FROM task_attachments
        WHERE organization_id = ? AND task_id = ?`)
        .all(organizationId, taskId);
    },
    getTaskAttachmentStorage(organizationId, taskId, attachmentId, subtaskId = null) {
      const sql = `SELECT a.*, t.project_id, u.username AS uploader_username, u.display_name AS uploader_display_name
        FROM task_attachments a
        JOIN tasks t ON t.organization_id = a.organization_id AND t.id = a.task_id
        LEFT JOIN organization_user_profiles u ON u.id = a.uploader_user_id AND u.organization_id = a.organization_id
        WHERE a.organization_id = ? AND a.task_id = ? AND a.id = ? AND ${subtaskId ? 'a.subtask_id = ?' : 'a.subtask_id IS NULL'}`;
      return (subtaskId
        ? db.prepare(sql).get(organizationId, taskId, attachmentId, subtaskId)
        : db.prepare(sql).get(organizationId, taskId, attachmentId)) || null;
    },
    createTaskAttachment({ organizationId, taskId, subtaskId = null, userId, name, mimeType, sizeBytes, storageKey }) {
      const task = db.prepare('SELECT id FROM tasks WHERE organization_id = ? AND id = ?').get(organizationId, taskId);
      if (!task) return null;
      if (subtaskId && !db.prepare('SELECT id FROM task_subtasks WHERE organization_id = ? AND task_id = ? AND id = ?').get(organizationId, taskId, subtaskId)) return null;
      const attachment = { id: id('task-attachment'), organizationId, taskId, subtaskId: subtaskId || '', uploaderUserId: userId, name, mimeType: mimeType || 'application/octet-stream', sizeBytes: Number(sizeBytes) || 0, storageKey, createdAt: now() };
      db.prepare('INSERT INTO task_attachments(id, organization_id, task_id, subtask_id, uploader_user_id, name, mime_type, size_bytes, storage_key, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(attachment.id, organizationId, taskId, subtaskId || null, userId, attachment.name, attachment.mimeType, attachment.sizeBytes, storageKey, attachment.createdAt);
      return taskAttachmentFromRow(db.prepare(`SELECT a.*, u.username AS uploader_username, u.display_name AS uploader_display_name
        FROM task_attachments a LEFT JOIN organization_user_profiles u ON u.id = a.uploader_user_id AND u.organization_id = a.organization_id WHERE a.organization_id = ? AND a.id = ?`).get(organizationId, attachment.id));
    },
    deleteTaskAttachment(organizationId, taskId, attachmentId, subtaskId = null) {
      const row = subtaskId
        ? db.prepare('SELECT * FROM task_attachments WHERE organization_id = ? AND task_id = ? AND subtask_id = ? AND id = ?').get(organizationId, taskId, subtaskId, attachmentId)
        : db.prepare('SELECT * FROM task_attachments WHERE organization_id = ? AND task_id = ? AND subtask_id IS NULL AND id = ?').get(organizationId, taskId, attachmentId);
      if (!row) return null;
      if (subtaskId) db.prepare('DELETE FROM task_attachments WHERE organization_id = ? AND task_id = ? AND subtask_id = ? AND id = ?').run(organizationId, taskId, subtaskId, attachmentId);
      else db.prepare('DELETE FROM task_attachments WHERE organization_id = ? AND task_id = ? AND subtask_id IS NULL AND id = ?').run(organizationId, taskId, attachmentId);
      return row;
    },
    listProjectComments(organizationId, projectId) { return db.prepare('SELECT c.*, u.username, u.display_name FROM project_comments c LEFT JOIN organization_user_profiles u ON u.id = c.user_id AND u.organization_id = c.organization_id WHERE c.organization_id = ? AND c.project_id = ? ORDER BY c.created_at').all(organizationId, projectId).map(projectCommentFromRow); },
    createTaskComment({ organizationId, taskId, subtaskId = null, userId, body }) {
      if (subtaskId && !db.prepare('SELECT id FROM task_subtasks WHERE organization_id = ? AND task_id = ? AND id = ?').get(organizationId, taskId, subtaskId)) return null;
      const commentId = id('comment');
      const createdAt = now();
      db.prepare('INSERT INTO task_comments(id, organization_id, task_id, subtask_id, user_id, body, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)').run(commentId, organizationId, taskId, subtaskId || null, userId, body, createdAt);
      return taskCommentFromRow(db.prepare('SELECT c.*, u.username, u.display_name FROM task_comments c LEFT JOIN organization_user_profiles u ON u.id = c.user_id AND u.organization_id = c.organization_id WHERE c.id = ?').get(commentId));
    },
    createProjectComment({ organizationId, projectId, userId, body }) { const commentId = id('project-comment'); const createdAt = now(); db.prepare('INSERT INTO project_comments(id, organization_id, project_id, user_id, body, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(commentId, organizationId, projectId, userId, body, createdAt); return projectCommentFromRow(db.prepare('SELECT c.*, u.username, u.display_name FROM project_comments c LEFT JOIN organization_user_profiles u ON u.id = c.user_id AND u.organization_id = c.organization_id WHERE c.id = ?').get(commentId)); },
    listConversations(organizationId, userId, projectId = undefined) {
      const projectFilter = projectId === undefined ? '' : ' AND c.project_id = ?';
      const parameters = projectId === undefined ? [organizationId] : [organizationId, projectId];
      return db.prepare(`${conversationDetailsSql} WHERE c.organization_id = ?${projectFilter} ORDER BY COALESCE(last_message_at, c.created_at) DESC, c.created_at DESC`).all(...parameters).map(row => decorateConversationForUser(row, organizationId, userId));
    },
    createConversation({ organizationId, projectId, title }) { const conversation = { id: id('conversation'), organizationId, projectId: projectId || null, title, createdAt: now() }; db.prepare('INSERT INTO conversations(id, organization_id, project_id, title, created_at) VALUES(?, ?, ?, ?, ?)').run(conversation.id, organizationId, conversation.projectId, conversation.title, conversation.createdAt); return this.getConversation(organizationId, conversation.id); },
    getConversation(organizationId, conversationId, userId = '') { return decorateConversationForUser(db.prepare(`${conversationDetailsSql} WHERE c.organization_id = ? AND c.id = ?`).get(organizationId, conversationId), organizationId, userId); },
    updateConversationUserState(organizationId, conversationId, userId, changes = {}) {
      const current = db.prepare('SELECT * FROM conversation_user_states WHERE organization_id = ? AND conversation_id = ? AND user_id = ?').get(organizationId, conversationId, userId);
      const lastReadAt = changes.read === true ? now() : current?.last_read_at || null;
      const lastReadMessageRowId = changes.read === true
        ? db.prepare('SELECT COALESCE(MAX(rowid), 0) AS rowid FROM messages WHERE organization_id = ? AND conversation_id = ?').get(organizationId, conversationId).rowid
        : current?.last_read_message_rowid ?? null;
      const savedForLater = Object.hasOwn(changes, 'savedForLater') ? (changes.savedForLater ? 1 : 0) : Number(current?.saved_for_later || 0);
      const updatedAt = now();
      db.prepare(`INSERT INTO conversation_user_states(organization_id, conversation_id, user_id, last_read_at, last_read_message_rowid, saved_for_later, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(conversation_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at, last_read_message_rowid = excluded.last_read_message_rowid, saved_for_later = excluded.saved_for_later, updated_at = excluded.updated_at`).run(organizationId, conversationId, userId, lastReadAt, lastReadMessageRowId, savedForLater, updatedAt);
      return { conversationId, lastReadAt, savedForLater: Boolean(savedForLater), updatedAt };
    },
    listMessages(organizationId, conversationId) {
      const rows = db.prepare('SELECT m.*, u.username, u.display_name FROM messages m LEFT JOIN organization_user_profiles u ON u.id = m.user_id AND u.organization_id = m.organization_id WHERE m.organization_id = ? AND m.conversation_id = ? ORDER BY m.created_at, m.rowid').all(organizationId, conversationId);
      return messagesFromRows(rows, organizationId);
    },
    createMessage({ organizationId, conversationId, userId, body, attachmentIds = [] }) {
      const targetConversation = db.prepare('SELECT project_id FROM conversations WHERE organization_id = ? AND id = ?').get(organizationId, conversationId);
      if (!targetConversation) return null;
      const uniqueAttachmentIds = [...new Set(attachmentIds)];
      const allowsUnboundAttachments = targetConversation.project_id ? 0 : 1;
      if (uniqueAttachmentIds.length) {
        const placeholders = uniqueAttachmentIds.map(() => '?').join(',');
        const available = db.prepare(`SELECT id FROM chat_attachments
          WHERE organization_id = ? AND uploader_user_id = ? AND message_id IS NULL
            AND (pending_conversation_id = ? OR (? = 1 AND pending_conversation_id IS NULL))
            AND id IN (${placeholders})`).all(organizationId, userId, conversationId, allowsUnboundAttachments, ...uniqueAttachmentIds);
        if (available.length !== uniqueAttachmentIds.length) return null;
      }
      const message = { id: id('message'), organizationId, conversationId, userId, body, createdAt: now() };
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO messages(id, organization_id, conversation_id, user_id, body, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(message.id, organizationId, conversationId, userId, body, message.createdAt);
        const attach = db.prepare(`UPDATE chat_attachments
          SET message_id = ?, pending_conversation_id = NULL
          WHERE organization_id = ? AND uploader_user_id = ? AND message_id IS NULL AND id = ?
            AND (pending_conversation_id = ? OR (? = 1 AND pending_conversation_id IS NULL))`);
        for (const attachmentId of uniqueAttachmentIds) {
          if (!attach.run(message.id, organizationId, userId, attachmentId, conversationId, allowsUnboundAttachments).changes) throw new Error('chat_attachment_unavailable');
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      const row = db.prepare('SELECT m.*, u.username, u.display_name FROM messages m LEFT JOIN organization_user_profiles u ON u.id = m.user_id AND u.organization_id = m.organization_id WHERE m.id = ?').get(message.id);
      return messagesFromRows([row], organizationId)[0];
    },
    createChatAttachment({ organizationId, userId, name, mimeType, sizeBytes, storageKey, pendingConversationId = null }) {
      if (pendingConversationId && !db.prepare('SELECT 1 FROM conversations WHERE organization_id = ? AND id = ?').get(organizationId, pendingConversationId)) return null;
      const attachmentId = id('attachment'); const createdAt = now();
      db.prepare('INSERT INTO chat_attachments(id, organization_id, message_id, pending_conversation_id, uploader_user_id, name, mime_type, size_bytes, storage_key, created_at) VALUES(?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)').run(attachmentId, organizationId, pendingConversationId || null, userId, name, mimeType, sizeBytes, storageKey, createdAt);
      return attachmentFromRow(db.prepare('SELECT * FROM chat_attachments WHERE id = ?').get(attachmentId));
    },
    getChatAttachmentStorage(organizationId, attachmentId) {
      return db.prepare(`SELECT a.*, COALESCE(sent_conversation.project_id, pending_conversation.project_id) AS project_id
        FROM chat_attachments a
        LEFT JOIN messages m ON m.organization_id = a.organization_id AND m.id = a.message_id
        LEFT JOIN conversations sent_conversation ON sent_conversation.organization_id = m.organization_id AND sent_conversation.id = m.conversation_id
        LEFT JOIN conversations pending_conversation ON pending_conversation.organization_id = a.organization_id AND pending_conversation.id = a.pending_conversation_id
        WHERE a.organization_id = ? AND a.id = ?`).get(organizationId, attachmentId) || null;
    },
    getPendingChatAttachmentStorage(organizationId, userId, attachmentId) {
      return db.prepare('SELECT * FROM chat_attachments WHERE organization_id = ? AND uploader_user_id = ? AND id = ? AND message_id IS NULL').get(organizationId, userId, attachmentId) || null;
    },
    deletePendingChatAttachment(organizationId, userId, attachmentId) {
      const row = db.prepare('SELECT * FROM chat_attachments WHERE organization_id = ? AND uploader_user_id = ? AND id = ? AND message_id IS NULL').get(organizationId, userId, attachmentId);
      if (!row) return null;
      db.prepare('DELETE FROM chat_attachments WHERE id = ?').run(attachmentId);
      return row;
    },
    listParts(organizationId, projectId) { return db.prepare('SELECT p.*, pr.title AS project_title, pr.tag AS project_order FROM parts p JOIN projects pr ON pr.id = p.project_id WHERE p.organization_id = ? AND p.project_id = ? ORDER BY p.created_at DESC').all(organizationId, projectId).map(partFromRow); },
    listAllParts(organizationId) { return db.prepare('SELECT p.*, pr.title AS project_title, pr.tag AS project_order FROM parts p JOIN projects pr ON pr.id = p.project_id WHERE p.organization_id = ? ORDER BY p.created_at DESC').all(organizationId).map(partFromRow); },
    getPart(organizationId, partId) { return partFromRow(db.prepare('SELECT p.*, pr.title AS project_title, pr.tag AS project_order FROM parts p JOIN projects pr ON pr.id = p.project_id WHERE p.organization_id = ? AND p.id = ?').get(organizationId, partId)); },
    createPart({ organizationId, projectId, name, format, material, finish, dimensions, volume, quantity }) {
      const part = { id: id('part'), organizationId, projectId, name, format: format || 'STEP', material: material || '', finish: finish || '', dimensions: dimensions || '', volume: volume || '', quantity: Math.max(1, Number(quantity) || 1), uploaded: now() };
      db.prepare('INSERT INTO parts(id, organization_id, project_id, name, format, material, finish, dimensions, volume, quantity, uploaded_at, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(part.id, organizationId, projectId, part.name, part.format, part.material, part.finish, part.dimensions, part.volume, part.quantity, part.uploaded, part.uploaded);
      return partFromRow(db.prepare('SELECT p.*, pr.title AS project_title, pr.tag AS project_order FROM parts p JOIN projects pr ON pr.id = p.project_id WHERE p.id = ?').get(part.id));
    },
    updatePart(organizationId, partId, changes) {
      const current = db.prepare('SELECT * FROM parts WHERE organization_id = ? AND id = ?').get(organizationId, partId);
      if (!current) return null;
      const values = { projectId: changes.projectId ?? current.project_id, name: changes.name ?? current.name, format: changes.format ?? current.format, material: changes.material ?? current.material, finish: changes.finish ?? current.finish, dimensions: changes.dimensions ?? current.dimensions, volume: changes.volume ?? current.volume, quantity: changes.quantity == null ? current.quantity : Math.max(1, Number(changes.quantity) || 1) };
      db.prepare('UPDATE parts SET project_id = ?, name = ?, format = ?, material = ?, finish = ?, dimensions = ?, volume = ?, quantity = ? WHERE organization_id = ? AND id = ?').run(values.projectId, values.name, values.format, values.material, values.finish, values.dimensions, values.volume, values.quantity, organizationId, partId);
      return partFromRow(db.prepare('SELECT p.*, pr.title AS project_title, pr.tag AS project_order FROM parts p JOIN projects pr ON pr.id = p.project_id WHERE p.id = ?').get(partId));
    },
    listMembers(organizationId) { return db.prepare("SELECT m.role, m.department_id, m.job_title, d.name AS department_name, u.id, u.username, COALESCE(NULLIF(m.display_name_override, ''), u.display_name) AS display_name, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN organization_departments d ON d.id = m.department_id AND d.organization_id = m.organization_id WHERE m.organization_id = ? ORDER BY m.created_at").all(organizationId).map(row => ({ id: row.id, username: row.username, displayName: row.display_name, role: row.role, departmentId: row.department_id || null, departmentName: row.department_name || '', jobTitle: row.job_title || '', createdAt: row.created_at })); },
    createMember({ organizationId, username, displayName, password, role }) {
      const createdAt = now();
      const user = { id: id('user'), username, displayName, passwordHash: hashPassword(password) };
      db.prepare('INSERT INTO users(id, username, password_hash, display_name, created_at) VALUES(?, ?, ?, ?, ?)').run(user.id, user.username, user.passwordHash, user.displayName, createdAt);
      db.prepare('INSERT INTO memberships(id, organization_id, user_id, role, created_at) VALUES(?, ?, ?, ?, ?)').run(id('membership'), organizationId, user.id, role, createdAt);
      return { id: user.id, username, displayName, role, createdAt };
    },
    updateMemberRole(organizationId, userId, role) {
      db.prepare('UPDATE memberships SET role = ? WHERE organization_id = ? AND user_id = ?').run(role, organizationId, userId);
      return db.prepare('SELECT m.role, u.id, u.username, u.display_name, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? AND m.user_id = ?').get(organizationId, userId);
    },
    countOwners(organizationId) { return Number(db.prepare("SELECT COUNT(*) AS count FROM memberships WHERE organization_id = ? AND role = 'owner'").get(organizationId).count); },
    listQuotes(organizationId, projectId) {
      return db.prepare('SELECT * FROM quotes WHERE organization_id = ? AND project_id = ? ORDER BY updated_at DESC').all(organizationId, projectId).map(row => quoteFromRow(row, db.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY created_at').all(row.id).map(quoteLineFromRow)));
    },
    getQuote(organizationId, projectId, quoteId) {
      const row = db.prepare('SELECT * FROM quotes WHERE organization_id = ? AND project_id = ? AND id = ?').get(organizationId, projectId, quoteId);
      return quoteFromRow(row, row ? db.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY created_at').all(row.id).map(quoteLineFromRow) : []);
    },
    createQuote({ organizationId, projectId, userId, quoteNo, currency, lines }) {
      const createdAt = now();
      const quoteId = id('quote');
      const normalizedLines = (Array.isArray(lines) ? lines : []).map(line => { const quantity = Math.max(1, Math.round(Number(line.quantity) || 1)); const unitPriceCents = Math.max(0, Math.round(Number(line.unitPriceCents) || 0)); return { id: id('quote_line'), name: String(line.name || '未命名零件').trim().slice(0, 160), partId: line.partId || null, material: String(line.material || '').trim().slice(0, 80), process: String(line.process || '').trim().slice(0, 80), quantity, unitPriceCents, subtotalCents: quantity * unitPriceCents }; });
      const totalCents = normalizedLines.reduce((sum, line) => sum + line.subtotalCents, 0);
      db.prepare('INSERT INTO quotes(id, organization_id, project_id, quote_no, status, total_cents, currency, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)').run(quoteId, organizationId, projectId, String(quoteNo || `QT-${Date.now()}`).trim().slice(0, 80), 'draft', totalCents, String(currency || 'CNY').slice(0, 8), createdAt, createdAt);
      const insertLine = db.prepare('INSERT INTO quote_lines(id, organization_id, quote_id, part_id, name, material, process, quantity, unit_price_cents, subtotal_cents, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const line of normalizedLines) insertLine.run(line.id, organizationId, quoteId, line.partId, line.name, line.material, line.process, line.quantity, line.unitPriceCents, line.subtotalCents, createdAt);
      return quoteFromRow(db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId), normalizedLines.map(line => ({ ...line, quote_id: quoteId })));
    },
    updateQuote({ organizationId, projectId, quoteId, quoteNo, currency, lines }) {
      const existing = db.prepare('SELECT * FROM quotes WHERE organization_id = ? AND project_id = ? AND id = ?').get(organizationId, projectId, quoteId);
      if (!existing) return null;
      const createdAt = now(); const normalizedLines = (Array.isArray(lines) ? lines : []).map(line => { const quantity = Math.max(1, Math.round(Number(line.quantity) || 1)); const unitPriceCents = Math.max(0, Math.round(Number(line.unitPriceCents) || 0)); return { id: id('quote_line'), name: String(line.name || '未命名零件').trim().slice(0, 160), partId: line.partId || null, material: String(line.material || '').trim().slice(0, 80), process: String(line.process || '').trim().slice(0, 80), quantity, unitPriceCents, subtotalCents: quantity * unitPriceCents }; });
      const totalCents = normalizedLines.reduce((sum, line) => sum + line.subtotalCents, 0);
      db.prepare('UPDATE quotes SET quote_no = ?, currency = ?, total_cents = ?, updated_at = ? WHERE organization_id = ? AND project_id = ? AND id = ?').run(String(quoteNo || existing.quote_no).trim().slice(0, 80), String(currency || existing.currency).slice(0, 8), totalCents, createdAt, organizationId, projectId, quoteId);
      db.prepare('DELETE FROM quote_lines WHERE organization_id = ? AND quote_id = ?').run(organizationId, quoteId);
      const insertLine = db.prepare('INSERT INTO quote_lines(id, organization_id, quote_id, part_id, name, material, process, quantity, unit_price_cents, subtotal_cents, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const line of normalizedLines) insertLine.run(line.id, organizationId, quoteId, line.partId, line.name, line.material, line.process, line.quantity, line.unitPriceCents, line.subtotalCents, createdAt);
      return quoteFromRow(db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId), normalizedLines.map(line => ({ ...line, quote_id: quoteId })));
    },
    listFairItems(organizationId, projectId) { return db.prepare('SELECT * FROM fair_items WHERE organization_id = ? AND project_id = ? ORDER BY created_at DESC').all(organizationId, projectId).map(fairFromRow); },
    createFairItem({ organizationId, projectId, partId, characteristic, nominal, tolerance, status }) {
      const item = { id: id('fair'), organizationId, projectId, partId: partId || null, characteristic: String(characteristic || '').trim().slice(0, 160), nominal: String(nominal || '').trim().slice(0, 80), tolerance: String(tolerance || '').trim().slice(0, 80), status: String(status || 'pending').slice(0, 30), createdAt: now() };
      db.prepare('INSERT INTO fair_items(id, organization_id, project_id, part_id, characteristic, nominal, tolerance, status, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)').run(item.id, organizationId, projectId, item.partId, item.characteristic, item.nominal, item.tolerance, item.status, item.createdAt);
      return fairFromRow(db.prepare('SELECT * FROM fair_items WHERE id = ?').get(item.id));
    },
    updateFairItem(organizationId, projectId, itemId, changes) {
      const current = db.prepare('SELECT * FROM fair_items WHERE organization_id = ? AND project_id = ? AND id = ?').get(organizationId, projectId, itemId);
      if (!current) return null;
      const characteristic = changes.characteristic ?? current.characteristic; const nominal = changes.nominal ?? current.nominal; const tolerance = changes.tolerance ?? current.tolerance; const status = changes.status ?? current.status;
      db.prepare('UPDATE fair_items SET characteristic = ?, nominal = ?, tolerance = ?, status = ? WHERE organization_id = ? AND project_id = ? AND id = ?').run(characteristic, nominal, tolerance, status, organizationId, projectId, itemId);
      return fairFromRow(db.prepare('SELECT * FROM fair_items WHERE id = ?').get(itemId));
    },
    addAudit({ organizationId, userId, action, entityType, entityId = '', metadata = {} }) {
      db.prepare('INSERT INTO audit_events(id, organization_id, user_id, action, entity_type, entity_id, metadata_json, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)').run(id('audit'), organizationId, userId || null, action, entityType, entityId, JSON.stringify(metadata), now());
    },
    listAudit(organizationId) { return db.prepare('SELECT a.*, u.username, u.display_name FROM audit_events a LEFT JOIN users u ON u.id = a.user_id WHERE a.organization_id = ? ORDER BY a.created_at DESC LIMIT 100').all(organizationId).map(row => ({ id: row.id, organizationId: row.organization_id, username: row.username || '', displayName: row.display_name || row.username || '', action: row.action, entityType: row.entity_type, entityId: row.entity_id, metadata: JSON.parse(row.metadata_json || '{}'), createdAt: row.created_at })); }
    ,listPlatformAudit() { return db.prepare('SELECT a.*, u.username, u.display_name, o.name AS organization_name FROM audit_events a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN organizations o ON o.id = a.organization_id ORDER BY a.created_at DESC LIMIT 200').all().map(row => ({ id: row.id, organizationId: row.organization_id, organizationName: row.organization_name || '', username: row.username || '', displayName: row.display_name || row.username || '', action: row.action, entityType: row.entity_type, entityId: row.entity_id, metadata: JSON.parse(row.metadata_json || '{}'), createdAt: row.created_at })); }
  };
  instrumentOrganizationAccess(api, db);
  instrumentOrganizationAssignments(api, db);
  instrumentPlatformAccess(api, db);
  instrumentTaskHistory(api, db, PROJECT_WORKFLOW_STAGES);
  instrumentTaskRecycle(api, db);
  instrumentProjectLists(api, db);
  instrumentProjectLinks(api, db);
  return instrumentAutomations(api, db);
}

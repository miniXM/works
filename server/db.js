import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

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
  tag TEXT NOT NULL DEFAULT '',
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  step TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
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
CREATE TABLE IF NOT EXISTS task_subtasks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_comments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  body TEXT NOT NULL,
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

function projectFromRow(row) {
  if (!row) return null;
  return { id: row.id, organizationId: row.organization_id, title: row.title, stage: row.stage, owner: row.owner_name, tag: row.tag, progress: row.progress, step: row.step, status: row.status, description: row.description || '', priority: row.priority || '普通', startAt: row.start_at || null, dueAt: row.due_at || null, createdAt: row.created_at, updatedAt: row.updated_at };
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
  return { id: row.id, organizationId: row.organization_id, projectId: row.project_id, title: row.title, description: row.description || '', stage: row.stage || '未分组', owner: row.owner_name, assigneeUserId: row.assignee_user_id || '', progress: row.progress, status: row.status, priority: row.priority || '普通', startAt: row.start_at || '', dueAt: row.due_at || '', createdAt: row.created_at, updatedAt: row.updated_at || row.created_at };
}

function taskSubtaskFromRow(row) { return row ? { id: row.id, taskId: row.task_id, title: row.title, completed: Boolean(row.completed), createdAt: row.created_at, updatedAt: row.updated_at } : null; }
function taskCommentFromRow(row) { return row ? { id: row.id, taskId: row.task_id, userId: row.user_id || '', username: row.username || '', displayName: row.display_name || row.username || '', body: row.body, createdAt: row.created_at } : null; }
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
function attachmentFromRow(row) { return row ? { id: row.id, messageId: row.message_id || '', name: row.name, mimeType: row.mime_type || 'application/octet-stream', sizeBytes: Number(row.size_bytes || 0), createdAt: row.created_at } : null; }
function messageFromRow(row, attachments = []) { return row ? { id: row.id, organizationId: row.organization_id, conversationId: row.conversation_id, userId: row.user_id, username: row.username || '', displayName: row.display_name || row.username || '', body: row.body, attachments, createdAt: row.created_at } : null; }

const conversationDetailsSql = `SELECT c.*, p.title AS project_title,
  (SELECT CASE WHEN TRIM(lm.body) != '' THEN lm.body ELSE COALESCE((SELECT '[附件] ' || a.name FROM chat_attachments a WHERE a.organization_id = c.organization_id AND a.message_id = lm.id ORDER BY a.created_at, a.rowid LIMIT 1), '') END FROM messages lm WHERE lm.organization_id = c.organization_id AND lm.conversation_id = c.id ORDER BY lm.created_at DESC, lm.rowid DESC LIMIT 1) AS preview,
  (SELECT COALESCE(u.display_name, u.username, '') FROM messages lm LEFT JOIN users u ON u.id = lm.user_id WHERE lm.organization_id = c.organization_id AND lm.conversation_id = c.id ORDER BY lm.created_at DESC, lm.rowid DESC LIMIT 1) AS last_sender,
  (SELECT lm.created_at FROM messages lm WHERE lm.organization_id = c.organization_id AND lm.conversation_id = c.id ORDER BY lm.created_at DESC, lm.rowid DESC LIMIT 1) AS last_message_at,
  (SELECT COUNT(*) FROM messages lm WHERE lm.organization_id = c.organization_id AND lm.conversation_id = c.id) AS message_count
  FROM conversations c LEFT JOIN projects p ON p.organization_id = c.organization_id AND p.id = c.project_id`;

async function seed(db) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM organizations').get().count;
  if (Number(count) > 0) {
    const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
    if (admin) db.prepare('INSERT OR IGNORE INTO platform_admins(user_id, created_at) VALUES(?, ?)').run(admin.id, now());
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

export async function createDatabase({ dbPath }) {
  await mkdir(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(schema);
  try { db.exec('ALTER TABLE office_documents ADD COLUMN deleted_at TEXT'); } catch {}
  try { db.exec('ALTER TABLE office_documents ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL'); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT '普通'"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec('ALTER TABLE tasks ADD COLUMN start_at TEXT'); } catch {}
  try { db.exec('ALTER TABLE tasks ADD COLUMN due_at TEXT'); } catch {}
  try { db.exec('ALTER TABLE tasks ADD COLUMN updated_at TEXT'); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN priority TEXT NOT NULL DEFAULT '普通'"); } catch {}
  try { db.exec('ALTER TABLE projects ADD COLUMN start_at TEXT'); } catch {}
  try { db.exec('ALTER TABLE projects ADD COLUMN due_at TEXT'); } catch {}
  try { db.exec('ALTER TABLE conversation_user_states ADD COLUMN last_read_message_rowid INTEGER'); } catch {}
  db.exec('UPDATE tasks SET updated_at = COALESCE(updated_at, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_office_documents_project ON office_documents(organization_id, project_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(organization_id, user_id, project_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(organization_id, project_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_task_subtasks_task ON task_subtasks(organization_id, task_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(organization_id, task_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversation_user_states_user ON conversation_user_states(organization_id, user_id, saved_for_later)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_chat_attachments_message ON chat_attachments(organization_id, message_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(organization_id, conversation_id, created_at)');
  db.prepare(`INSERT OR IGNORE INTO project_members(organization_id, project_id, user_id, project_role, created_by, created_at)
    SELECT organization_id, id, COALESCE(owner_user_id, created_by), 'owner', created_by, created_at
    FROM projects WHERE COALESCE(owner_user_id, created_by) IS NOT NULL`).run();
  await seed(db);
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
    const user = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(userId);
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
  return {
    close: () => db.close(),
    authenticate(username, password) {
      const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!row || !verifyPassword(password, row.password_hash)) return null;
      const membership = db.prepare('SELECT * FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1').get(row.id);
      if (!membership) return null;
      const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(membership.organization_id);
      return { user: userFromRow(row), organization: organizationFromRow(org), role: membership.role };
    },
    createSession(userId, organizationId) {
      const token = randomBytes(32).toString('hex');
      const createdAt = now();
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
      db.prepare('INSERT INTO sessions(token, user_id, organization_id, created_at, expires_at) VALUES(?, ?, ?, ?, ?)').run(token, userId, organizationId, createdAt, expiresAt);
      return { token, expiresAt };
    },
    getSession(token) {
      const row = db.prepare('SELECT s.*, u.username, u.display_name, o.slug, o.name AS organization_name, m.role FROM sessions s JOIN users u ON u.id = s.user_id JOIN organizations o ON o.id = s.organization_id JOIN memberships m ON m.user_id = s.user_id AND m.organization_id = s.organization_id WHERE s.token = ? AND s.expires_at > ?').get(token, now());
      if (!row) return null;
      return { token: row.token, userId: row.user_id, organizationId: row.organization_id, user: { id: row.user_id, username: row.username, displayName: row.display_name }, organization: { id: row.organization_id, slug: row.slug, name: row.organization_name }, role: row.role, expiresAt: row.expires_at };
    },
    getMembership(userId, organizationId) { return db.prepare('SELECT * FROM memberships WHERE user_id = ? AND organization_id = ?').get(userId, organizationId); },
    isPlatformAdmin(userId) { return Boolean(db.prepare('SELECT 1 FROM platform_admins WHERE user_id = ?').get(userId)); },
    deleteSession(token) { db.prepare('DELETE FROM sessions WHERE token = ?').run(token); },
    listOfficeDocuments(organizationId, userId, projectId = undefined) {
      const projectFilter = projectId === undefined ? '' : ' AND d.project_id = ?';
      const parameters = [userId, userId, organizationId, userId];
      if (projectId !== undefined) parameters.push(projectId);
      return db.prepare(`SELECT d.*,u.display_name AS owner_name,CASE WHEN d.owner_user_id=? THEN 'edit' ELSE COALESCE(p.permission,CASE WHEN d.scope='organization' THEN 'view' END) END AS permission FROM office_documents d JOIN users u ON u.id=d.owner_user_id LEFT JOIN office_document_permissions p ON p.document_id=d.id AND p.user_id=? WHERE d.organization_id=? AND d.deleted_at IS NULL AND (d.owner_user_id=? OR d.scope='organization' OR p.user_id IS NOT NULL)${projectFilter} ORDER BY d.updated_at DESC`).all(...parameters).map(row=>({id:row.id,projectId:row.project_id||null,title:row.title,fileType:row.file_type,sizeBytes:row.size_bytes,version:row.version,scope:row.owner_user_id===userId?'mine':row.scope,owner:row.owner_name,permission:row.permission,updatedAt:row.updated_at}));
    },
    getOfficeDocument(organizationId, userId, documentId) { return this.listOfficeDocuments(organizationId,userId).find(item=>item.id===documentId)||null; },
    createOfficeDocument({organizationId,projectId=null,userId,title,storageKey,sizeBytes=0,scope='private',fileType='xlsx'}) { const createdAt=now(),documentId=id('document'); db.prepare('INSERT INTO office_documents(id,organization_id,project_id,owner_user_id,title,file_type,storage_key,size_bytes,scope,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(documentId,organizationId,projectId,userId,title,fileType,storageKey,sizeBytes,scope,createdAt,createdAt); return this.getOfficeDocument(organizationId,userId,documentId); },
    getOfficeDocumentStorage(organizationId, documentId) { return db.prepare('SELECT * FROM office_documents WHERE organization_id=? AND id=?').get(organizationId,documentId)||null; },
    touchOfficeDocument(documentId,sizeBytes) { db.prepare('UPDATE office_documents SET size_bytes=?,version=version+1,updated_at=? WHERE id=?').run(sizeBytes,now(),documentId); },
    renameOfficeDocument(organizationId,userId,documentId,title) { const result=db.prepare('UPDATE office_documents SET title=?,updated_at=? WHERE id=? AND organization_id=? AND owner_user_id=? AND deleted_at IS NULL').run(title,now(),documentId,organizationId,userId); return result.changes?this.getOfficeDocument(organizationId,userId,documentId):null; },
    trashOfficeDocument(organizationId,userId,documentId) { return db.prepare('UPDATE office_documents SET deleted_at=?,updated_at=? WHERE id=? AND organization_id=? AND owner_user_id=? AND deleted_at IS NULL').run(now(),now(),documentId,organizationId,userId).changes>0; },
    listTrashedOfficeDocuments(organizationId,userId) { return db.prepare('SELECT d.*,u.display_name owner_name FROM office_documents d JOIN users u ON u.id=d.owner_user_id WHERE d.organization_id=? AND d.owner_user_id=? AND d.deleted_at IS NOT NULL ORDER BY d.deleted_at DESC').all(organizationId,userId).map(row=>({id:row.id,projectId:row.project_id||null,title:row.title,fileType:row.file_type,sizeBytes:row.size_bytes,version:row.version,scope:'trash',owner:row.owner_name,permission:'edit',updatedAt:row.updated_at,deletedAt:row.deleted_at})); },
    restoreOfficeDocument(organizationId,userId,documentId) { return db.prepare('UPDATE office_documents SET deleted_at=NULL,updated_at=? WHERE id=? AND organization_id=? AND owner_user_id=? AND deleted_at IS NOT NULL').run(now(),documentId,organizationId,userId).changes>0; },
    deleteOfficeDocument(organizationId,userId,documentId) { const row=db.prepare('SELECT * FROM office_documents WHERE id=? AND organization_id=? AND owner_user_id=? AND deleted_at IS NOT NULL').get(documentId,organizationId,userId); if(!row)return null; db.prepare('DELETE FROM office_documents WHERE id=?').run(documentId); return row; },
    listOrganizations() {
      return db.prepare(`SELECT o.*, COUNT(DISTINCT m.user_id) AS member_count, COUNT(DISTINCT p.id) AS project_count
        FROM organizations o
        LEFT JOIN memberships m ON m.organization_id = o.id
        LEFT JOIN projects p ON p.organization_id = o.id
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
      return db.prepare('SELECT module_key, enabled FROM organization_modules WHERE organization_id = ? ORDER BY module_key').all(organizationId).reduce((result, row) => ({ ...result, [row.module_key]: Boolean(row.enabled) }), {});
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
    isProjectMember(organizationId, projectId, userId) {
      return Boolean(db.prepare('SELECT 1 FROM project_members WHERE organization_id = ? AND project_id = ? AND user_id = ?').get(organizationId, projectId, userId));
    },
    listProjectMembers(organizationId, projectId) {
      return db.prepare(`SELECT pm.project_role, pm.created_at, u.id, u.username, u.display_name
        FROM project_members pm JOIN users u ON u.id = pm.user_id
        WHERE pm.organization_id = ? AND pm.project_id = ? ORDER BY pm.created_at`)
        .all(organizationId, projectId)
        .map(row => ({ id: row.id, username: row.username, displayName: row.display_name, projectRole: row.project_role, createdAt: row.created_at }));
    },
    addProjectMember({ organizationId, projectId, userId, projectRole = 'member', createdBy }) {
      const createdAt = now();
      db.prepare(`INSERT INTO project_members(organization_id, project_id, user_id, project_role, created_by, created_at)
        VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, user_id) DO UPDATE SET project_role = excluded.project_role`)
        .run(organizationId, projectId, userId, projectRole, createdBy || null, createdAt);
      return db.prepare(`SELECT pm.project_role, pm.created_at, u.id, u.username, u.display_name
        FROM project_members pm JOIN users u ON u.id = pm.user_id
        WHERE pm.organization_id = ? AND pm.project_id = ? AND pm.user_id = ?`).get(organizationId, projectId, userId);
    },
    updateProject(organizationId, projectId, changes) {
      const current = db.prepare('SELECT * FROM projects WHERE organization_id = ? AND id = ?').get(organizationId, projectId);
      if (!current) return null;
      const title = changes.title ?? current.title; const stage = changes.stage ?? current.stage; const tag = changes.tag ?? current.tag; const owner = changes.owner ?? current.owner_name; const progress = changes.progress == null ? current.progress : Math.max(0, Math.min(100, Number(changes.progress) || 0)); const step = changes.step ?? current.step; const description = changes.description === undefined ? (current.description || '') : changes.description || ''; const priority = changes.priority || current.priority || '普通'; const startAt = changes.startAt === undefined ? current.start_at : changes.startAt || null; const dueAt = changes.dueAt === undefined ? current.due_at : changes.dueAt || null; const updatedAt = now();
      db.prepare('UPDATE projects SET title = ?, stage = ?, tag = ?, owner_name = ?, progress = ?, step = ?, description = ?, priority = ?, start_at = ?, due_at = ?, updated_at = ? WHERE organization_id = ? AND id = ?').run(title, stage, tag, owner, progress, step, description, priority, startAt, dueAt, updatedAt, organizationId, projectId);
      return projectFromRow(db.prepare('SELECT * FROM projects WHERE organization_id = ? AND id = ?').get(organizationId, projectId));
    },
    createProject({ organizationId, userId, title, stage, owner, tag, progress, step }) {
      const project = { id: id('project'), organizationId, title, stage: stage || '立项沟通', owner: owner || 'admin', tag: tag || '', progress: Number(progress) || 0, step: step || '0/1', status: 'active', createdAt: now() };
      db.prepare('INSERT INTO projects(id, organization_id, title, stage, owner_name, owner_user_id, tag, progress, step, status, created_by, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(project.id, organizationId, project.title, project.stage, project.owner, userId, project.tag, project.progress, project.step, project.status, userId, project.createdAt, project.createdAt);
      db.prepare('INSERT INTO project_members(organization_id, project_id, user_id, project_role, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(organizationId, project.id, userId, 'owner', userId, project.createdAt);
      return projectFromRow(db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id));
    },
    listTasks(organizationId, userId) {
      return db.prepare("SELECT t.* FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.organization_id = ? AND t.id NOT LIKE 'task-%' AND (t.assignee_user_id = ? OR t.assignee_user_id IS NULL) ORDER BY t.created_at DESC").all(organizationId, userId).map(taskFromRow);
    },
    listProjectTasks(organizationId, projectId) {
      return db.prepare("SELECT * FROM tasks WHERE organization_id = ? AND project_id = ? AND id NOT LIKE 'task-%' ORDER BY CASE status WHEN '阻塞' THEN 0 WHEN '进行中' THEN 1 WHEN '待处理' THEN 2 ELSE 3 END, updated_at DESC, created_at DESC").all(organizationId, projectId).map(taskFromRow);
    },
    getTask(organizationId, taskId) { return taskFromRow(db.prepare('SELECT * FROM tasks WHERE organization_id = ? AND id = ?').get(organizationId, taskId)); },
    getOrganizationStats(organizationId) {
      const count = table => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE organization_id = ?`).get(organizationId).count);
      const projects = count('projects'); const parts = count('parts'); const quotes = count('quotes'); const fairItems = count('fair_items'); const tasks = Number(db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE organization_id = ? AND id NOT LIKE 'task-%'").get(organizationId).count);
      const completedTasks = Number(db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE organization_id = ? AND id NOT LIKE 'task-%' AND (progress >= 100 OR status = '已完成')").get(organizationId).count);
      const quoteTotalCents = Number(db.prepare('SELECT COALESCE(SUM(total_cents), 0) AS total FROM quotes WHERE organization_id = ?').get(organizationId).total);
      return { projects, parts, quotes, fairItems, tasks, completedTasks, completionRate: tasks ? Math.round(completedTasks / tasks * 1000) / 10 : 0, quoteTotalCents };
    },
    createTask({ organizationId, projectId, userId, title, description, stage, owner, assigneeUserId, progress, status, priority, startAt, dueAt }) {
      const task = { id: id('task'), organizationId, projectId: projectId || null, title, description: description || '', stage: stage || '未分组', owner: owner || 'admin', assigneeUserId: assigneeUserId || userId, progress: Math.max(0, Math.min(100, Number(progress) || 0)), status: status || '待处理', priority: priority || '普通', startAt: startAt || null, dueAt: dueAt || null, createdAt: now() };
      db.prepare('INSERT INTO tasks(id, organization_id, project_id, title, description, stage, owner_name, assignee_user_id, progress, status, priority, start_at, due_at, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(task.id, organizationId, task.projectId, task.title, task.description, task.stage, task.owner, task.assigneeUserId, task.progress, task.status, task.priority, task.startAt, task.dueAt, task.createdAt, task.createdAt);
      return taskFromRow(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id));
    },
    updateTask(organizationId, taskId, changes) {
      const current = db.prepare('SELECT * FROM tasks WHERE organization_id = ? AND id = ?').get(organizationId, taskId); if (!current) return null;
      const title = changes.title === undefined ? current.title : changes.title;
      const description = changes.description === undefined ? (current.description || '') : changes.description || '';
      const stage = changes.stage === undefined ? (current.stage || '未分组') : changes.stage || '未分组';
      const progress = changes.progress == null ? current.progress : Math.max(0, Math.min(100, Number(changes.progress) || 0)); const status = changes.status || current.status; const priority = changes.priority || current.priority || '普通'; const startAt = changes.startAt === undefined ? current.start_at : changes.startAt || null; const dueAt = changes.dueAt === undefined ? current.due_at : changes.dueAt || null;
      const owner = changes.owner === undefined ? current.owner_name : changes.owner;
      const assigneeUserId = changes.assigneeUserId === undefined ? current.assignee_user_id : changes.assigneeUserId || null;
      db.prepare('UPDATE tasks SET title = ?, description = ?, stage = ?, owner_name = ?, assignee_user_id = ?, progress = ?, status = ?, priority = ?, start_at = ?, due_at = ?, updated_at = ? WHERE organization_id = ? AND id = ?').run(title, description, stage, owner, assigneeUserId, progress, status, priority, startAt, dueAt, now(), organizationId, taskId);
      return taskFromRow(db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId));
    },
    listTaskSubtasks(organizationId, taskId) { return db.prepare('SELECT * FROM task_subtasks WHERE organization_id = ? AND task_id = ? ORDER BY created_at').all(organizationId, taskId).map(taskSubtaskFromRow); },
    createTaskSubtask({ organizationId, taskId, userId, title }) { const createdAt = now(); const subtaskId = id('subtask'); db.prepare('INSERT INTO task_subtasks(id, organization_id, task_id, title, completed, created_by, created_at, updated_at) VALUES(?, ?, ?, ?, 0, ?, ?, ?)').run(subtaskId, organizationId, taskId, title, userId, createdAt, createdAt); return taskSubtaskFromRow(db.prepare('SELECT * FROM task_subtasks WHERE id = ?').get(subtaskId)); },
    updateTaskSubtask(organizationId, taskId, subtaskId, changes) { const current = db.prepare('SELECT * FROM task_subtasks WHERE organization_id = ? AND task_id = ? AND id = ?').get(organizationId, taskId, subtaskId); if (!current) return null; const title = changes.title === undefined ? current.title : changes.title; const completed = changes.completed === undefined ? current.completed : changes.completed ? 1 : 0; db.prepare('UPDATE task_subtasks SET title = ?, completed = ?, updated_at = ? WHERE organization_id = ? AND task_id = ? AND id = ?').run(title, completed, now(), organizationId, taskId, subtaskId); return taskSubtaskFromRow(db.prepare('SELECT * FROM task_subtasks WHERE id = ?').get(subtaskId)); },
    listTaskComments(organizationId, taskId) { return db.prepare('SELECT c.*, u.username, u.display_name FROM task_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.organization_id = ? AND c.task_id = ? ORDER BY c.created_at').all(organizationId, taskId).map(taskCommentFromRow); },
    createTaskComment({ organizationId, taskId, userId, body }) { const commentId = id('comment'); const createdAt = now(); db.prepare('INSERT INTO task_comments(id, organization_id, task_id, user_id, body, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(commentId, organizationId, taskId, userId, body, createdAt); return taskCommentFromRow(db.prepare('SELECT c.*, u.username, u.display_name FROM task_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?').get(commentId)); },
    listProjectComments(organizationId, projectId) { return db.prepare('SELECT c.*, u.username, u.display_name FROM project_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.organization_id = ? AND c.project_id = ? ORDER BY c.created_at').all(organizationId, projectId).map(projectCommentFromRow); },
    createProjectComment({ organizationId, projectId, userId, body }) { const commentId = id('project-comment'); const createdAt = now(); db.prepare('INSERT INTO project_comments(id, organization_id, project_id, user_id, body, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(commentId, organizationId, projectId, userId, body, createdAt); return projectCommentFromRow(db.prepare('SELECT c.*, u.username, u.display_name FROM project_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?').get(commentId)); },
    listConversations(organizationId, userId, projectId = undefined) {
      const projectFilter = projectId === undefined ? '' : ' AND c.project_id = ?';
      const parameters = projectId === undefined ? [organizationId] : [organizationId, projectId];
      return db.prepare(`${conversationDetailsSql} WHERE c.organization_id = ?${projectFilter} ORDER BY COALESCE(last_message_at, c.created_at) DESC, c.created_at DESC`).all(...parameters).map(row => decorateConversationForUser(row, organizationId, userId));
    },
    listProjectConversations(organizationId, userId, projectId) { return this.listConversations(organizationId, userId, projectId); },
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
      const rows = db.prepare('SELECT m.*, u.username, u.display_name FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? AND m.conversation_id = ? ORDER BY m.created_at, m.rowid').all(organizationId, conversationId);
      return messagesFromRows(rows, organizationId);
    },
    createMessage({ organizationId, conversationId, userId, body, attachmentIds = [] }) {
      const uniqueAttachmentIds = [...new Set(attachmentIds)];
      if (uniqueAttachmentIds.length) {
        const placeholders = uniqueAttachmentIds.map(() => '?').join(',');
        const available = db.prepare(`SELECT id FROM chat_attachments WHERE organization_id = ? AND uploader_user_id = ? AND message_id IS NULL AND id IN (${placeholders})`).all(organizationId, userId, ...uniqueAttachmentIds);
        if (available.length !== uniqueAttachmentIds.length) return null;
      }
      const message = { id: id('message'), organizationId, conversationId, userId, body, createdAt: now() };
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO messages(id, organization_id, conversation_id, user_id, body, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(message.id, organizationId, conversationId, userId, body, message.createdAt);
        const attach = db.prepare('UPDATE chat_attachments SET message_id = ? WHERE organization_id = ? AND uploader_user_id = ? AND message_id IS NULL AND id = ?');
        for (const attachmentId of uniqueAttachmentIds) {
          if (!attach.run(message.id, organizationId, userId, attachmentId).changes) throw new Error('chat_attachment_unavailable');
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      const row = db.prepare('SELECT m.*, u.username, u.display_name FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?').get(message.id);
      return messagesFromRows([row], organizationId)[0];
    },
    createChatAttachment({ organizationId, userId, name, mimeType, sizeBytes, storageKey }) {
      const attachmentId = id('attachment'); const createdAt = now();
      db.prepare('INSERT INTO chat_attachments(id, organization_id, message_id, uploader_user_id, name, mime_type, size_bytes, storage_key, created_at) VALUES(?, ?, NULL, ?, ?, ?, ?, ?, ?)').run(attachmentId, organizationId, userId, name, mimeType, sizeBytes, storageKey, createdAt);
      return attachmentFromRow(db.prepare('SELECT * FROM chat_attachments WHERE id = ?').get(attachmentId));
    },
    getChatAttachmentStorage(organizationId, attachmentId) {
      return db.prepare(`SELECT a.*, c.project_id
        FROM chat_attachments a
        LEFT JOIN messages m ON m.organization_id = a.organization_id AND m.id = a.message_id
        LEFT JOIN conversations c ON c.organization_id = m.organization_id AND c.id = m.conversation_id
        WHERE a.organization_id = ? AND a.id = ?`).get(organizationId, attachmentId) || null;
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
      const values = { name: changes.name ?? current.name, format: changes.format ?? current.format, material: changes.material ?? current.material, finish: changes.finish ?? current.finish, dimensions: changes.dimensions ?? current.dimensions, volume: changes.volume ?? current.volume, quantity: changes.quantity == null ? current.quantity : Math.max(1, Number(changes.quantity) || 1) };
      db.prepare('UPDATE parts SET name = ?, format = ?, material = ?, finish = ?, dimensions = ?, volume = ?, quantity = ? WHERE organization_id = ? AND id = ?').run(values.name, values.format, values.material, values.finish, values.dimensions, values.volume, values.quantity, organizationId, partId);
      return partFromRow(db.prepare('SELECT p.*, pr.title AS project_title, pr.tag AS project_order FROM parts p JOIN projects pr ON pr.id = p.project_id WHERE p.id = ?').get(partId));
    },
    listMembers(organizationId) { return db.prepare('SELECT m.role, u.id, u.username, u.display_name, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? ORDER BY m.created_at').all(organizationId).map(row => ({ id: row.id, username: row.username, displayName: row.display_name, role: row.role, createdAt: row.created_at })); },
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
    listProjectActivity(organizationId, projectId) {
      const entityIds = new Set([projectId]);
      for (const table of ['tasks', 'parts', 'quotes', 'fair_items', 'conversations', 'office_documents']) {
        for (const row of db.prepare(`SELECT id FROM ${table} WHERE organization_id = ? AND project_id = ?`).all(organizationId, projectId)) entityIds.add(row.id);
      }
      return this.listAudit(organizationId).filter(event => event.metadata?.projectId === projectId || entityIds.has(event.entityId));
    },
    listAudit(organizationId) { return db.prepare('SELECT a.*, u.username FROM audit_events a LEFT JOIN users u ON u.id = a.user_id WHERE a.organization_id = ? ORDER BY a.created_at DESC LIMIT 100').all(organizationId).map(row => ({ id: row.id, organizationId: row.organization_id, username: row.username || '', action: row.action, entityType: row.entity_type, entityId: row.entity_id, metadata: JSON.parse(row.metadata_json || '{}'), createdAt: row.created_at })); }
    ,listPlatformAudit() { return db.prepare('SELECT a.*, u.username, o.name AS organization_name FROM audit_events a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN organizations o ON o.id = a.organization_id ORDER BY a.created_at DESC LIMIT 200').all().map(row => ({ id: row.id, organizationId: row.organization_id, organizationName: row.organization_name || '', username: row.username || '', action: row.action, entityType: row.entity_type, entityId: row.entity_id, metadata: JSON.parse(row.metadata_json || '{}'), createdAt: row.created_at })); }
  };
}

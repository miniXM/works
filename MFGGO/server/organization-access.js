import { randomUUID } from 'node:crypto';
import { ENTERPRISE_PERMISSION_DEFINITIONS, LEGACY_ROLE_PERMISSIONS, canonicalEnterpriseRole } from '../access-policy.js';

export const ORGANIZATION_PERMISSION_DEFINITIONS = ENTERPRISE_PERMISSION_DEFINITIONS;
const permissionKeys = new Set(ORGANIZATION_PERMISSION_DEFINITIONS.map(item => item.key));
const managementKeys = new Set(ORGANIZATION_PERMISSION_DEFINITIONS.filter(item => item.managementOnly).map(item => item.key));
const memberRoles = new Set(['owner', 'admin', 'member']);
const legacyJobTitles = { engineer: '工程师', qa: '质检员' };

export class OrganizationAccessError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function fail(status, code, message) { throw new OrganizationAccessError(status, code, message); }
function textValue(value, max, code, label, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail(400, code, `${label}格式不正确`);
  return value.trim();
}
function nullableId(value) {
  return value === null || value === '' ? null : textValue(value, 100, 'invalid_department', '部门', true);
}
function validateObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail(400, 'invalid_request', '请求字段不正确');
}
function validatePermissionMap(value) {
  validateObject(value, [...permissionKeys]);
  if (Object.values(value).some(item => typeof item !== 'boolean')) fail(400, 'invalid_permissions', '授权值必须为布尔值');
}
const departmentFromRow = row => row ? ({ id: row.id, name: row.name, parentId: row.parent_id || null }) : null;

export function instrumentOrganizationAccess(api, db) {
  const transact = callback => {
    db.exec('SAVEPOINT organization_access_write');
    try {
      const result = callback();
      db.exec('RELEASE organization_access_write');
      return result;
    } catch (error) {
      db.exec('ROLLBACK TO organization_access_write');
      db.exec('RELEASE organization_access_write');
      throw error;
    }
  };
  transact(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS organization_departments (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL, parent_id TEXT REFERENCES organization_departments(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_departments_name
      ON organization_departments(organization_id, COALESCE(parent_id, ''), name COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS organization_access_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);`);
    const columns = new Set(db.prepare('PRAGMA table_info(memberships)').all().map(row => row.name));
    if (!columns.has('department_id')) db.exec('ALTER TABLE memberships ADD COLUMN department_id TEXT REFERENCES organization_departments(id) ON DELETE RESTRICT');
    if (!columns.has('job_title')) db.exec("ALTER TABLE memberships ADD COLUMN job_title TEXT NOT NULL DEFAULT ''");
    if (!columns.has('display_name_override')) db.exec("ALTER TABLE memberships ADD COLUMN display_name_override TEXT NOT NULL DEFAULT ''");
    if (!columns.has('manager_user_id')) db.exec('ALTER TABLE memberships ADD COLUMN manager_user_id TEXT REFERENCES users(id) ON DELETE SET NULL');
    db.exec('CREATE INDEX IF NOT EXISTS idx_memberships_department ON memberships(organization_id, department_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_memberships_manager ON memberships(organization_id, manager_user_id)');
    db.exec(`CREATE VIEW IF NOT EXISTS organization_user_profiles AS SELECT u.id, u.username, u.created_at,
      m.organization_id, COALESCE(NULLIF(m.display_name_override, ''), u.display_name) AS display_name
      FROM memberships m JOIN users u ON u.id = m.user_id`);
    const oldColumns = new Set(db.prepare('PRAGMA table_info(organization_member_permissions)').all().map(row => row.name));
    // The original table restricted grants to three keys; preserve explicit denials during replacement.
    if (oldColumns.size && !oldColumns.has('delegated_by_user_id')) db.exec('ALTER TABLE organization_member_permissions RENAME TO organization_member_permissions_legacy');
    db.exec(`CREATE TABLE IF NOT EXISTS organization_member_permissions (
      organization_id TEXT NOT NULL, user_id TEXT NOT NULL, permission_key TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)), updated_at TEXT NOT NULL,
      delegated_by_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY(organization_id, user_id, permission_key),
      FOREIGN KEY(organization_id, user_id) REFERENCES memberships(organization_id, user_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS organization_member_grantable_permissions (
      organization_id TEXT NOT NULL, user_id TEXT NOT NULL, permission_key TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)), updated_at TEXT NOT NULL,
      PRIMARY KEY(organization_id, user_id, permission_key),
      FOREIGN KEY(organization_id, user_id) REFERENCES memberships(organization_id, user_id) ON DELETE CASCADE
    );`);
    if (oldColumns.size && !oldColumns.has('delegated_by_user_id')) db.exec(`INSERT INTO organization_member_permissions(organization_id, user_id, permission_key, enabled, updated_at)
      SELECT organization_id, user_id, permission_key, enabled, updated_at FROM organization_member_permissions_legacy;
      DROP TABLE organization_member_permissions_legacy;`);
    const version = 'enterprise-role-hierarchy-v1';
    if (!db.prepare('SELECT 1 FROM organization_access_migrations WHERE version = ?').get(version)) {
      const timestamp = new Date().toISOString();
      const insert = db.prepare(`INSERT OR IGNORE INTO organization_member_permissions(organization_id, user_id, permission_key, enabled, updated_at) VALUES(?, ?, ?, 1, ?)`);
      for (const member of db.prepare('SELECT organization_id, user_id, role, job_title FROM memberships').all()) {
        for (const key of LEGACY_ROLE_PERMISSIONS[member.role] || []) insert.run(member.organization_id, member.user_id, key, timestamp);
        db.prepare('UPDATE memberships SET role = ?, job_title = ? WHERE organization_id = ? AND user_id = ?')
          .run(canonicalEnterpriseRole(member.role), member.job_title || legacyJobTitles[member.role] || '', member.organization_id, member.user_id);
      }
      db.prepare('INSERT INTO organization_access_migrations(version, applied_at) VALUES(?, ?)').run(version, timestamp);
    }
    const reportingVersion = 'enterprise-reporting-hierarchy-v1';
    if (!db.prepare('SELECT 1 FROM organization_access_migrations WHERE version = ?').get(reportingVersion)) {
      db.exec(`UPDATE memberships SET manager_user_id = (SELECT owner.user_id FROM memberships owner
        WHERE owner.organization_id = memberships.organization_id AND owner.role = 'owner'
        ORDER BY owner.created_at, owner.user_id LIMIT 1)
        WHERE role <> 'owner' AND manager_user_id IS NULL;
        UPDATE memberships SET manager_user_id = NULL WHERE role = 'owner';`);
      db.prepare('INSERT INTO organization_access_migrations(version, applied_at) VALUES(?, ?)').run(reportingVersion, new Date().toISOString());
    }
    db.exec(`UPDATE projects SET owner_name = COALESCE((SELECT u.display_name FROM organization_user_profiles u
      WHERE u.organization_id = projects.organization_id AND u.id = projects.owner_user_id), owner_name)
      WHERE owner_user_id IS NOT NULL;
    UPDATE tasks SET owner_name = COALESCE((SELECT u.display_name FROM organization_user_profiles u
      WHERE u.organization_id = tasks.organization_id AND u.id = tasks.assignee_user_id), owner_name)
      WHERE assignee_user_id IS NOT NULL;`);
  });

  const findMember = (organizationId, userId) => db.prepare(`SELECT m.*, u.username,
    COALESCE(NULLIF(m.display_name_override, ''), u.display_name) AS display_name
    FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? AND m.user_id = ?`).get(organizationId, userId);
  const findDepartment = (organizationId, departmentId) => db.prepare('SELECT * FROM organization_departments WHERE organization_id = ? AND id = ?').get(organizationId, departmentId);
  const emptyPermissions = () => Object.fromEntries([...permissionKeys].map(key => [key, false]));
  const rawGrantable = (organizationId, userId) => Object.fromEntries(db.prepare(`SELECT permission_key, enabled
    FROM organization_member_grantable_permissions WHERE organization_id = ? AND user_id = ?`).all(organizationId, userId).map(row => [row.permission_key, row.enabled === 1]));
  const permissionsFor = (organizationId, userId, visiting = new Set()) => {
    const permissions = emptyPermissions();
    const member = findMember(organizationId, userId);
    if (!member || visiting.has(userId)) return permissions;
    if (member.role === 'owner') return Object.fromEntries([...permissionKeys].map(key => [key, true]));
    const nextVisiting = new Set([...visiting, userId]);
    for (const row of db.prepare('SELECT * FROM organization_member_permissions WHERE organization_id = ? AND user_id = ?').all(organizationId, userId)) {
      if (!permissionKeys.has(row.permission_key) || !row.enabled || (managementKeys.has(row.permission_key) && member.role !== 'admin')) continue;
      if (row.delegated_by_user_id) {
        const grantor = findMember(organizationId, row.delegated_by_user_id);
        if (grantor?.role !== 'admin') continue;
        const grantorPermissions = permissionsFor(organizationId, grantor.user_id, nextVisiting);
        if (!grantorPermissions['member.manage'] || !grantorPermissions[row.permission_key] || !rawGrantable(organizationId, grantor.user_id)[row.permission_key]) continue;
      }
      permissions[row.permission_key] = true;
    }
    return permissions;
  };
  const actorAccess = (organizationId, userId) => ({ role: findMember(organizationId, userId)?.role,
    permissions: permissionsFor(organizationId, userId), grantablePermissions: api.getMemberGrantablePermissions(organizationId, userId) });
  const requireManager = (organizationId, actorUserId, permission) => {
    const actor = actorAccess(organizationId, actorUserId);
    if (actor.role !== 'owner' && (actor.role !== 'admin' || (permission && !actor.permissions[permission]))) fail(403, 'organization_permission_denied', '没有管理此项组织信息的权限');
    return actor;
  };
  const editableMember = (actor, actorUserId, member) => actor.role === 'owner'
    || (actor.role === 'admin' && actor.permissions['member.manage'] && member.role === 'member' && member.user_id !== actorUserId);
  const toMember = (row, actor = null, actorUserId = null) => ({
    id: row.user_id, username: row.username, displayName: row.display_name, role: row.role,
    departmentId: row.department_id || null, jobTitle: row.job_title || '', managerUserId: row.manager_user_id || null, createdAt: row.created_at,
    permissions: permissionsFor(row.organization_id, row.user_id), grantablePermissions: api.getMemberGrantablePermissions(row.organization_id, row.user_id),
    ...(actor ? { canEdit: Boolean(editableMember(actor, actorUserId, row)) } : {})
  });
  const validateParent = (organizationId, parentId, departmentId = null) => {
    const visited = new Set(departmentId ? [departmentId] : []);
    let currentId = parentId;
    while (currentId) {
      if (visited.has(currentId)) fail(400, 'department_cycle', '上级部门不能是自身或下级部门');
      visited.add(currentId);
      const parent = findDepartment(organizationId, currentId);
      if (!parent) fail(404, 'department_not_found', '部门不存在或不属于当前企业');
      currentId = parent.parent_id;
    }
  };
  const ensureUniqueDepartment = (organizationId, name, parentId, departmentId = '') => {
    const duplicate = db.prepare(`SELECT id FROM organization_departments
      WHERE organization_id = ? AND name = ? COLLATE NOCASE AND COALESCE(parent_id, '') = ? AND id <> ?`).get(organizationId, name, parentId || '', departmentId);
    if (duplicate) fail(409, 'department_name_conflict', '同一上级部门下已存在该名称');
  };
  const defaultManager = (organizationId, excludedUserId = '') => db.prepare(`SELECT user_id FROM memberships
    WHERE organization_id = ? AND role = 'owner' AND user_id <> ? ORDER BY created_at, user_id LIMIT 1`).get(organizationId, excludedUserId)?.user_id || null;
  const managerIdValue = value => value === null || value === '' ? null : textValue(value, 100, 'invalid_manager', '直属上级', true);
  const isInReportingSubtree = (organizationId, rootId, userId) => {
    const visited = new Set();
    let currentId = userId;
    while (currentId && !visited.has(currentId)) {
      if (currentId === rootId) return true;
      visited.add(currentId);
      currentId = findMember(organizationId, currentId)?.manager_user_id;
    }
    return false;
  };
  const validateManager = (organizationId, userId, role, managerUserId) => {
    if (role === 'owner' && managerUserId) fail(400, 'owner_manager_denied', '企业主管理不能设置直属上级');
    const visited = new Set(userId ? [userId] : []);
    let currentId = managerUserId;
    while (currentId) {
      if (visited.has(currentId)) fail(400, 'reporting_cycle', '直属上级不能是本人或自己的下级');
      visited.add(currentId);
      const manager = findMember(organizationId, currentId);
      if (!manager) fail(404, 'manager_not_found', '直属上级不存在或不属于当前企业');
      if (currentId === managerUserId && role === 'admin' && manager.role === 'member') fail(400, 'invalid_manager_role', '企业副管理的直属上级必须是管理者');
      currentId = manager.manager_user_id;
    }
    if (role === 'member' && userId && db.prepare(`SELECT 1 FROM memberships
      WHERE organization_id = ? AND manager_user_id = ? AND role IN ('owner', 'admin') LIMIT 1`).get(organizationId, userId)) {
      fail(400, 'reporting_role_conflict', '请先调整下级管理者的汇报关系，再将此成员设为员工');
    }
  };
  const requireReportingScope = (organizationId, actor, actorUserId, userId, managerUserId) => {
    if (actor.role === 'owner') return;
    if ((userId && !isInReportingSubtree(organizationId, actorUserId, userId))
      || !managerUserId || !isInReportingSubtree(organizationId, actorUserId, managerUserId)) {
      fail(403, 'reporting_scope_denied', '副管理只能调整自己下级范围内的汇报关系');
    }
  };
  const profileValues = (organizationId, existing, input) => {
    const departmentId = input.departmentId === undefined ? existing.department_id : nullableId(input.departmentId);
    if (departmentId && !findDepartment(organizationId, departmentId)) fail(404, 'department_not_found', '部门不存在或不属于当前企业');
    return { departmentId: departmentId || null,
      jobTitle: input.jobTitle === undefined ? existing.job_title || '' : textValue(input.jobTitle, 80, 'invalid_job_title', '职位'),
      displayName: input.displayName === undefined ? existing.display_name_override || '' : textValue(input.displayName, 80, 'invalid_display_name', '姓名', true) };
  };
  const savePermissions = (organizationId, userId, changes, delegatedBy = null) => {
    const save = db.prepare(`INSERT INTO organization_member_permissions(organization_id, user_id, permission_key, enabled, updated_at, delegated_by_user_id)
      VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, user_id, permission_key)
      DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at, delegated_by_user_id = excluded.delegated_by_user_id`);
    const timestamp = new Date().toISOString();
    for (const [key, value] of Object.entries(changes)) save.run(organizationId, userId, key, value ? 1 : 0, timestamp, delegatedBy);
  };
  const refreshCurrentNames = (organizationId, userId) => {
    const name = findMember(organizationId, userId).display_name;
    db.prepare('UPDATE tasks SET owner_name = ? WHERE organization_id = ? AND assignee_user_id = ?').run(name, organizationId, userId);
    db.prepare('UPDATE projects SET owner_name = ? WHERE organization_id = ? AND owner_user_id = ?').run(name, organizationId, userId);
  };
  const createMember = api.createMember.bind(api);
  Object.assign(api, {
    getMemberPermissions(organizationId, userId) { return permissionsFor(organizationId, userId); },
    getOrganizationPermissions(organizationId, userId) { return this.getMemberPermissions(organizationId, userId); },
    getMemberGrantablePermissions(organizationId, userId) {
      const member = findMember(organizationId, userId);
      const permissions = permissionsFor(organizationId, userId);
      const raw = rawGrantable(organizationId, userId);
      return Object.fromEntries([...permissionKeys].map(key => [key, !managementKeys.has(key)
        && (member?.role === 'owner' || (member?.role === 'admin' && permissions[key] && raw[key] === true))]));
    },
    getOrganizationChart(organizationId, actorUserId) {
      const current = findMember(organizationId, actorUserId);
      if (!current) fail(403, 'organization_permission_denied', '没有查看此企业组织架构的权限');
      const organization = db.prepare('SELECT id, name FROM organizations WHERE id = ?').get(organizationId);
      // UNION deduplicates members even if a legacy database contains a reporting cycle.
      const rows = db.prepare(`WITH RECURSIVE visible(user_id) AS (
        SELECT user_id FROM memberships WHERE organization_id = ? AND user_id = ?
        UNION SELECT m.user_id FROM memberships m JOIN visible v ON m.manager_user_id = v.user_id
          WHERE m.organization_id = ?
      ) SELECT m.user_id, u.username, COALESCE(NULLIF(m.display_name_override, ''), u.display_name) AS display_name,
        m.role, m.job_title, m.department_id, d.name AS department_name, m.manager_user_id
        FROM memberships m JOIN users u ON u.id = m.user_id
        LEFT JOIN organization_departments d ON d.organization_id = m.organization_id AND d.id = m.department_id
        WHERE m.organization_id = ? AND (m.user_id IN (SELECT user_id FROM visible) OR m.user_id = ?)
        ORDER BY m.created_at, m.user_id`).all(organizationId, actorUserId, organizationId, organizationId, current.manager_user_id || null);
      const visibleIds = new Set(rows.map(row => row.user_id));
      return { organization: { id: organization.id, name: organization.name }, currentUserId: actorUserId,
        members: rows.map(row => ({ id: row.user_id, username: row.username, displayName: row.display_name,
          role: row.role, jobTitle: row.job_title || '', departmentId: row.department_id || null,
          departmentName: row.department_name || '', managerUserId: visibleIds.has(row.manager_user_id) ? row.manager_user_id : null })),
        capabilities: { canManageMembers: current.role === 'owner' || (current.role === 'admin' && permissionsFor(organizationId, actorUserId)['member.manage']) } };
    },
    getOrganizationStructure(organizationId, actorUserId) {
      const actor = requireManager(organizationId, actorUserId);
      const row = db.prepare('SELECT id, slug, name FROM organizations WHERE id = ?').get(organizationId);
      return { organization: { id: row.id, slug: row.slug, name: row.name },
        departments: db.prepare('SELECT * FROM organization_departments WHERE organization_id = ? ORDER BY created_at, id').all(organizationId).map(departmentFromRow),
        members: db.prepare(`SELECT m.*, u.username, COALESCE(NULLIF(m.display_name_override, ''), u.display_name) AS display_name
          FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? ORDER BY m.created_at, m.user_id`).all(organizationId).map(member => toMember(member, actor, actorUserId)),
        permissionDefinitions: ORGANIZATION_PERMISSION_DEFINITIONS, actor,
        capabilities: { canManageMembers: actor.role === 'owner' || actor.permissions['member.manage'],
          canManageDepartments: actor.role === 'owner' || actor.permissions['department.manage'], canAssignRoles: actor.role === 'owner' } };
    },
    getMemberProfile(organizationId, userId) {
      const member = findMember(organizationId, userId);
      if (!member) fail(404, 'member_not_found', '成员不存在或不属于当前企业');
      return { member: toMember(member), departments: db.prepare('SELECT * FROM organization_departments WHERE organization_id = ? ORDER BY created_at, id').all(organizationId).map(departmentFromRow) };
    },
    updateMemberProfile(organizationId, userId, input) {
      return transact(() => {
        const existing = findMember(organizationId, userId);
        if (!existing) fail(404, 'member_not_found', '成员不存在或不属于当前企业');
        validateObject(input, ['displayName', 'departmentId', 'jobTitle']);
        const profile = profileValues(organizationId, existing, input);
        const before = toMember(existing);
        db.prepare('UPDATE memberships SET department_id = ?, job_title = ?, display_name_override = ? WHERE organization_id = ? AND user_id = ?').run(profile.departmentId, profile.jobTitle, profile.displayName, organizationId, userId);
        if (input.displayName !== undefined) refreshCurrentNames(organizationId, userId);
        const member = toMember(findMember(organizationId, userId));
        this.addAudit({ organizationId, userId, action: 'organization.member.profile.update', entityType: 'membership', entityId: `${organizationId}:${userId}`, metadata: { from: before, to: member } });
        return member;
      });
    },
    createOrganizationDepartment(organizationId, actorUserId, input) {
      return transact(() => {
        requireManager(organizationId, actorUserId, 'department.manage');
        validateObject(input, ['name', 'parentId']);
        const name = textValue(input.name, 80, 'invalid_department_name', '部门名称', true);
        const parentId = input.parentId === undefined ? null : nullableId(input.parentId);
        validateParent(organizationId, parentId);
        ensureUniqueDepartment(organizationId, name, parentId);
        const departmentId = `department_${randomUUID()}`;
        const timestamp = new Date().toISOString();
        db.prepare('INSERT INTO organization_departments(id, organization_id, name, parent_id, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)').run(departmentId, organizationId, name, parentId, timestamp, timestamp);
        const department = departmentFromRow(findDepartment(organizationId, departmentId));
        this.addAudit({ organizationId, userId: actorUserId, action: 'organization.department.create', entityType: 'department', entityId: departmentId, metadata: { department } });
        return department;
      });
    },
    updateOrganizationDepartment(organizationId, actorUserId, departmentId, input) {
      return transact(() => {
        requireManager(organizationId, actorUserId, 'department.manage');
        const existing = findDepartment(organizationId, departmentId);
        if (!existing) fail(404, 'department_not_found', '部门不存在或不属于当前企业');
        validateObject(input, ['name', 'parentId']);
        const name = input.name === undefined ? existing.name : textValue(input.name, 80, 'invalid_department_name', '部门名称', true);
        const parentId = input.parentId === undefined ? existing.parent_id : nullableId(input.parentId);
        validateParent(organizationId, parentId, departmentId);
        ensureUniqueDepartment(organizationId, name, parentId, departmentId);
        db.prepare('UPDATE organization_departments SET name = ?, parent_id = ?, updated_at = ? WHERE organization_id = ? AND id = ?').run(name, parentId, new Date().toISOString(), organizationId, departmentId);
        const department = departmentFromRow(findDepartment(organizationId, departmentId));
        this.addAudit({ organizationId, userId: actorUserId, action: 'organization.department.update', entityType: 'department', entityId: departmentId, metadata: { from: departmentFromRow(existing), to: department } });
        return department;
      });
    },
    deleteOrganizationDepartment(organizationId, actorUserId, departmentId) {
      return transact(() => {
        requireManager(organizationId, actorUserId, 'department.manage');
        const existing = findDepartment(organizationId, departmentId);
        if (!existing) fail(404, 'department_not_found', '部门不存在或不属于当前企业');
        const child = db.prepare('SELECT 1 FROM organization_departments WHERE organization_id = ? AND parent_id = ? LIMIT 1').get(organizationId, departmentId);
        const member = db.prepare('SELECT 1 FROM memberships WHERE organization_id = ? AND department_id = ? LIMIT 1').get(organizationId, departmentId);
        if (child || member) fail(409, 'department_not_empty', '请先调整部门内的成员和下级部门');
        db.prepare('DELETE FROM organization_departments WHERE organization_id = ? AND id = ?').run(organizationId, departmentId);
        this.addAudit({ organizationId, userId: actorUserId, action: 'organization.department.delete', entityType: 'department', entityId: departmentId, metadata: { department: departmentFromRow(existing) } });
        return true;
      });
    },
    createMember(input) {
      return transact(() => {
        const role = canonicalEnterpriseRole(input.role || 'member');
        if (!memberRoles.has(role)) fail(400, 'invalid_role', '成员角色不正确');
        const managerUserId = input.managerUserId === undefined ? (role === 'owner' ? null : defaultManager(input.organizationId)) : managerIdValue(input.managerUserId);
        validateManager(input.organizationId, null, role, managerUserId);
        const member = createMember({ ...input, role });
        db.prepare('UPDATE memberships SET manager_user_id = ? WHERE organization_id = ? AND user_id = ?').run(managerUserId, input.organizationId, member.id);
        // Internal callers can still specify old job roles; new members default to no business grants.
        if (input.role !== role) {
          savePermissions(input.organizationId, member.id, Object.fromEntries((LEGACY_ROLE_PERMISSIONS[input.role] || []).map(key => [key, true])));
          db.prepare('UPDATE memberships SET job_title = ? WHERE organization_id = ? AND user_id = ?').run(legacyJobTitles[input.role] || '', input.organizationId, member.id);
        }
        return toMember(findMember(input.organizationId, member.id));
      });
    },
    createOrganizationMember(organizationId, actorUserId, input) {
      return transact(() => {
        const actor = requireManager(organizationId, actorUserId, 'member.manage');
        validateObject(input, ['username', 'displayName', 'temporaryPassword', 'role', 'managerUserId']);
        const username = textValue(input.username, 80, 'invalid_username', '账号', true);
        if (!/^[a-zA-Z0-9_.@-]{3,80}$/.test(username)) fail(400, 'invalid_username', '账号需为 3 至 80 位字母、数字或 . _ @ -');
        const displayName = textValue(input.displayName, 80, 'invalid_display_name', '姓名', true);
        const password = textValue(input.temporaryPassword, 200, 'invalid_password', '初始密码', true);
        if (password.length < 6) fail(400, 'invalid_password', '初始密码至少 6 位');
        const role = canonicalEnterpriseRole(input.role || 'member');
        if (!['admin', 'member'].includes(role)) fail(400, 'invalid_role', '新成员只能为员工或企业副管理');
        if (actor.role !== 'owner' && role !== 'member') fail(403, 'role_assignment_denied', '仅企业主管理可任命副管理');
        if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409, 'username_exists', '账号已存在');
        const legacyGrants = input.role !== role ? Object.fromEntries((LEGACY_ROLE_PERMISSIONS[input.role] || []).map(key => [key, true])) : {};
        if (actor.role !== 'owner' && Object.keys(legacyGrants).some(key => !actor.grantablePermissions[key])) fail(403, 'grant_scope_exceeded', '不能授予超出主管理允许范围的权限');
        const managerUserId = input.managerUserId === undefined ? actorUserId : managerIdValue(input.managerUserId);
        requireReportingScope(organizationId, actor, actorUserId, null, managerUserId);
        const member = this.createMember({ organizationId, username, displayName, password, role, managerUserId });
        if (Object.keys(legacyGrants).length) savePermissions(organizationId, member.id, legacyGrants, actor.role === 'owner' ? null : actorUserId);
        if (legacyJobTitles[input.role]) db.prepare('UPDATE memberships SET job_title = ? WHERE organization_id = ? AND user_id = ?').run(legacyJobTitles[input.role], organizationId, member.id);
        const result = toMember(findMember(organizationId, member.id), actor, actorUserId);
        this.addAudit({ organizationId, userId: actorUserId, action: 'organization.member.create', entityType: 'membership', entityId: `${organizationId}:${member.id}`, metadata: { member: result } });
        return result;
      });
    },
    updateOrganizationMember(organizationId, actorUserId, userId, input) {
      return transact(() => {
        const actor = requireManager(organizationId, actorUserId, 'member.manage');
        const existing = findMember(organizationId, userId);
        if (!existing) fail(404, 'member_not_found', '成员不存在或不属于当前企业');
        validateObject(input, ['role', 'departmentId', 'jobTitle', 'displayName', 'permissions', 'grantablePermissions', 'managerUserId']);
        if (!editableMember(actor, actorUserId, existing)) fail(403, 'member_edit_denied', '副管理只能管理员工，不能修改本人或其他管理者');
        const requestedRole = input.role === undefined ? existing.role : input.role;
        const role = canonicalEnterpriseRole(requestedRole);
        if (!memberRoles.has(role)) fail(400, 'invalid_role', '成员角色不正确');
        if (userId === actorUserId && (input.permissions !== undefined || input.grantablePermissions !== undefined)) fail(400, 'self_authorization_change_denied', '不能修改自己的授权');
        if (userId === actorUserId && role !== existing.role) fail(400, 'self_role_change_denied', '不能修改自己的企业角色');
        if (actor.role !== 'owner' && (input.role !== undefined || input.grantablePermissions !== undefined)) fail(403, 'role_assignment_denied', '仅企业主管理可调整管理身份和转授权限');
        if (existing.role === 'owner' && role !== 'owner' && this.countOwners(organizationId) <= 1) fail(400, 'last_owner', '企业至少需要保留一位主管理');
        const managerUserId = input.managerUserId !== undefined ? managerIdValue(input.managerUserId)
          : role === 'owner' ? null : existing.role === 'owner' ? defaultManager(organizationId, userId) : existing.manager_user_id || null;
        if (managerUserId !== (existing.manager_user_id || null)) requireReportingScope(organizationId, actor, actorUserId, userId, managerUserId);
        validateManager(organizationId, userId, role, managerUserId);
        const profile = profileValues(organizationId, existing, input);
        if (input.jobTitle === undefined && !profile.jobTitle && legacyJobTitles[requestedRole]) profile.jobTitle = legacyJobTitles[requestedRole];
        if (input.permissions !== undefined) validatePermissionMap(input.permissions);
        if (input.grantablePermissions !== undefined) validatePermissionMap(input.grantablePermissions);
        const legacyGrants = input.role !== undefined && requestedRole !== role ? Object.fromEntries((LEGACY_ROLE_PERMISSIONS[requestedRole] || []).map(key => [key, true])) : {};
        const changes = { ...legacyGrants, ...input.permissions };
        for (const [key, value] of Object.entries(changes)) {
          if (role === 'owner' && value !== true) fail(400, 'owner_permissions_immutable', '企业主管理的权限不能被撤销');
          if (value && managementKeys.has(key) && role !== 'admin' && role !== 'owner') fail(400, 'management_role_required', '组织管理权限只能授予副管理');
          if (actor.role !== 'owner' && (!actor.grantablePermissions[key] || managementKeys.has(key))) fail(403, 'grant_scope_exceeded', '不能修改超出主管理允许范围的权限');
        }
        const futurePermissions = { ...(existing.role === 'owner' && role !== 'owner' ? emptyPermissions() : permissionsFor(organizationId, userId)), ...changes };
        for (const [key, value] of Object.entries(input.grantablePermissions || {})) {
          if (value && (role !== 'admin' || managementKeys.has(key) || !futurePermissions[key])) fail(400, 'invalid_grantable_permissions', '转授范围只能包含副管理本人拥有的业务权限');
        }
        const before = toMember(existing);
        db.prepare('UPDATE memberships SET role = ?, department_id = ?, job_title = ?, display_name_override = ?, manager_user_id = ? WHERE organization_id = ? AND user_id = ?').run(role, profile.departmentId, profile.jobTitle, profile.displayName, managerUserId, organizationId, userId);
        if (input.displayName !== undefined) refreshCurrentNames(organizationId, userId);
        if (role === 'owner') db.prepare('DELETE FROM organization_member_permissions WHERE organization_id = ? AND user_id = ?').run(organizationId, userId);
        else savePermissions(organizationId, userId, changes, actor.role === 'owner' ? null : actorUserId);
        if (role !== 'admin') {
          db.prepare('DELETE FROM organization_member_grantable_permissions WHERE organization_id = ? AND user_id = ?').run(organizationId, userId);
          for (const key of managementKeys) db.prepare('DELETE FROM organization_member_permissions WHERE organization_id = ? AND user_id = ? AND permission_key = ?').run(organizationId, userId, key);
        } else {
          const save = db.prepare(`INSERT INTO organization_member_grantable_permissions(organization_id, user_id, permission_key, enabled, updated_at)
            VALUES(?, ?, ?, ?, ?) ON CONFLICT(organization_id, user_id, permission_key) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`);
          const timestamp = new Date().toISOString();
          for (const [key, value] of Object.entries(input.grantablePermissions || {})) save.run(organizationId, userId, key, value ? 1 : 0, timestamp);
          // Revoking an owned permission also removes the deputy's stored delegation scope.
          for (const [key, value] of Object.entries(changes)) if (!value) db.prepare('DELETE FROM organization_member_grantable_permissions WHERE organization_id = ? AND user_id = ? AND permission_key = ?').run(organizationId, userId, key);
        }
        const member = toMember(findMember(organizationId, userId), actor, actorUserId);
        this.addAudit({ organizationId, userId: actorUserId, action: 'organization.member.update', entityType: 'membership', entityId: `${organizationId}:${userId}`, metadata: { from: before, to: member } });
        return member;
      });
    }
  });
  return api;
}

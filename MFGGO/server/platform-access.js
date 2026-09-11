import { randomUUID } from 'node:crypto';
import { PLATFORM_PERMISSION_DEFINITIONS, platformCan } from '../access-policy.js';

const permissionKeys = new Set(PLATFORM_PERMISSION_DEFINITIONS.map(item => item.key));
const moduleKeys = ['projects', 'workspace', 'bom', 'parts', 'communication', 'chat', 'tasks', 'stats'];

export class PlatformAccessError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new PlatformAccessError(status, code, message);
}

function objectInput(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) fail(400, 'invalid_request', '请求字段不正确');
}

function textInput(value, max, code, message) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, code, message);
  return value.trim();
}

const userFromRow = row => ({ id: row.id, username: row.username, displayName: row.display_name });

export function instrumentPlatformAccess(api, db) {
  const columns = new Set(db.prepare('PRAGMA table_info(platform_admins)').all().map(row => row.name));
  db.exec('SAVEPOINT platform_access_migration');
  try {
    if (!columns.has('role')) db.exec("ALTER TABLE platform_admins ADD COLUMN role TEXT NOT NULL DEFAULT 'owner' CHECK(role IN ('owner', 'admin'))");
    db.exec(`CREATE TABLE IF NOT EXISTS platform_admin_permissions (
      user_id TEXT NOT NULL REFERENCES platform_admins(user_id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, permission_key)
    )`);
    db.exec('RELEASE platform_access_migration');
  } catch (error) {
    db.exec('ROLLBACK TO platform_access_migration');
    db.exec('RELEASE platform_access_migration');
    throw error;
  }

  const getUser = userId => db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(userId);
  const getOrganization = organizationId => db.prepare('SELECT id, slug, name FROM organizations WHERE id = ?').get(organizationId);
  const requirePrimary = actorUserId => {
    if (api.getPlatformAccess(actorUserId).role !== 'owner') fail(403, 'platform_owner_required', '仅平台主管理可以管理平台副管理和授权');
  };
  const requirePermission = (actorUserId, permission) => {
    if (!platformCan(api.getPlatformAccess(actorUserId), permission)) fail(403, 'platform_permission_denied', '当前账号没有此平台操作权限');
  };
  const transaction = callback => {
    db.exec('SAVEPOINT platform_access_write');
    try {
      const result = callback();
      db.exec('RELEASE platform_access_write');
      return result;
    } catch (error) {
      db.exec('ROLLBACK TO platform_access_write');
      db.exec('RELEASE platform_access_write');
      throw error;
    }
  };
  const actorOrganizationId = userId => {
    const member = db.prepare('SELECT organization_id FROM memberships WHERE user_id = ? ORDER BY created_at, organization_id LIMIT 1').get(userId);
    if (!member) fail(409, 'platform_actor_organization_missing', '当前管理员没有可记录审计的企业');
    return member.organization_id;
  };
  const organizationResult = organizationId => {
    const organization = getOrganization(organizationId);
    const ownerRows = db.prepare(`SELECT u.id, u.username, u.display_name FROM memberships m
      JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? AND m.role = 'owner'
      ORDER BY m.created_at, u.id`).all(organizationId);
    return {
      ...organization, modules: api.listOrganizationModules(organizationId),
      owners: ownerRows.map(userFromRow), ownerUserId: ownerRows[0]?.id || null
    };
  };

  Object.assign(api, {
    getPlatformAccess(userId) {
      const administrator = db.prepare('SELECT role FROM platform_admins WHERE user_id = ?').get(userId);
      const role = administrator?.role || null;
      const permissions = Object.fromEntries(PLATFORM_PERMISSION_DEFINITIONS.map(({ key }) => [key, role === 'owner']));
      if (role === 'admin') {
        for (const row of db.prepare('SELECT permission_key, enabled FROM platform_admin_permissions WHERE user_id = ?').all(userId)) {
          if (permissionKeys.has(row.permission_key)) permissions[row.permission_key] = row.enabled === 1;
        }
      }
      return { role, permissions };
    },
    isPlatformAdmin(userId) {
      return ['owner', 'admin'].includes(this.getPlatformAccess(userId).role);
    },
    getPlatformAdministrators(actorUserId) {
      requirePrimary(actorUserId);
      return {
        administrators: db.prepare(`SELECT u.id, u.username, u.display_name, p.created_at
          FROM platform_admins p JOIN users u ON u.id = p.user_id ORDER BY p.created_at, u.id`).all()
          .map(row => ({ ...userFromRow(row), ...this.getPlatformAccess(row.id), createdAt: row.created_at })),
        candidates: db.prepare(`SELECT u.id, u.username, u.display_name FROM users u
          WHERE NOT EXISTS (SELECT 1 FROM platform_admins p WHERE p.user_id = u.id)
          AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)
          ORDER BY u.display_name, u.username`).all().map(userFromRow),
        permissionDefinitions: PLATFORM_PERMISSION_DEFINITIONS
      };
    },
    updatePlatformAdministrator(actorUserId, userId, input) {
      return transaction(() => {
        requirePrimary(actorUserId);
        objectInput(input, ['role', 'permissions']);
        if (input.role !== 'admin' && input.role !== null) fail(400, 'invalid_platform_role', '只能任命平台副管理或撤销平台管理身份');
        const user = getUser(userId);
        if (!user) fail(404, 'user_not_found', '用户不存在');
        if (actorUserId === userId) fail(400, 'self_platform_role_change_denied', '不能降低或撤销自己的平台管理身份');
        const before = this.getPlatformAccess(userId);
        if (before.role === 'owner' && Number(db.prepare("SELECT COUNT(*) count FROM platform_admins WHERE role = 'owner'").get().count) <= 1) {
          fail(400, 'last_platform_owner', '平台至少需要保留一位主管理');
        }
        const permissions = input.permissions === undefined ? {} : input.permissions;
        objectInput(permissions, [...permissionKeys]);
        if (Object.values(permissions).some(value => typeof value !== 'boolean')) fail(400, 'invalid_platform_permissions', '平台授权值必须为布尔值');
        if (input.role === null && Object.values(permissions).some(Boolean)) fail(400, 'revoked_platform_permissions', '撤销平台身份时不能同时授予权限');
        if (input.role === 'admin' && !db.prepare('SELECT 1 FROM memberships WHERE user_id = ? LIMIT 1').get(userId)) {
          fail(400, 'platform_member_required', '平台副管理需要一个已有企业成员账号');
        }
        const organizationId = actorOrganizationId(actorUserId);
        const timestamp = new Date().toISOString();
        if (input.role === null) {
          db.prepare('DELETE FROM platform_admins WHERE user_id = ?').run(userId);
        } else {
          db.prepare(`INSERT INTO platform_admins(user_id, role, created_at) VALUES(?, 'admin', ?)
            ON CONFLICT(user_id) DO UPDATE SET role = 'admin'`).run(userId, timestamp);
          // Replacing the complete platform grant set makes unchecked capabilities revoke immediately.
          db.prepare('DELETE FROM platform_admin_permissions WHERE user_id = ?').run(userId);
          const insert = db.prepare('INSERT INTO platform_admin_permissions(user_id, permission_key, enabled, updated_at) VALUES(?, ?, ?, ?)');
          for (const [key, enabled] of Object.entries(permissions)) insert.run(userId, key, enabled ? 1 : 0, timestamp);
        }
        const administrator = { ...userFromRow(user), ...this.getPlatformAccess(userId) };
        this.addAudit({ organizationId, userId: actorUserId, action: 'platform.administrator.update', entityType: 'platform_administrator', entityId: userId,
          metadata: { scope: 'platform', from: before, to: { role: administrator.role, permissions: administrator.permissions } } });
        return administrator;
      });
    },
    getPlatformOwnerCandidates(actorUserId, organizationId = null) {
      const access = this.getPlatformAccess(actorUserId);
      if (!platformCan(access, 'organization.create') && !platformCan(access, 'organization.owner.manage')) fail(403, 'platform_permission_denied', '当前账号没有任命企业主管理的权限');
      if (organizationId) {
        if (!getOrganization(organizationId)) fail(404, 'organization_not_found', '企业不存在');
        return db.prepare(`SELECT u.id, u.username, u.display_name, m.role FROM memberships m
          JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? ORDER BY u.display_name, u.username`).all(organizationId)
          .map(row => ({ ...userFromRow(row), role: row.role }));
      }
      return db.prepare(`SELECT u.id, u.username, u.display_name FROM users u
        WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)
        ORDER BY u.display_name, u.username`).all().map(userFromRow);
    },
    replacePlatformOrganizationOwner(actorUserId, organizationId, input) {
      return transaction(() => {
        requirePermission(actorUserId, 'organization.owner.manage');
        objectInput(input, ['userId']);
        const userId = textInput(input.userId, 100, 'invalid_owner_user', '请选择企业主管理');
        if (!getOrganization(organizationId)) fail(404, 'organization_not_found', '企业不存在');
        if (!db.prepare('SELECT 1 FROM memberships WHERE organization_id = ? AND user_id = ?').get(organizationId, userId)) {
          fail(404, 'member_not_found', '所选用户不是该企业成员');
        }
        const previousOwnerIds = db.prepare("SELECT user_id FROM memberships WHERE organization_id = ? AND role = 'owner'").all(organizationId).map(row => row.user_id);
        // Promote before lowering previous owners so the enterprise never lacks its primary administrator.
        db.prepare("UPDATE memberships SET role = 'owner' WHERE organization_id = ? AND user_id = ?").run(organizationId, userId);
        db.prepare("UPDATE memberships SET role = 'admin' WHERE organization_id = ? AND role = 'owner' AND user_id <> ?").run(organizationId, userId);
        if (db.prepare('PRAGMA table_info(memberships)').all().some(column => column.name === 'manager_user_id')) {
          // Detach the new root before moving former owners beneath it to avoid a reporting cycle.
          db.prepare('UPDATE memberships SET manager_user_id = NULL WHERE organization_id = ? AND user_id = ?').run(organizationId, userId);
          const reparent = db.prepare('UPDATE memberships SET manager_user_id = ? WHERE organization_id = ? AND user_id = ?');
          for (const previousId of previousOwnerIds) if (previousId !== userId) reparent.run(userId, organizationId, previousId);
        }
        const permissionTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'organization_member_permissions'").get();
        if (permissionTable) {
          const clear = db.prepare('DELETE FROM organization_member_permissions WHERE organization_id = ? AND user_id = ?');
          for (const id of new Set([...previousOwnerIds, userId])) clear.run(organizationId, id);
        }
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'organization_member_grantable_permissions'").get()) {
          const clear = db.prepare('DELETE FROM organization_member_grantable_permissions WHERE organization_id = ? AND user_id = ?');
          for (const id of new Set([...previousOwnerIds, userId])) clear.run(organizationId, id);
        }
        this.addAudit({ organizationId, userId: actorUserId, action: 'platform.organization.owner.update', entityType: 'organization', entityId: organizationId,
          metadata: { scope: 'platform', previousOwnerIds, ownerUserId: userId, demotedRole: 'admin' } });
        return organizationResult(organizationId);
      });
    },
    createPlatformOrganization(actorUserId, input) {
      return transaction(() => {
        requirePermission(actorUserId, 'organization.create');
        objectInput(input, ['name', 'slug', 'ownerUserId', 'modules']);
        const name = textInput(input.name, 120, 'invalid_organization', '企业名称不能为空且不能超过 120 字');
        const slug = textInput(input.slug, 80, 'invalid_organization_slug', '企业标识不正确').toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(slug)) fail(400, 'invalid_organization_slug', '企业标识需为 3-80 位小写字母、数字或连字符');
        const ownerUserId = textInput(input.ownerUserId, 100, 'invalid_owner_user', '请选择企业主管理');
        if (!getUser(ownerUserId)) fail(404, 'user_not_found', '所选主管理用户不存在');
        const modules = Object.fromEntries(moduleKeys.map(key => [key, true]));
        if (input.modules !== undefined) {
          objectInput(input.modules, moduleKeys);
          if (Object.values(input.modules).some(value => typeof value !== 'boolean')) fail(400, 'invalid_organization_modules', '企业功能开关必须为布尔值');
          Object.assign(modules, input.modules);
        }
        if (db.prepare('SELECT 1 FROM organizations WHERE slug = ?').get(slug)) fail(409, 'organization_slug_exists', '企业标识已存在');
        const organizationId = `org_${randomUUID()}`;
        const timestamp = new Date().toISOString();
        db.prepare('INSERT INTO organizations(id, slug, name, created_at) VALUES(?, ?, ?, ?)').run(organizationId, slug, name, timestamp);
        db.prepare("INSERT INTO memberships(id, organization_id, user_id, role, created_at) VALUES(?, ?, ?, 'owner', ?)")
          .run(`membership_${randomUUID()}`, organizationId, ownerUserId, timestamp);
        const insertModule = db.prepare('INSERT INTO organization_modules(organization_id, module_key, enabled, updated_at) VALUES(?, ?, ?, ?)');
        for (const [key, enabled] of Object.entries(modules)) insertModule.run(organizationId, key, enabled ? 1 : 0, timestamp);
        this.addAudit({ organizationId, userId: actorUserId, action: 'organization.create', entityType: 'organization', entityId: organizationId,
          metadata: { scope: 'platform', name, slug, ownerUserId, modules } });
        return { ...organizationResult(organizationId), memberCount: 1, projectCount: 0, createdAt: timestamp };
      });
    }
  });
  return api;
}

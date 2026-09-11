import { OrganizationAccessError } from './organization-access.js';

function fail(status, code, message) { throw new OrganizationAccessError(status, code, message); }
function managerId(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) {
    fail(400, 'invalid_manager', '直属上级格式不正确');
  }
  return value.trim();
}

export function instrumentOrganizationAssignments(api, db) {
  const transact = callback => {
    db.exec('SAVEPOINT organization_assignment_write');
    try {
      const result = callback();
      db.exec('RELEASE organization_assignment_write');
      return result;
    } catch (error) {
      db.exec('ROLLBACK TO organization_assignment_write');
      db.exec('RELEASE organization_assignment_write');
      throw error;
    }
  };
  const findMember = (organizationId, userId) => db.prepare(`SELECT m.*, u.username,
    COALESCE(NULLIF(m.display_name_override, ''), u.display_name) AS display_name, d.name AS department_name
    FROM memberships m JOIN users u ON u.id = m.user_id
    LEFT JOIN organization_departments d ON d.organization_id = m.organization_id AND d.id = m.department_id
    WHERE m.organization_id = ? AND m.user_id = ?`).get(organizationId, userId);
  const access = (organizationId, actorUserId) => {
    const role = findMember(organizationId, actorUserId)?.role;
    return { role, enabled: role === 'owner' || (role === 'admin' && api.getMemberPermissions(organizationId, actorUserId)['member.manage']) };
  };
  const scopeFor = (organizationId, actorUserId, actor) => {
    const rows = db.prepare('SELECT user_id, role, manager_user_id FROM memberships WHERE organization_id = ? ORDER BY created_at, user_id').all(organizationId);
    const byId = new Map(rows.map(row => [row.user_id, row]));
    const children = new Map();
    for (const row of rows) {
      if (!children.has(row.manager_user_id)) children.set(row.manager_user_id, []);
      children.get(row.manager_user_id).push(row.user_id);
    }
    const descendants = rootId => {
      const result = new Set();
      const pending = [rootId];
      while (pending.length) {
        const userId = pending.pop();
        if (result.has(userId)) continue;
        result.add(userId);
        pending.push(...(children.get(userId) || []));
      }
      return result;
    };
    const ownBranch = descendants(actorUserId);
    const canMove = userId => {
      const row = byId.get(userId);
      if (!actor.enabled || !row || row.role === 'owner' || userId === actorUserId) return false;
      if (actor.role === 'owner') return true;
      return row.role === 'member' && (ownBranch.has(userId) || !row.manager_user_id)
        && [...descendants(userId)].every(id => byId.get(id)?.role === 'member');
    };
    return { byId, descendants, canMove,
      canReceive: userId => Boolean(actor.enabled && byId.has(userId) && (actor.role === 'owner' || ownBranch.has(userId))),
      canEdit: userId => actor.role === 'owner' || canMove(userId) };
  };
  const projectMember = (row, scope) => ({
    id: row.user_id, username: row.username, displayName: row.display_name, role: row.role,
    jobTitle: row.job_title || '', departmentId: row.department_id || null, departmentName: row.department_name || '',
    managerUserId: row.manager_user_id || null,
    canMove: scope.canMove(row.user_id), canReceive: scope.canReceive(row.user_id), canEdit: scope.canEdit(row.user_id)
  });
  const validateDestination = (scope, member, managerUserId) => {
    const visited = new Set([member.user_id]);
    let currentId = managerUserId;
    while (currentId) {
      if (visited.has(currentId)) fail(400, 'reporting_cycle', '直属上级不能是本人或自己的下级');
      visited.add(currentId);
      const manager = scope.byId.get(currentId);
      if (!manager) fail(404, 'manager_not_found', '直属上级不存在或不属于当前企业');
      if (currentId === managerUserId && member.role === 'admin' && manager.role === 'member') {
        fail(400, 'invalid_manager_role', '企业副管理的直属上级必须是管理者');
      }
      currentId = manager.manager_user_id;
    }
    if (managerUserId && !scope.canReceive(managerUserId)) fail(403, 'reporting_scope_denied', '只能分配到本人或自己的下级');
  };
  const createOrganizationMember = api.createOrganizationMember.bind(api);
  const updateOrganizationMember = api.updateOrganizationMember.bind(api);
  Object.assign(api, {
    getOrganizationAssignmentBoard(organizationId, actorUserId) {
      const chart = this.getOrganizationChart(organizationId, actorUserId);
      const actor = access(organizationId, actorUserId);
      const scope = scopeFor(organizationId, actorUserId, actor);
      const visibleIds = new Set(chart.members.map(member => member.id));
      const unassignedMembers = [];
      if (actor.enabled) {
        for (const row of scope.byId.values()) {
          if (row.manager_user_id || row.role === 'owner' || visibleIds.has(row.user_id) || !scope.canMove(row.user_id)) continue;
          const member = projectMember(findMember(organizationId, row.user_id), scope);
          unassignedMembers.push({ ...member, managerUserId: null, childCount: scope.descendants(row.user_id).size - 1 });
        }
      }
      return { ...chart,
        members: chart.members.map(member => ({ ...member, canMove: scope.canMove(member.id),
          canReceive: scope.canReceive(member.id), canEdit: scope.canEdit(member.id) })),
        unassignedMembers,
        capabilities: { canManageMembers: actor.enabled, canAssignMembers: actor.enabled, canAssignRoles: actor.role === 'owner' } };
    },
    updateOrganizationMemberReporting(organizationId, actorUserId, userId, input) {
      return transact(() => {
        const actor = access(organizationId, actorUserId);
        if (!actor.enabled) fail(403, 'organization_permission_denied', '没有调整成员归属的权限');
        if (!input || typeof input !== 'object' || Array.isArray(input)
          || Object.keys(input).some(key => !['managerUserId', 'expectedManagerUserId'].includes(key))
          || !Object.hasOwn(input, 'managerUserId') || !Object.hasOwn(input, 'expectedManagerUserId')) {
          fail(400, 'invalid_request', '请仅提供直属上级和调整前的直属上级');
        }
        const managerUserId = managerId(input.managerUserId);
        const expectedManagerUserId = managerId(input.expectedManagerUserId);
        const existing = findMember(organizationId, userId);
        if (!existing) fail(404, 'member_not_found', '成员不存在或不属于当前企业');
        // Concurrent pool claims must report a conflict before evaluating the new branch's scope.
        if ((existing.manager_user_id || null) !== expectedManagerUserId) {
          fail(409, 'reporting_assignment_conflict', '该成员的归属已被调整，请刷新后重试');
        }
        const scope = scopeFor(organizationId, actorUserId, actor);
        if (!scope.canMove(userId)) fail(403, 'reporting_scope_denied', '不能调整该成员或其下级的汇报关系');
        validateDestination(scope, existing, managerUserId);
        if (managerUserId === expectedManagerUserId) return projectMember(existing, scope);
        db.prepare('UPDATE memberships SET manager_user_id = ? WHERE organization_id = ? AND user_id = ?')
          .run(managerUserId, organizationId, userId);
        this.addAudit({ organizationId, userId: actorUserId, action: 'organization.member.reporting.update',
          entityType: 'membership', entityId: `${organizationId}:${userId}`,
          metadata: { memberUserId: userId, from: { managerUserId: expectedManagerUserId }, to: { managerUserId } } });
        return projectMember(findMember(organizationId, userId), scopeFor(organizationId, actorUserId, actor));
      });
    },
    createOrganizationMember(organizationId, actorUserId, input) {
      if (input?.managerUserId !== null) return createOrganizationMember(organizationId, actorUserId, input);
      return transact(() => {
        const member = createOrganizationMember(organizationId, actorUserId, { ...input, managerUserId: actorUserId });
        this.updateOrganizationMemberReporting(organizationId, actorUserId, member.id,
          { managerUserId: null, expectedManagerUserId: actorUserId });
        return { ...member, managerUserId: null };
      });
    },
    updateOrganizationMember(organizationId, actorUserId, userId, input) {
      return transact(() => {
        const actor = access(organizationId, actorUserId);
        const existing = findMember(organizationId, userId);
        if (actor.enabled && actor.role !== 'owner' && existing?.role === 'member' && userId !== actorUserId
          && input?.managerUserId !== undefined
          && input.managerUserId !== (existing.manager_user_id || null)
          && !scopeFor(organizationId, actorUserId, actor).canMove(userId)) {
          fail(403, 'reporting_scope_denied', '不能调整该成员或其下级的汇报关系');
        }
        return updateOrganizationMember(organizationId, actorUserId, userId, input);
      });
    }
  });
  return api;
}

export function registerOrganizationAssignmentRoutes(router, { db, requireAuth, jsonError = (ctx, status, error, message) => {
  ctx.status = status;
  ctx.body = { error, message };
} }) {
  const action = callback => ctx => {
    try { callback(ctx, ctx.state.session); }
    catch (error) {
      if (!(error instanceof OrganizationAccessError)) throw error;
      jsonError(ctx, error.status, error.code, error.message);
    }
  };
  router.get('/organization/assignment-board', requireAuth, action((ctx, session) => {
    ctx.body = db.getOrganizationAssignmentBoard(session.organizationId, session.userId);
  }));
  router.put('/organization/members/:userId/reporting', requireAuth, action((ctx, session) => {
    ctx.body = { member: db.updateOrganizationMemberReporting(session.organizationId, session.userId, ctx.params.userId, ctx.request.body) };
  }));
}

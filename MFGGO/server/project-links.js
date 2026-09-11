import { randomUUID } from 'node:crypto';
import { enterpriseCan } from '../access-policy.js';

export class ProjectLinkError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
const fail = (status, code, message) => { throw new ProjectLinkError(status, code, message); };
const summary = project => ({ id: project.id, title: project.title, stage: project.stage,
  rootTaskId: project.rootTaskId, owner: project.owner, dueAt: project.dueAt });
const targetId = value => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) {
    fail(400, 'invalid_project_link', '请选择要关联的项目');
  }
  return value.trim();
};

export function instrumentProjectLinks(api, db) {
  const transaction = operation => {
    const savepoint = `project_link_${randomUUID().replaceAll('-', '')}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try { const result = operation(); db.exec(`RELEASE SAVEPOINT ${savepoint}`); return result; }
    catch (error) { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`); throw error; }
  };
  transaction(() => db.exec(`CREATE TABLE IF NOT EXISTS project_links (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    target_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(organization_id, project_id, target_project_id),
    CHECK(project_id <> target_project_id)
  );
  CREATE INDEX IF NOT EXISTS idx_project_links_target ON project_links(target_project_id);`));

  const authorize = (organizationId, userId, projectId, write = false) => {
    const membership = api.getMembership(userId, organizationId);
    if (!membership) fail(403, 'project_link_access_denied', '无权访问此企业的关联项目');
    const actor = { role: membership.role, permissions: api.getMemberPermissions(organizationId, userId) };
    if (!api.listOrganizationModules(organizationId).projects) fail(403, 'module_disabled', '当前企业未启用项目模块');
    if (!enterpriseCan(actor, 'project.read') || write && !enterpriseCan(actor, 'project.write')) {
      fail(403, 'project_link_permission_denied', '未获得管理项目资料权限');
    }
    const project = api.getProject(organizationId, projectId);
    if (!project) fail(404, 'project_not_found', '项目不存在或已移入回收站');
    if (!['owner', 'admin'].includes(actor.role) && !api.isProjectMember(organizationId, projectId, userId)) {
      fail(403, 'project_access_denied', '当前成员未加入此项目');
    }
    return actor;
  };
  const linkedIds = (organizationId, projectId) => db.prepare(`SELECT target_project_id FROM project_links
    WHERE organization_id = ? AND project_id = ? ORDER BY created_at, target_project_id`).all(organizationId, projectId).map(row => row.target_project_id);
  const visibleProjects = (organizationId, userId, actor) => api.listProjectsForUser(organizationId, userId, actor.role);
  const list = (organizationId, userId, projectId, actor) => {
    const visible = new Map(visibleProjects(organizationId, userId, actor).map(project => [project.id, project]));
    return { projects: linkedIds(organizationId, projectId).filter(id => visible.has(id)).map(id => summary(visible.get(id))),
      capabilities: { canWrite: enterpriseCan(actor, 'project.write') } };
  };
  const authorizedTarget = (organizationId, userId, projectId, requestedId, actor) => {
    const id = targetId(requestedId);
    if (id === projectId) fail(400, 'project_link_self', '项目不能关联自身');
    const target = api.getProject(organizationId, id);
    if (!target || !['owner', 'admin'].includes(actor.role) && !api.isProjectMember(organizationId, id, userId)) {
      fail(404, 'linked_project_not_found', '关联项目不存在或无权访问');
    }
    return target;
  };

  api.listProjectLinks = (organizationId, userId, projectId) => {
    const actor = authorize(organizationId, userId, projectId);
    return list(organizationId, userId, projectId, actor);
  };
  api.listProjectLinkCandidates = (organizationId, userId, projectId) => {
    const actor = authorize(organizationId, userId, projectId, true);
    const excluded = new Set([projectId, ...linkedIds(organizationId, projectId)]);
    return { projects: visibleProjects(organizationId, userId, actor).filter(project => !excluded.has(project.id)).map(summary) };
  };
  api.addProjectLink = (organizationId, userId, projectId, input) => transaction(() => {
    const actor = authorize(organizationId, userId, projectId, true);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'projectId')) {
      fail(400, 'invalid_project_link', '关联项目包含不支持的字段');
    }
    const target = authorizedTarget(organizationId, userId, projectId, input.projectId, actor);
    const result = db.prepare(`INSERT OR IGNORE INTO project_links(organization_id, project_id, target_project_id, created_by_user_id, created_at)
      VALUES(?, ?, ?, ?, ?)`).run(organizationId, projectId, target.id, userId, new Date().toISOString());
    if (result.changes) api.addAudit({ organizationId, userId, action: 'project.link.add', entityType: 'project', entityId: projectId,
      metadata: { targetProjectId: target.id } });
    return list(organizationId, userId, projectId, actor);
  });
  api.removeProjectLink = (organizationId, userId, projectId, requestedId) => transaction(() => {
    const actor = authorize(organizationId, userId, projectId, true);
    const target = authorizedTarget(organizationId, userId, projectId, requestedId, actor);
    const result = db.prepare('DELETE FROM project_links WHERE organization_id = ? AND project_id = ? AND target_project_id = ?')
      .run(organizationId, projectId, target.id);
    if (result.changes) api.addAudit({ organizationId, userId, action: 'project.link.remove', entityType: 'project', entityId: projectId,
      metadata: { targetProjectId: target.id } });
    return list(organizationId, userId, projectId, actor);
  });
  return api;
}

export function registerProjectLinkRoutes(router, { db, requireAuth, jsonError }) {
  const handle = operation => ctx => {
    try { operation(ctx); }
    catch (error) {
      if (!(error instanceof ProjectLinkError)) throw error;
      jsonError(ctx, error.status, error.code, error.message);
    }
  };
  const args = ctx => [ctx.state.session.organizationId, ctx.state.session.userId, ctx.params.projectId];
  router.get('/projects/:projectId/links', requireAuth, handle(ctx => { ctx.body = db.listProjectLinks(...args(ctx)); }));
  router.get('/projects/:projectId/links/candidates', requireAuth, handle(ctx => { ctx.body = db.listProjectLinkCandidates(...args(ctx)); }));
  router.post('/projects/:projectId/links', requireAuth, handle(ctx => { ctx.body = db.addProjectLink(...args(ctx), ctx.request.body); }));
  router.delete('/projects/:projectId/links/:targetProjectId', requireAuth, handle(ctx => { ctx.body = db.removeProjectLink(...args(ctx), ctx.params.targetProjectId); }));
}

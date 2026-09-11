import { OrganizationAccessError } from './organization-access.js';

export function registerOrganizationRoutes(router, { db, requireAuth, jsonError = (ctx, status, error, message) => {
  ctx.status = status;
  ctx.body = { error, message };
} }) {
  const organizationAction = callback => ctx => {
    const session = ctx.state.session;
    try {
      callback(ctx, session);
    } catch (error) {
      if (!(error instanceof OrganizationAccessError)) throw error;
      jsonError(ctx, error.status, error.code, error.message);
    }
  };
  router.get('/organization/structure', requireAuth, organizationAction((ctx, session) => {
    ctx.body = db.getOrganizationStructure(session.organizationId, session.userId);
  }));
  router.get('/organization/tree', requireAuth, organizationAction((ctx, session) => {
    ctx.body = db.getOrganizationChart(session.organizationId, session.userId);
  }));
  router.post('/organization/departments', requireAuth, organizationAction((ctx, session) => {
    ctx.body = { department: db.createOrganizationDepartment(session.organizationId, session.userId, ctx.request.body) };
    ctx.status = 201;
  }));
  router.put('/organization/departments/:departmentId', requireAuth, organizationAction((ctx, session) => {
    ctx.body = { department: db.updateOrganizationDepartment(session.organizationId, session.userId, ctx.params.departmentId, ctx.request.body) };
  }));
  router.delete('/organization/departments/:departmentId', requireAuth, organizationAction((ctx, session) => {
    db.deleteOrganizationDepartment(session.organizationId, session.userId, ctx.params.departmentId);
    ctx.body = { ok: true };
  }));
  router.put('/organization/members/:userId', requireAuth, organizationAction((ctx, session) => {
    ctx.body = { member: db.updateOrganizationMember(session.organizationId, session.userId, ctx.params.userId, ctx.request.body) };
  }));
  router.get('/me/profile', requireAuth, organizationAction((ctx, session) => {
    ctx.body = db.getMemberProfile(session.organizationId, session.userId);
  }));
  router.put('/me/profile', requireAuth, organizationAction((ctx, session) => {
    ctx.body = { member: db.updateMemberProfile(session.organizationId, session.userId, ctx.request.body) };
  }));
}

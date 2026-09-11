import { PlatformAccessError } from './platform-access.js';

export function registerPlatformRoutes(router, { db, requireAuth, jsonError = (ctx, status, error, message) => {
  ctx.status = status;
  ctx.body = { error, message };
} }) {
  const action = callback => ctx => {
    try { callback(ctx, ctx.state.session); }
    catch (error) {
      if (!(error instanceof PlatformAccessError)) throw error;
      jsonError(ctx, error.status, error.code, error.message);
    }
  };
  router.get('/platform/administrators', requireAuth, action((ctx, session) => {
    ctx.body = db.getPlatformAdministrators(session.userId);
  }));
  router.put('/platform/administrators/:userId', requireAuth, action((ctx, session) => {
    ctx.body = { administrator: db.updatePlatformAdministrator(session.userId, ctx.params.userId, ctx.request.body) };
  }));
  router.get('/platform/owner-candidates', requireAuth, action((ctx, session) => {
    ctx.body = { candidates: db.getPlatformOwnerCandidates(session.userId, ctx.query.organizationId || null) };
  }));
  router.put('/platform/organizations/:organizationId/owner', requireAuth, action((ctx, session) => {
    ctx.body = { organization: db.replacePlatformOrganizationOwner(session.userId, ctx.params.organizationId, ctx.request.body) };
  }));
}

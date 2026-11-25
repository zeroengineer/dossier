// `GET /api/dashboard?days=7|30|90`: the dashboard summary (src/services/dashboard.js). Read-only.
import { dashboardSummary } from '../../services/dashboard.js';

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object, now?: () => Date }} opts now: the clock "today" comes from (buildServer's `now`)
 */
export default async function dashboardRoutes(app, { ctx, now = () => new Date() }) {
  app.get('/api/dashboard', (req) => dashboardSummary(ctx, { days: req.query.days ?? 30, now: now() }));
}

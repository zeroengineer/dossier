// `GET /api/dashboard?days=7|30|90`: the dashboard summary (src/services/dashboard.js). Read-only.
import { dashboardSummary } from '../../services/dashboard.js';

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object }} opts
 */
export default async function dashboardRoutes(app, { ctx }) {
  app.get('/api/dashboard', (req) => dashboardSummary(ctx, { days: req.query.days ?? 30 }));
}

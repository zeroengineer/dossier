import { getNode } from '../../services/hierarchy.js';

/**
 * Folder tree: `GET /api/tree` (`?node=<id>` for one folder, the root without it).
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object }} opts
 */
export default async function vaultRoutes(app, { ctx }) {
  app.get('/api/tree', (req) => getNode(ctx, req.query.node ?? ''));
}

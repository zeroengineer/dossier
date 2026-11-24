import { getNode } from '../../services/hierarchy.js';
import { treePage } from '../views/tree.js';
import { sendPage, shellOf } from '../http.js';

/**
 * Folder tree: `/` (page, `?node=<id>` for one folder) and `GET /api/tree` (`?node=`).
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object }} opts
 */
export default async function vaultRoutes(app, { ctx }) {
  app.get('/', (req, reply) => sendPage(reply, treePage({ node: getNode(ctx, req.query.node ?? ''), shell: shellOf(ctx) })));
  app.get('/api/tree', (req) => getNode(ctx, req.query.node ?? ''));
}

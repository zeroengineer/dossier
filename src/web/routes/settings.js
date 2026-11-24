import { settingsPage } from '../views/settings.js';
import { sendPage, shellOf } from '../http.js';

/**
 * Read-only settings page.
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object }} opts
 */
export default async function settingsRoutes(app, { ctx }) {
  app.get('/settings', (req, reply) => sendPage(reply, settingsPage({
    shell: shellOf(ctx),
    info: {
      home: ctx.config.home,
      dataDir: ctx.config.dataDir,
      workspace: ctx.ws.config.name,
      defaultBrand: ctx.ws.config.defaultBrand,
      user: ctx.user,
      brands: [...ctx.ws.brands.values()].map((b) => ({ id: b.id, name: b.legalName, signatories: (b.signatories ?? []).map((s) => `${s.name} (${s.id})`) })),
      series: [...ctx.ws.series.values()].map((s) => ({ id: s.id, pattern: s.pattern, scope: s.scope })),
    },
  })));
}

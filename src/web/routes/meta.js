// `GET /api/me` (who is acting, which workspace) and `GET /api/meta` (the enumerations and rules the web app reads
// instead of duplicating them). Read-only; no business logic.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../paths.js';
import { STATUSES, TRANSITIONS } from '../../domain/status.js';
import { LEVELS } from '../../domain/sensitivity.js';
import {
  CLEARANCES, DOCUMENT_ENTITY_ROLES, DOCUMENT_RELATION_TYPES, ENTITY_KINDS, ENTITY_RELATION_ROLES, FIELD_TYPES, PARTY_TYPES,
  TEMPLATE_CATEGORIES,
} from '../../domain/enums.js';
import { DEFAULT_LEAF, DEFAULT_ROUTES, TOP_KEYS, TOP_LEAVES, TOP_LEVEL } from '../../domain/routing.js';
import { FONT_WEIGHTS, SERIES_SCOPES } from '../../workspace/schemas.js';
import { ASSET_MAX_BYTES, builtinFonts } from '../../services/workspaceFiles.js';

const VERSION = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ ctx: object, fileSizeLimit: number }} opts fileSizeLimit: the server's upload limit in bytes
 */
export default async function metaRoutes(app, { ctx, fileSizeLimit }) {
  app.get('/api/me', () => ({
    user: { id: ctx.user.id, clearance: ctx.user.clearance },
    workspace: {
      name: ctx.ws.config.name,
      defaultBrand: ctx.ws.config.defaultBrand,
      locale: ctx.ws.config.locale,
      home: ctx.config.home,
      dataDir: ctx.config.dataDir,
    },
    brands: [...ctx.ws.brands.values()].map((b) => ({ id: b.id, legalName: b.legalName, shortName: b.shortName })),
    version: VERSION,
  }));

  app.get('/api/meta', () => ({
    statuses: STATUSES,
    transitions: TRANSITIONS,
    sensitivityLevels: LEVELS,
    clearances: CLEARANCES,
    relationTypes: DOCUMENT_RELATION_TYPES,
    entityRoles: DOCUMENT_ENTITY_ROLES,
    partyTypes: PARTY_TYPES,
    entityKinds: ENTITY_KINDS,
    entityRelationRoles: ENTITY_RELATION_ROLES,
    seriesScopes: SERIES_SCOPES,
    fontWeights: FONT_WEIGHTS,
    builtinFonts: builtinFonts(),
    documentTypes: Object.keys(DEFAULT_ROUTES),
    hierarchy: { topLevel: TOP_LEVEL, topKeys: TOP_KEYS, leaves: TOP_LEAVES, defaultLeaf: DEFAULT_LEAF },
    templateCategories: TEMPLATE_CATEGORIES,
    fieldTypes: FIELD_TYPES,
    limits: { assetMaxBytes: ASSET_MAX_BYTES, uploadMaxBytes: fileSizeLimit },
  }));
}

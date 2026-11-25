import { z } from 'zod';
import { normaliseName } from '../domain/canonical.js';
import { parseRouteValue } from '../domain/routing.js';
import { patternTokens, yearBasis } from '../domain/numbering.js';
import { CLEARANCES, ENTITY_KINDS, ENTITY_RELATION_ROLES } from '../domain/enums.js';


// Re-exported for existing importers; defined in src/domain/enums.js.
export { CLEARANCES, ENTITY_KINDS, ENTITY_RELATION_ROLES };
export const SERIES_SCOPES = ['global', 'brand', 'brand+year', 'brand+year+client', 'brand+year+code'];
export const FONT_WEIGHTS = ['regular', 'medium', 'semibold', 'bold', 'extrabold', 'light', 'extralight'];

/** Default brand palette (DISCOVERY A2, neutral family). */
export const PALETTE_DEFAULTS = Object.freeze({
  ink: '#1a1a1a', body: '#333333', label: '#555555', muted: '#666666', faint: '#888888', subtle: '#999999',
  rule: '#e8e8e8', ruleStrong: '#d0d0d0', ruleFaint: '#f0f0f0',
  fill: '#fbfbfb', fillAlt: '#f8f8f8', fillTotal: '#f1f1f1', fillPanel: '#f9f9f9',
  section: '#606f7b', accent: '#1a1a1a', white: '#ffffff',
});

/** Default font per weight: bundled Manrope. */
export const FONT_DEFAULTS = Object.freeze({
  regular: 'builtin:Manrope-Regular', medium: 'builtin:Manrope-Medium', semibold: 'builtin:Manrope-SemiBold',
  bold: 'builtin:Manrope-Bold', extrabold: 'builtin:Manrope-ExtraBold', light: 'builtin:Manrope-Light',
  extralight: 'builtin:Manrope-ExtraLight',
});

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'must be lowercase letters, digits, "-" or "_"');
const text = z.string();
const nonEmpty = z.string().min(1, 'must not be empty');
/** A type keyword or phrase: needs at least one letter or digit (punctuation alone would match nothing usefully). */
const keyword = z.string().refine((s) => /[\p{L}\p{N}]/u.test(s), 'must contain a letter or digit');
const colour = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'must be a hex colour like #1a1a1a');

// ---------- workspace.json ----------

export const WorkspaceSchema = z.object({
  name: nonEmpty,
  defaultBrand: id,
  locale: z.object({
    currencySymbol: text.default('₹'),
    currencyCode: z.string().regex(/^[A-Z]{3}$/, 'must be a 3-letter ISO code').default('INR'),
    numberLocale: text.default('en-IN'),
    dateFormats: z.object({
      short: text.default('DD/MM/YYYY'),
      long: text.default('D MMMM YYYY'),
      us: text.default('MMMM D, YYYY'),
    }).prefault({}),
    currencyWords: z.object({
      major: text.default('Rupees'),
      minor: text.default('Paise'),
      suffix: text.default('Only'),
    }).prefault({}),
  }).prefault({}),
  users: z.record(z.string(), z.object({ clearance: z.enum(CLEARANCES).default('Confidential') }).prefault({})).default({}),
  hierarchy: z.object({
    topLevel: z.array(nonEmpty).length(10, 'must list exactly 10 top-level folder names').optional(),
    routing: z.record(z.string(), nonEmpty).optional(),
  }).superRefine((h, ctx) => {
    for (const [type, value] of Object.entries(h.routing ?? {})) {
      if (parseRouteValue(value, h.topLevel).top === 'restricted') {
        ctx.addIssue({ code: 'custom', path: ['routing', type], message: 'cannot route to the Restricted folder: only Restricted sensitivity places a document there' });
      }
    }
  }).prefault({}),
  import: z.strictObject({
    // Extra type keywords for `dossier import`, merged over the built-ins (src/domain/doctypes.js).
    typeKeywords: z.record(z.string().refine((t) => /\S/.test(t), 'a type name must not be blank'), z.strictObject({
      names: z.array(keyword).default([]),
      text: z.array(keyword).default([]),
    })).default({}),
  }).prefault({}),
});

// ---------- brand.json ----------

const ContactSchema = z.object({ email: text.optional(), phone: text.optional(), website: text.optional() });

const SignatorySchema = z.object({
  id,
  name: nonEmpty,
  title: nonEmpty,
  titleLong: text.optional(),
  signature: text.optional(),
  signatureLarge: text.optional(),
  email: text.optional(),
  phone: text.optional(),
});

const TaxModeSchema = z.object({
  id,
  label: nonEmpty,
  rates: z.array(z.object({ label: nonEmpty, rate: z.number().min(0).max(1) })).default([]),
});

const paletteShape = Object.fromEntries(Object.entries(PALETTE_DEFAULTS).map(([k, v]) => [k, colour.default(v)]));
const fontsShape = Object.fromEntries(Object.entries(FONT_DEFAULTS).map(([k, v]) => [k, nonEmpty.default(v)]));

export const BrandSchema = z.object({
  id,
  inheritsFrom: id.optional(),
  legalName: nonEmpty,
  shortName: nonEmpty,
  registrations: z.array(z.object({ label: nonEmpty, value: nonEmpty })).default([]),
  addresses: z.object({ business: z.array(text).min(1, 'needs at least one line'), registered: z.array(text).optional() }),
  contacts: z.record(z.string(), ContactSchema).refine((c) => 'default' in c, { message: 'must contain a "default" contact' }),
  bankAccounts: z.array(z.object({
    accountName: nonEmpty, bankName: nonEmpty, accountNumber: nonEmpty,
    ifsc: text.optional(), swift: text.optional(), branch: text.optional(),
  })).default([]),
  letterhead: z.object({ lines: z.array(text).default([]) }).prefault({}),
  footer: z.object({ left: text.default(''), center: text.default(''), right: text.default('') }).prefault({}),
  palette: z.looseObject(paletteShape).prefault({}),
  fonts: z.object(fontsShape).prefault({}),
  assets: z.object({ logo: nonEmpty.default('assets/logo.png'), seal: text.optional(), watermark: text.optional() }).prefault({}),
  signatories: z.array(SignatorySchema).default([]),
  defaultSignatory: z.record(z.string(), id).default({}),
  // Signatory printed as the project contact in proposal sign-offs.
  projectContact: id.optional(),
  strings: z.record(z.string(), text).default({}),
  tax: z.object({
    modes: z.array(TaxModeSchema).min(1).default([{ id: 'none', label: 'No tax', rates: [] }]),
    defaultMode: id.default('none'),
    defaultHsn: text.optional(),
  }).prefault({}).superRefine((tax, ctx) => {
    if (!tax.modes.some((m) => m.id === tax.defaultMode)) {
      ctx.addIssue({ code: 'custom', path: ['defaultMode'], message: `"${tax.defaultMode}" is not one of tax.modes (${tax.modes.map((m) => m.id).join(', ')})` });
    }
  }),
  series: z.record(z.string(), id).default({}),
  layoutProfiles: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  templateParams: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
}).superRefine((b, ctx) => {
  const seen = new Set();
  b.signatories.forEach((s, i) => {
    if (seen.has(s.id)) ctx.addIssue({ code: 'custom', path: ['signatories', i, 'id'], message: `duplicate signatory id "${s.id}"` });
    seen.add(s.id);
  });
  for (const [key, sid] of Object.entries(b.defaultSignatory)) {
    if (!seen.has(sid)) ctx.addIssue({ code: 'custom', path: ['defaultSignatory', key], message: `unknown signatory "${sid}"` });
  }
  if (b.projectContact !== undefined && !seen.has(b.projectContact)) {
    ctx.addIssue({ code: 'custom', path: ['projectContact'], message: `unknown signatory "${b.projectContact}"` });
  }
});

// ---------- series.json ----------

const SeriesSchema = z.object({
  id,
  pattern: nonEmpty,
  scope: z.enum(SERIES_SCOPES).default('brand+year'),
  start: z.number().int().min(0).default(1),
  counter: id.optional(),
});

export const SeriesFileSchema = z.array(SeriesSchema).superRefine((list, ctx) => {
  const ids = new Set();
  list.forEach((s, i) => {
    if (ids.has(s.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: `duplicate series id "${s.id}"` });
    ids.add(s.id);
  });
  const validPattern = new Set();
  list.forEach((s, i) => {
    try {
      const tokens = patternTokens(s.pattern);
      validPattern.add(s);
      if (s.scope === 'brand+year+code' && !tokens.some((t) => t.token === 'CODE')) {
        ctx.addIssue({ code: 'custom', path: [i, 'scope'], message: 'scope brand+year+code needs a {CODE} token in the pattern' });
      }
    } catch (err) {
      ctx.addIssue({ code: 'custom', path: [i, 'pattern'], message: err.message });
    }
  });
  list.forEach((s, i) => {
    if (!s.counter) return;
    const owner = list.find((o) => o.id === s.counter);
    if (!owner) {
      ctx.addIssue({ code: 'custom', path: [i, 'counter'], message: `unknown series "${s.counter}"` });
      return;
    }
    if (owner.counter && owner.counter !== owner.id) {
      ctx.addIssue({ code: 'custom', path: [i, 'counter'], message: `counter must name a series that owns its counter ("${owner.id}" shares "${owner.counter}")` });
      return;
    }
    // Sharers must build the same counter keys as the owner, or the shared counter silently splits.
    if (owner.scope !== s.scope) {
      ctx.addIssue({ code: 'custom', path: [i, 'scope'], message: `shares the counter of "${owner.id}", so its scope must be "${owner.scope}"` });
    } else if (validPattern.has(s) && validPattern.has(owner) && s.scope.includes('year') && yearBasis(s.pattern) !== yearBasis(owner.pattern)) {
      ctx.addIssue({ code: 'custom', path: [i, 'pattern'], message: `shares the counter of "${owner.id}", so it must count by the same year ({YYYY} or {FY})` });
    }
  });
}).transform((list) => list.map((s) => ({ ...s, counter: s.counter ?? s.id })));

// ---------- seeds/entities.json ----------

const EntityRef = z.object({ kind: z.enum(ENTITY_KINDS), name: nonEmpty });

export const SeedsSchema = z.object({
  entities: z.array(z.object({
    kind: z.enum(ENTITY_KINDS),
    name: nonEmpty,
    aliases: z.array(nonEmpty).default([]),
    attrs: z.record(z.string(), z.unknown()).default({}),
    brand: id.optional(),
  })).default([]),
  relations: z.array(z.object({ from: EntityRef, to: EntityRef, role: z.enum(ENTITY_RELATION_ROLES) })).default([]),
}).superRefine((seeds, ctx) => {
  const key = (r) => `${r.kind}\u0000${normaliseName(r.name)}`;
  const known = new Set();
  seeds.entities.forEach((e, i) => {
    if (known.has(key(e))) ctx.addIssue({ code: 'custom', path: ['entities', i, 'name'], message: `duplicate ${e.kind} "${e.name}"` });
    known.add(key(e));
  });
  seeds.relations.forEach((r, i) => {
    for (const end of ['from', 'to']) {
      if (!known.has(key(r[end]))) ctx.addIssue({ code: 'custom', path: ['relations', i, end], message: `no seeded ${r[end].kind} named "${r[end].name}"` });
    }
  });
});

/**
 * Format a ZodError as one "path: message" line per issue.
 * @param {import('zod').ZodError} error
 * @returns {string}
 */
export function formatIssues(error) {
  return error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`).join('\n');
}

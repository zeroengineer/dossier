// Schema of a template folder's `template.json` (docs/TEMPLATES.md).
import { z } from 'zod';
import { ENTITY_KINDS, formatIssues } from './schemas.js';
import { LEVELS } from '../domain/sensitivity.js';
import { DOCUMENT_RELATION_TYPES, PARTY_TYPES } from '../services/documentQueries.js';
import { PROFILES } from '../render/pdf/profiles.js';

export const TEMPLATE_CATEGORIES = Object.freeze(['invoice', 'letter', 'statement', 'agreement', 'proposal', 'report', 'resolution']);
export const TEMPLATE_RENDITIONS = Object.freeze(['pdf', 'html', 'md']);
export const FIELD_TYPES = Object.freeze(['string', 'text', 'date', 'money', 'number', 'enum', 'entity', 'array', 'object', 'boolean']);

/** Field sources that need no argument. */
const PLAIN_SOURCES = ['ask', 'today', 'brand', 'signatory'];
const PATH = /^[A-Za-z_$][\w$]*(?:(?:\.[\w$]+)|(?:\[\d+\]))*$/;
const FIELD_NAME = /^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*$/;

/**
 * Classify a field source string. Returns `{ kind, arg }` with kind one of `ask`, `today`, `brand`, `brandPath`,
 * `entity`, `signatory`, `computed`, `const`, `fieldPath`, or `{ error }` when the syntax is wrong.
 * @param {string} source
 * @returns {{ kind: string, arg?: any, root?: string } | { error: string }}
 */
export function parseSource(source) {
  if (PLAIN_SOURCES.includes(source)) return { kind: source };
  if (source.startsWith('brand.')) {
    const arg = source.slice(6);
    return PATH.test(arg) ? { kind: 'brandPath', arg } : { error: `bad brand path "${arg}"` };
  }
  if (source.startsWith('entity:')) {
    const arg = source.slice(7);
    return ENTITY_KINDS.includes(arg) ? { kind: 'entity', arg } : { error: `unknown entity kind "${arg}" (expected one of ${ENTITY_KINDS.join(', ')})` };
  }
  if (source.startsWith('computed:')) {
    const arg = source.slice(9);
    return /^[A-Za-z_$][\w$]*$/.test(arg) ? { kind: 'computed', arg } : { error: `bad computed function name "${arg}"` };
  }
  if (source.startsWith('const:')) {
    try {
      return { kind: 'const', arg: JSON.parse(source.slice(6)) };
    } catch (e) {
      return { error: `const: value is not valid JSON (${e.message})` };
    }
  }
  if (PATH.test(source) && /[.[]/.test(source)) {
    return { kind: 'fieldPath', arg: source, root: source.split(/[.[]/)[0] };
  }
  return { error: `unknown source "${source}" (expected ask, today, brand, brand.<path>, entity:<kind>, signatory, computed:<name>, const:<json> or <field>.<path>)` };
}

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'must be lowercase letters, digits, "-" or "_"');
const nonEmpty = z.string().min(1, 'must not be empty');
const fieldType = z.enum(FIELD_TYPES);

const FieldSchema = z.strictObject({
  name: z.string().regex(FIELD_NAME, 'must be an identifier or a dotted path of identifiers'),
  label: z.string().optional(),
  source: nonEmpty,
  type: fieldType.optional(),
  required: z.boolean().default(false),
  enum: z.union([z.array(z.string()).min(1), nonEmpty]).optional(),
  default: z.unknown().optional(),
  item: z.record(z.string(), fieldType).optional(),
  help: z.string().optional(),
});

/** Zod schema for `template.json`. */
export const TemplateSchema = z.strictObject({
  id,
  version: z.number().int().min(1),
  type: nonEmpty,
  title: nonEmpty,
  description: z.string().optional(),
  category: z.enum(TEMPLATE_CATEGORIES),
  layoutProfile: z.enum(Object.keys(PROFILES)),
  partyType: z.enum(PARTY_TYPES),
  partyKind: z.enum(ENTITY_KINDS),
  sensitivity: z.enum(LEVELS),
  renditions: z.array(z.enum(TEMPLATE_RENDITIONS)).min(1).default([...TEMPLATE_RENDITIONS]),
  numbering: z.strictObject({ series: nonEmpty, required: z.boolean().default(true) }).nullable().default(null),
  contact: nonEmpty.default('default'),
  params: z.record(z.string(), z.unknown()).default({}),
  fields: z.array(FieldSchema),
  relations: z.array(z.strictObject({
    type: z.enum(DOCUMENT_RELATION_TYPES),
    field: nonEmpty,
    optional: z.boolean().default(false),
  })).default([]),
  leaf: nonEmpty.optional(),
}).superRefine((t, ctx) => {
  const seen = new Set();
  const roots = new Set();
  t.fields.forEach((f, i) => {
    if (seen.has(f.name)) ctx.addIssue({ code: 'custom', path: ['fields', i, 'name'], message: `duplicate field "${f.name}"` });
    const src = parseSource(f.source);
    if (src.error) {
      ctx.addIssue({ code: 'custom', path: ['fields', i, 'source'], message: src.error });
    } else if (src.kind === 'fieldPath' && !roots.has(src.root)) {
      ctx.addIssue({ code: 'custom', path: ['fields', i, 'source'], message: `"${src.root}" is not a field declared before "${f.name}"` });
    }
    if (f.item && f.type !== 'array') ctx.addIssue({ code: 'custom', path: ['fields', i, 'item'], message: 'only array fields take "item"' });
    if (f.enum !== undefined && f.type !== undefined && f.type !== 'enum' && f.type !== 'string') {
      ctx.addIssue({ code: 'custom', path: ['fields', i, 'enum'], message: `"enum" needs type "enum" or "string", not "${f.type}"` });
    }
    seen.add(f.name);
    roots.add(f.name.split('.')[0]);
  });
  t.relations.forEach((r, i) => {
    if (!seen.has(r.field)) ctx.addIssue({ code: 'custom', path: ['relations', i, 'field'], message: `no field "${r.field}"` });
  });
  if (t.numbering && t.numbering.series !== 'brand' && !/^[a-z0-9][a-z0-9_-]*$/.test(t.numbering.series)) {
    ctx.addIssue({ code: 'custom', path: ['numbering', 'series'], message: 'must be "brand" or a series id' });
  }
});

/**
 * Validate a parsed `template.json`. Returns `{ data }` or `{ error }` (one "path: message" line per issue).
 * @param {unknown} json
 * @returns {{ data: z.infer<typeof TemplateSchema> } | { error: string }}
 */
export function validateTemplateMeta(json) {
  const r = TemplateSchema.safeParse(json);
  return r.success ? { data: r.data } : { error: formatIssues(r.error) };
}

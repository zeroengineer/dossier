/**
 * Folder routing for the hierarchy view (PLAN B3): which top-level folder and which leaf a document type goes to.
 * Pure data and functions; no database.
 */

/** Default top-level folder names, in display order. A workspace may rename them (`hierarchy.topLevel`, exactly 10). */
export const TOP_LEVEL = Object.freeze([
  '01 Company', '02 People', '03 Clients', '04 Vendors', '05 Products',
  '06 Finance', '07 Templates', '08 References', '09 Group Entities', '10 Restricted',
]);

/** Stable keys of the ten top-level slots (same order as TOP_LEVEL). */
export const TOP_KEYS = Object.freeze([
  'company', 'people', 'clients', 'vendors', 'products', 'finance', 'templates', 'references', 'group', 'restricted',
]);

/** The top-level slot holding a party type's documents. */
export const PARTY_TOP = Object.freeze({
  Company: 'company', Person: 'people', Client: 'clients', Vendor: 'vendors', Product: 'products', GroupEntity: 'group',
});

/** Leaf used for a document type with no route, or whose leaf is not allowed in its folder. */
export const DEFAULT_LEAF = 'Other';

/**
 * Closed leaf sets per top-level slot (PLAN B3). Slots not listed (group entities, templates, references) accept any
 * leaf. `Other` is always allowed.
 */
export const TOP_LEAVES = Object.freeze({
  company: Object.freeze(['Legal and Registration', 'Board and Governance', 'Banking and Payments', 'Compliance and Tax', 'Company Profile', 'Brand Assets']),
  people: Object.freeze(['Onboarding', 'Employment', 'Exit']),
  clients: Object.freeze(['Proposals and Pricing', 'Agreements', 'Invoices and Receipts', 'Settlements and Statements', 'Deliverables and Correspondence']),
  vendors: Object.freeze(['Agreements', 'Invoices Received']),
  products: Object.freeze(['Marketing', 'Specifications', 'Pricing', 'Brand Assets', 'Design Source']),
  finance: Object.freeze(['Bank Statements', 'Tax Returns', 'Ledgers and Reports']),
});

/** Per-slot translation of a routed leaf into that folder's own leaf name (applied before the closed-set check). */
export const LEAF_MAP = Object.freeze({
  products: Object.freeze({ 'Proposals and Pricing': 'Pricing', 'Agreements': 'Specifications' }),
  vendors: Object.freeze({ 'Invoices and Receipts': 'Invoices Received' }),
});

/**
 * The leaf a default route takes inside top-level slot `top`: translated through LEAF_MAP, then `Other` when it is
 * not in the slot's closed set. Workspace overrides bypass this (they keep precedence).
 * @param {string} top one of TOP_KEYS
 * @param {string|null} leaf
 * @returns {string|null}
 */
export function leafIn(top, leaf) {
  if (leaf === null) return null;
  const mapped = LEAF_MAP[top]?.[leaf] ?? leaf;
  const allowed = TOP_LEAVES[top];
  return !allowed || mapped === DEFAULT_LEAF || allowed.includes(mapped) ? mapped : DEFAULT_LEAF;
}

/**
 * @typedef {{ top: string|null, leaf: string|null }} Route
 *   `top` null means "the party's top-level folder"; otherwise one of TOP_KEYS. `leaf` null means the documents sit
 *   directly in the top-level folder (templates, references).
 */

const party = (leaf) => ({ top: null, leaf });
const fixed = (top, leaf = null) => ({ top, leaf });

/** Default type -> route table (from the vault spec's "Document types" table). */
export const DEFAULT_ROUTES = Object.freeze({
  'Invoice': party('Invoices and Receipts'),
  'Debit Note': party('Invoices and Receipts'),
  'Receipt': party('Invoices and Receipts'),
  'Quotation': party('Proposals and Pricing'),
  'Proposal': party('Proposals and Pricing'),
  'Pricing Report': party('Proposals and Pricing'),
  'MoU': party('Agreements'),
  'Contract': party('Agreements'),
  'NDA': party('Agreements'),
  'Agreement': party('Agreements'),
  'Settlement Statement': party('Settlements and Statements'),
  'Ticketing Settlement Statement': party('Settlements and Statements'),
  'Remittance Statement': party('Settlements and Statements'),
  'Registration Summary': party('Settlements and Statements'),
  'Expense Statement': party('Settlements and Statements'),
  'Offer Letter': party('Onboarding'),
  'Internship Offer': party('Onboarding'),
  'Internship Certificate': party('Employment'),
  'Experience Certificate': party('Exit'),
  'Relieving Letter': party('Exit'),
  'Final Settlement': party('Exit'),
  'Brochure': party('Marketing'),
  'Pitch Deck': party('Marketing'),
  'Feature Listing': party('Specifications'),
  'PRD': party('Specifications'),
  'User Flow': party('Specifications'),
  'Specification': party('Specifications'),
  'Vendor Invoice': party('Invoices Received'),
  'Board Resolution': fixed('company', 'Board and Governance'),
  'Certificate of Incorporation': fixed('company', 'Legal and Registration'),
  'Registration Certificate': fixed('company', 'Legal and Registration'),
  'Template': fixed('templates'),
  'Reference': fixed('references'),
  'Bank Statement': fixed('finance', 'Bank Statements'),
  'Tax Return': fixed('finance', 'Tax Returns'),
  'Ledger': fixed('finance', 'Ledgers and Reports'),
});

const typeKey = (t) => String(t ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Parse one `hierarchy.routing` value. `"Agreements"` is a leaf inside the party's folder; a value starting with a
 * top-level folder name (current or default, e.g. `"06 Finance/Bank Statements"` or `"08 References"`) routes to
 * that folder, with the rest of the value as the leaf.
 * @param {string} value
 * @param {string[]} topLevel effective top-level names
 * @returns {Route}
 */
export function parseRouteValue(value, topLevel = TOP_LEVEL) {
  const v = String(value).trim();
  for (let i = 0; i < TOP_KEYS.length; i++) {
    for (const name of [topLevel[i], TOP_LEVEL[i]]) {
      if (v === name) return fixed(TOP_KEYS[i]);
      if (v.startsWith(`${name}/`)) {
        const leaf = v.slice(name.length + 1).trim();
        return fixed(TOP_KEYS[i], leaf || null);
      }
    }
  }
  return party(v);
}

/**
 * Build the effective routing configuration from the workspace `hierarchy` block.
 * @param {{ topLevel?: string[], routing?: Record<string, string> }} [hierarchy]
 * Overrides targeting the Restricted folder are ignored (the workspace schema rejects them; only Restricted
 * sensitivity places a document there).
 * @returns {{ topLevel: string[], routes: Map<string, Route & { override?: boolean }> }} routes keyed by normalised
 *   type (trimmed, lower case); `override` marks workspace routes
 */
export function routingConfig(hierarchy = {}) {
  const topLevel = Array.isArray(hierarchy?.topLevel) && hierarchy.topLevel.length === TOP_LEVEL.length
    ? [...hierarchy.topLevel] : [...TOP_LEVEL];
  const routes = new Map(Object.entries(DEFAULT_ROUTES).map(([t, r]) => [typeKey(t), r]));
  for (const [t, value] of Object.entries(hierarchy?.routing ?? {})) {
    const route = parseRouteValue(value, topLevel);
    if (route.top !== 'restricted') routes.set(typeKey(t), { ...route, override: true });
  }
  return { topLevel, routes };
}

/**
 * Route of a document type: the configured route, or the party's folder with leaf "Other" for unknown types.
 * @param {string} type
 * @param {{ routes: Map<string, Route> }} config from routingConfig
 * @returns {Route & { known: boolean, override: boolean }}
 */
export function routeFor(type, config) {
  const r = config.routes.get(typeKey(type));
  return r ? { top: r.top, leaf: r.leaf, known: true, override: r.override === true } : { top: null, leaf: DEFAULT_LEAF, known: false, override: false };
}

/**
 * Indian financial year label (April to March) of an ISO date: `2026-04-01` -> `FY 2026-27`, `2027-03-31` -> `FY 2026-27`.
 * @param {string|null|undefined} date
 * @returns {string|null} null when the date is missing or not ISO
 */
export function financialYear(date) {
  const m = /^(\d{4})-(\d{2})/.exec(String(date ?? ''));
  if (!m) return null;
  const y = Number(m[1]);
  const start = Number(m[2]) >= 4 ? y : y - 1;
  return `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Node-id segment for a folder name: lower case, accents stripped, runs of other characters turned into `-`.
 * ("Events - Demo Line" -> "events-demo-line")
 * @param {string} name
 * @returns {string}
 */
export function idSegment(name) {
  const s = String(name ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return s || 'x';
}

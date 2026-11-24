// Settings forms -> workspace file bodies. Each brand section replaces only the keys it edits in the brand's own
// brand.json; everything else in the file (layoutProfiles, templateParams, unknown keys) is kept. For a brand with
// `inheritsFrom`, a blank scalar and an unticked "override" list mean "inherit": the key is left out of the file.
import { nestForm } from './http.js';

/** Brand form sections, in page order. */
export const BRAND_SECTIONS = ['identity', 'registrations', 'contacts', 'bankAccounts', 'letterhead', 'palette', 'fonts', 'assets', 'signatories', 'strings', 'tax', 'series'];

const MAP_KEY = /^[A-Za-z0-9_-]+$/;
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const str = (v) => (typeof v === 'string' ? v.trim() : '');
/** Non-empty lines of a textarea value. */
export const linesOf = (v) => (typeof v === 'string' ? v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : []);

/** Rows of a repeatable table as `{ key: trimmed string }` objects, blank rows dropped. */
function rowsOf(list, keys) {
  const arr = Array.isArray(list) ? list : isPlainObject(list) ? Object.values(list) : [];
  return arr.map((r) => Object.fromEntries(keys.map((k) => [k, str(r?.[k])]))).filter((r) => keys.some((k) => r[k] !== ''));
}
const compact = (r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== ''));

/** Set (or, for `undefined`, delete) a nested key; empty parent objects left behind by a delete are removed. */
function setPath(obj, path, value) {
  const segs = path.split('.');
  const parents = [];
  let node = obj;
  for (const s of segs.slice(0, -1)) {
    if (!isPlainObject(node[s])) {
      if (value === undefined) return;
      node[s] = {};
    }
    parents.push([node, s]);
    node = node[s];
  }
  const last = segs.at(-1);
  if (value === undefined) delete node[last];
  else node[last] = value;
  if (value === undefined) {
    for (let i = parents.length - 1; i >= 0; i--) {
      const [p, k] = parents[i];
      if (isPlainObject(p[k]) && Object.keys(p[k]).length === 0) delete p[k];
      else break;
    }
  }
}

/** Split a flat form body into data (nested) and `$` controls (flat). */
function splitForm(flat) {
  const data = {};
  const controls = {};
  for (const [k, v] of Object.entries(flat ?? {})) (k.startsWith('$') ? controls : data)[k] = v;
  return { data: nestForm(data), controls };
}

/** Rows keyed by a `key` column -> object; duplicate or malformed keys become field errors. */
function mapRows(rows, section, errors, valueOf) {
  const out = {};
  rows.forEach((r, i) => {
    if (!MAP_KEY.test(r.key)) errors.push({ path: `${section}.${i}.key`, message: 'key must be letters, digits, "-" or "_"' });
    else if (Object.hasOwn(out, r.key)) errors.push({ path: `${section}.${i}.key`, message: `duplicate key "${r.key}"` });
    else out[r.key] = valueOf(r);
  });
  return out;
}

/** `label = rate` lines -> `[{ label, rate }]`; a rate is a fraction (0.09) or a percentage (9%). */
export function parseRates(text, path, errors) {
  return linesOf(text).map((line) => {
    const i = line.lastIndexOf('=');
    const label = i < 0 ? line : line.slice(0, i).trim();
    const raw = i < 0 ? '' : line.slice(i + 1).trim();
    const pct = raw.endsWith('%');
    const n = Number(pct ? raw.slice(0, -1) : raw);
    if (raw === '' || !Number.isFinite(n)) {
      errors.push({ path, message: `"${line}": write each rate as "label = 0.09" or "label = 9%"` });
      return { label, rate: 0 };
    }
    return { label, rate: pct ? Math.round(n * 1e6) / 1e8 : n };
  });
}

/** Text of a rate list for the textarea. */
export const ratesText = (rates) => (rates ?? []).map((r) => `${r.label} = ${r.rate}`).join('\n');

/**
 * Apply one brand form section to a copy of the brand's own brand.json.
 * @param {object} own current brand.json content
 * @param {string} section one of BRAND_SECTIONS
 * @param {Record<string, string>} flat urlencoded form body
 * @param {{ inherits?: boolean }} [opts] the brand has `inheritsFrom`
 * @returns {{ body: object, errors: Array<{ path: string, message: string }> }}
 */
export function applyBrandSection(own, section, flat, { inherits = false } = {}) {
  if (!BRAND_SECTIONS.includes(section)) return { body: own, errors: [{ path: '(root)', message: `unknown section "${section}"` }] };
  const body = structuredClone(own);
  const { data, controls } = splitForm(flat);
  const errors = [];
  // A list is written when the brand does not inherit, or when its "override" box is ticked.
  const overriding = (key) => !inherits || controls[`$override.${key}`] !== undefined;
  const scalar = (path, { required = false } = {}) => {
    const v = str(path.split('.').reduce((o, k) => (isPlainObject(o) ? o[k] : undefined), data));
    setPath(body, path, v === '' && (inherits || !required) ? undefined : v);
  };
  const list = (path, value) => setPath(body, path, overriding(path) ? value : undefined);
  const map = (path, value) => setPath(body, path, Object.keys(value).length || (path === 'contacts' && !inherits) ? value : undefined);

  switch (section) {
    case 'identity': {
      scalar('legalName', { required: true });
      scalar('shortName', { required: true });
      scalar('projectContact');
      const business = linesOf(data.addresses?.business);
      setPath(body, 'addresses.business', business.length ? business : inherits ? undefined : []);
      const registered = linesOf(data.addresses?.registered);
      setPath(body, 'addresses.registered', registered.length ? registered : undefined);
      break;
    }
    case 'registrations':
      list('registrations', rowsOf(data.registrations, ['label', 'value']));
      break;
    case 'contacts':
      map('contacts', mapRows(rowsOf(data.contacts, ['key', 'email', 'phone', 'website']), 'contacts', errors, ({ key, ...rest }) => compact(rest)));
      break;
    case 'bankAccounts':
      list('bankAccounts', rowsOf(data.bankAccounts, ['accountName', 'bankName', 'accountNumber', 'ifsc', 'swift', 'branch']).map(compact));
      break;
    case 'letterhead': {
      const lines = (Array.isArray(data.letterhead?.lines) ? data.letterhead.lines : []).map(str).filter(Boolean);
      list('letterhead.lines', lines);
      for (const slot of ['left', 'center', 'right']) scalar(`footer.${slot}`);
      break;
    }
    case 'palette':
      for (const [k, v] of Object.entries(isPlainObject(data.palette) ? data.palette : {})) {
        if (controls[`$default.palette.${k}`] !== undefined) setPath(body, `palette.${k}`, undefined);
        else if (!HEX.test(str(v))) errors.push({ path: `palette.${k}`, message: 'must be a hex colour like #1a1a1a' });
        else setPath(body, `palette.${k}`, str(v).toLowerCase());
      }
      break;
    case 'fonts':
      for (const [w, v] of Object.entries(isPlainObject(data.fonts) ? data.fonts : {})) setPath(body, `fonts.${w}`, str(v) || undefined);
      break;
    case 'assets':
      for (const k of ['logo', 'seal', 'watermark']) scalar(`assets.${k}`);
      break;
    case 'signatories':
      list('signatories', rowsOf(data.signatories, ['id', 'name', 'title', 'titleLong', 'email', 'phone', 'signature', 'signatureLarge']).map(compact));
      map('defaultSignatory', mapRows(rowsOf(data.defaultSignatory, ['key', 'signatory']), 'defaultSignatory', errors, (r) => r.signatory));
      break;
    case 'strings':
      map('strings', mapRows(rowsOf(data.strings, ['key', 'value']), 'strings', errors, (r) => r.value));
      break;
    case 'tax': {
      const modes = rowsOf(data.tax?.modes, ['id', 'label', 'rates'])
        .map((r, i) => ({ id: r.id, label: r.label, rates: parseRates(r.rates, `tax.modes.${i}.rates`, errors) }));
      list('tax.modes', modes);
      scalar('tax.defaultMode');
      scalar('tax.defaultHsn');
      break;
    }
    case 'series':
      map('series', mapRows(rowsOf(data.series, ['key', 'series']), 'series', errors, (r) => r.series));
      break;
    default:
  }
  return { body, errors };
}

/**
 * A new brand from the create form: id, legal and short name, optional parent, business address lines and the
 * default contact. A brand with a parent writes only what was filled in.
 * @param {Record<string, string>} flat
 * @returns {object}
 */
export function newBrandBody(flat) {
  const body = { id: str(flat.id) };
  const parent = str(flat.inheritsFrom);
  if (parent) body.inheritsFrom = parent;
  for (const k of ['legalName', 'shortName']) if (str(flat[k]) || !parent) body[k] = str(flat[k]);
  const business = linesOf(flat['addresses.business']);
  if (business.length || !parent) body.addresses = { business };
  const contact = compact({ email: str(flat['contact.email']), phone: str(flat['contact.phone']), website: str(flat['contact.website']) });
  if (Object.keys(contact).length || !parent) body.contacts = { default: contact };
  return body;
}

const SERIES_KEYS = ['id', 'pattern', 'scope', 'start', 'counter'];

/**
 * series.json from the series form (`series.<i>.<field>`). Keys of the stored entries that the form does not show are
 * kept (matched by id).
 * @param {unknown[]} current stored list
 * @param {Record<string, string>} flat
 * @returns {{ body: object[], errors: Array<{ path: string, message: string }> }}
 */
export function seriesFromForm(current, flat) {
  const { data } = splitForm(flat);
  const errors = [];
  const byId = new Map((Array.isArray(current) ? current : []).filter(isPlainObject).map((s) => [s.id, s]));
  const body = rowsOf(data.series, SERIES_KEYS).map((r, i) => {
    const extra = Object.fromEntries(Object.entries(byId.get(r.id) ?? {}).filter(([k]) => !SERIES_KEYS.includes(k)));
    const out = { ...extra, id: r.id, pattern: r.pattern };
    if (r.scope) out.scope = r.scope;
    if (r.start !== '') {
      if (/^\d+$/.test(r.start)) out.start = Number(r.start);
      else errors.push({ path: `${i}.start`, message: 'must be a whole number' });
    }
    if (r.counter && r.counter !== r.id) out.counter = r.counter;
    return out;
  });
  return { body, errors };
}

const LOCALE_PATHS = ['currencySymbol', 'currencyCode', 'numberLocale', 'dateFormats.short', 'dateFormats.long', 'dateFormats.us',
  'currencyWords.major', 'currencyWords.minor', 'currencyWords.suffix'];

/** Locale field paths shown on the workspace form (under `locale.`). */
export const WORKSPACE_LOCALE_PATHS = LOCALE_PATHS;

/**
 * workspace.json from the workspace form: name, default brand, locale (blank = default) and users (`users.<i>.id`,
 * `users.<i>.clearance`). `hierarchy` and unknown keys are kept.
 * @param {object} current stored workspace.json
 * @param {Record<string, string>} flat
 * @returns {{ body: object, errors: Array<{ path: string, message: string }> }}
 */
export function workspaceFromForm(current, flat) {
  const { data } = splitForm(flat);
  const body = structuredClone(current ?? {});
  const errors = [];
  body.name = str(data.name);
  body.defaultBrand = str(data.defaultBrand);
  for (const p of LOCALE_PATHS) {
    const v = str(p.split('.').reduce((o, k) => (isPlainObject(o) ? o[k] : undefined), data.locale));
    setPath(body, `locale.${p}`, v === '' ? undefined : v);
  }
  const users = {};
  rowsOf(data.users, ['id', 'clearance']).forEach((r, i) => {
    if (!/^[A-Za-z0-9._@-]+$/.test(r.id)) errors.push({ path: `users.${i}.id`, message: 'user id must be letters, digits, ".", "_", "@" or "-"' });
    else if (Object.hasOwn(users, r.id)) errors.push({ path: `users.${i}.id`, message: `duplicate user "${r.id}"` });
    else users[r.id] = r.clearance ? { ...(isPlainObject(current?.users?.[r.id]) ? current.users[r.id] : {}), clearance: r.clearance } : {};
  });
  body.users = users;
  return { body, errors };
}

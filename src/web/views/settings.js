import { html } from '../html.js';
import { layout, notice } from './layout.js';
import { ratesText, WORKSPACE_LOCALE_PATHS } from '../settingsForms.js';
import { CLEARANCES, FONT_WEIGHTS, PALETTE_DEFAULTS, SERIES_SCOPES } from '../../workspace/schemas.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const at = (obj, path) => path.split('.').reduce((o, k) => (o !== null && typeof o === 'object' ? o[k] : undefined), obj);
const text = (v) => (v === undefined || v === null ? '' : String(v));

/** Field errors of a failed save as a notice (paths in other files are prefixed with the file). */
function errorNotice(errors, file) {
  if (!errors?.length) return '';
  return notice('error', 'Not saved. Fix these fields:', errors.map((e) => html`<code>${e.file && e.file !== file ? `${e.file} ` : ''}${e.path}</code>: ${e.message}`));
}

/** A set of form field names that failed, for marking inputs. */
const invalidNames = (errors, file, prefix = '') => new Set((errors ?? []).filter((e) => !e.file || e.file === file).map((e) => `${prefix}${e.path}`));
const cls = (inv, name) => (inv.has(name) ? 'invalid' : '');

function control(c, name, value, inv, disabled) {
  const v = text(value);
  const common = { class: cls(inv, name) };
  if (c.type === 'textarea') return html`<textarea name="${name}" rows="${c.rows ?? 2}" class="${common.class}" placeholder="${c.placeholder ?? ''}"${disabled ? html` disabled` : ''}>${v}</textarea>`;
  if (c.type === 'select') {
    return html`<select name="${name}" class="${common.class}"${disabled ? html` disabled` : ''}>${c.options.map(([ov, label]) => html`<option value="${ov}"${ov === v ? html` selected` : ''}>${label}</option>`)}${v && !c.options.some(([ov]) => ov === v) ? html`<option value="${v}" selected>${v}</option>` : ''}</select>`;
  }
  return html`<input name="${name}" value="${v}" class="${common.class}"${c.list ? html` list="${c.list}"` : ''}${c.placeholder ? html` placeholder="${c.placeholder}"` : ''}${disabled ? html` disabled` : ''}>`;
}

/**
 * A repeatable table: existing rows plus one blank row (adding without script), a row template and an "Add row"
 * button for app.js. Column `key: null` makes a list of plain strings (`name.<i>`).
 */
function rowsTable(name, cols, rows, inv, { disabled = false } = {}) {
  const list = [...(rows ?? []), cols.length === 1 && cols[0].key === null ? '' : {}];
  const row = (r, i) => html`<tr>${cols.map((c) => {
    const n = c.key === null ? `${name}.${i}` : `${name}.${i}.${c.key}`;
    return html`<td>${control(c, n, c.key === null ? r : r?.[c.key], inv, disabled)}</td>`;
  })}<td>${disabled ? '' : html`<button type="button" class="link danger" data-remove-row>remove</button>`}</td></tr>`;
  return html`<table class="rows" data-rows="${name}">
<thead><tr>${cols.map((c) => html`<th>${c.label}</th>`)}<th></th></tr></thead>
<tbody>${list.map((r, i) => row(r, i))}</tbody>
</table>
${disabled ? '' : html`<template data-row-template="${name}">${row(cols.length === 1 && cols[0].key === null ? '' : {}, '__i__')}</template>
<button type="button" data-add-row="${name}">Add row</button>`}`;
}

/** Rows of an object map (`{ key: value }`) for a key/value table. */
const mapRows = (obj, valueKey, toRow = (v) => ({ [valueKey]: v })) => Object.entries(isPlainObject(obj) ? obj : {}).map(([key, v]) => ({ key, ...toRow(v) }));

/**
 * Settings overview: where the data lives, the acting user, links to the editors.
 * @param {{ shell: object, info: { home: string, dataDir: string, workspace: string, defaultBrand: string,
 *   user: { id: string, clearance: string }, brands: Array<{ id: string, name: string, signatories: string[] }>,
 *   series: Array<{ id: string, pattern: string, scope: string }> } }} p
 */
export function settingsPage({ shell, info }) {
  return layout({
    ...shell,
    active: 'settings',
    title: 'Settings',
    body: html`
<table class="meta">
<tr><th>Workspace</th><td>${info.workspace} · <a href="/settings/workspace">edit name, locale and users</a></td></tr>
<tr><th>Workspace folder</th><td><code>${info.home}</code></td></tr>
<tr><th>Data folder</th><td><code>${info.dataDir}</code></td></tr>
<tr><th>User</th><td>${info.user.id} (clearance ${info.user.clearance})</td></tr>
<tr><th>Default brand</th><td>${info.defaultBrand}</td></tr>
</table>
<h2>Brands <a class="count" href="/settings/brands">edit</a></h2>
<table class="list"><thead><tr><th>Id</th><th>Legal name</th><th>Signatories</th></tr></thead><tbody>
${info.brands.map((b) => html`<tr><td><a href="/settings/brands/${b.id}">${b.id}</a></td><td>${b.name}</td><td>${b.signatories.join(', ')}</td></tr>`)}
</tbody></table>
<h2>Number series <a class="count" href="/settings/series">edit</a></h2>
<table class="list"><thead><tr><th>Id</th><th>Pattern</th><th>Scope</th></tr></thead><tbody>
${info.series.map((s) => html`<tr><td>${s.id}</td><td><code>${s.pattern}</code></td><td>${s.scope}</td></tr>`)}
</tbody></table>
<p class="muted">Changes made here are written to <code>workspace.json</code>, <code>brands/&lt;id&gt;/brand.json</code> and <code>series.json</code> in the workspace folder and apply at once. Files edited by hand are read when the server starts.</p>`,
  });
}

/**
 * Brand list with the create form.
 * @param {{ shell: object, brands: Array<{ id: string, legalName: string, inheritsFrom?: string }>, values?: Record<string, string>,
 *   error?: { code: string, message: string, details: object }|null }} p
 */
export function brandsPage({ shell, brands, values = {}, error = null }) {
  const errors = error?.details?.errors;
  const inv = invalidNames(errors, `brands/${values.id ?? ''}/brand.json`);
  const v = (k) => text(values[k]);
  return layout({
    ...shell,
    active: 'settings',
    title: 'Brands',
    body: html`
<p class="muted"><a href="/settings">Settings</a> · Brands</p>
<table class="list"><thead><tr><th>Id</th><th>Legal name</th><th>Inherits from</th><th></th></tr></thead><tbody>
${brands.map((b) => html`<tr><td><a href="/settings/brands/${b.id}">${b.id}</a></td><td>${b.legalName}</td><td>${b.inheritsFrom ?? ''}</td><td><a href="/settings/brands/${b.id}/brand.json">brand.json</a> · <a href="/settings/brands/${b.id}/preview.pdf" target="_blank" rel="noopener">preview</a></td></tr>`)}
</tbody></table>
<h2>New brand</h2>
${error && !errors ? notice('error', `${error.code}: ${error.message}`) : errorNotice(errors)}
<form method="post" action="/settings/brands" class="card wide">
<label>Id <span class="muted">(folder name: lowercase letters, digits, "-", "_")</span><input name="id" value="${v('id')}" required pattern="[a-z0-9][a-z0-9_\\-]*" class="${cls(inv, 'id')}"></label>
<label>Inherits from <select name="inheritsFrom"><option value="">— none —</option>${brands.map((b) => html`<option value="${b.id}"${v('inheritsFrom') === b.id ? html` selected` : ''}>${b.id}</option>`)}</select></label>
<label>Legal name <input name="legalName" value="${v('legalName')}" class="${cls(inv, 'legalName')}"></label>
<label>Short name <input name="shortName" value="${v('shortName')}" class="${cls(inv, 'shortName')}"></label>
<label>Business address <span class="muted">(one line per row; blank inherits)</span><textarea name="addresses.business" rows="3" class="${cls(inv, 'addresses.business')}">${v('addresses.business')}</textarea></label>
<label>Default contact email <input name="contact.email" value="${v('contact.email')}"></label>
<label>Default contact phone <input name="contact.phone" value="${v('contact.phone')}"></label>
<label>Default contact website <input name="contact.website" value="${v('contact.website')}"></label>
<p class="buttons"><button type="submit" class="primary">Create brand</button></p>
</form>`,
  });
}

/**
 * The brand editor: one form per section, the asset uploads and a live letterhead preview.
 * @param {{ shell: object, id: string, own: object, parent: object|null, resolved: object|null, configHash?: string, logoVersion?: string|null,
 *   errors?: Array<{ file?: string, path: string, message: string }>|null, failedSection?: string|null, error?: object|null,
 *   saved?: string|null, seriesIds: string[], builtinFonts: string[] }} p
 */
export function brandPage(p) {
  const { shell, id, own, parent, resolved, configHash = '', logoVersion = null, errors = null, failedSection = null, error = null, saved = null, seriesIds, builtinFonts } = p;
  const file = `brands/${id}/brand.json`;
  const inv = invalidNames(errors, file);
  const inherits = Boolean(own.inheritsFrom);
  const ownAt = (path) => at(own, path);
  /** Placeholder: the inherited value of a scalar (child brands) or a default. */
  const ph = (path, fallback = '') => text(inherits ? at(parent, path) ?? fallback : fallback);
  const effective = (path) => ownAt(path) ?? (inherits ? at(parent, path) : undefined);
  const signatoryIds = (effective('signatories') ?? []).map((s) => s.id);
  const sigOptions = [['', '—'], ...signatoryIds.map((s) => [s, s])];

  const sectionForm = (section, title, inner, hint = '') => html`
<section class="card" id="sec-${section}">
<h2>${title}</h2>
${saved === section ? notice('info', 'Saved.') : ''}
${failedSection === section ? errorNotice(errors, file) : ''}
${hint ? html`<p class="muted">${hint}</p>` : ''}
<form method="post" action="/settings/brands/${id}#sec-${section}">
<input type="hidden" name="$section" value="${section}">
${inner}
<p class="buttons"><button type="submit" class="primary">Save ${title.toLowerCase()}</button></p>
</form>
</section>`;

  /** A list that a child brand inherits whole unless "override" is ticked. */
  const listBlock = (path, render) => {
    if (!inherits) return render(ownAt(path) ?? []);
    const overridden = ownAt(path) !== undefined;
    return html`<label class="check"><input type="checkbox" name="$override.${path}" value="on"${overridden ? html` checked` : ''}> Override the list inherited from <code>${own.inheritsFrom}</code> (unticked: inherit it)</label>
${render(overridden ? ownAt(path) : at(parent, path) ?? [])}`;
  };
  /** Inherited entries of an object map a child brand does not override. */
  const inheritedMap = (path, show = (v) => (typeof v === 'string' ? v : JSON.stringify(v))) => {
    if (!inherits) return '';
    const mine = ownAt(path) ?? {};
    const rest = Object.entries(at(parent, path) ?? {}).filter(([k]) => !Object.hasOwn(mine, k));
    return rest.length ? html`<p class="muted">Inherited: ${rest.map(([k, v], i) => html`${i ? '; ' : ''}<code>${k}</code> = ${show(v)}`)}</p>` : '';
  };

  const scalarInput = (label, path, { required = false } = {}) => html`<label>${label}${required && !inherits ? html` <span class="req">*</span>` : ''}<input name="${path}" value="${text(ownAt(path))}" placeholder="${ph(path)}" class="${cls(inv, path)}"></label>`;

  const identity = sectionForm('identity', 'Identity', html`
${inherits ? html`<p>Inherits from <a href="/settings/brands/${own.inheritsFrom}">${own.inheritsFrom}</a>. Blank fields use the inherited value shown in grey.</p>` : ''}
${scalarInput('Legal name', 'legalName', { required: true })}
${scalarInput('Short name', 'shortName', { required: true })}
<label>Business address <span class="muted">(one line per row)</span><textarea name="addresses.business" rows="3" class="${cls(inv, 'addresses.business')}" placeholder="${inherits ? (at(parent, 'addresses.business') ?? []).join('\n') : ''}">${(ownAt('addresses.business') ?? []).join('\n')}</textarea></label>
<label>Registered address <span class="muted">(optional)</span><textarea name="addresses.registered" rows="3" placeholder="${inherits ? (at(parent, 'addresses.registered') ?? []).join('\n') : ''}">${(ownAt('addresses.registered') ?? []).join('\n')}</textarea></label>
<label>Project contact <span class="muted">(signatory printed in proposal sign-offs)</span>
<select name="projectContact" class="${cls(inv, 'projectContact')}"><option value="">${inherits && parent?.projectContact ? `inherit (${parent.projectContact})` : '—'}</option>${signatoryIds.map((s) => html`<option value="${s}"${ownAt('projectContact') === s ? html` selected` : ''}>${s}</option>`)}</select></label>`);

  const registrations = sectionForm('registrations', 'Registrations', listBlock('registrations', (rows) => rowsTable('registrations',
    [{ key: 'label', label: 'Label', placeholder: 'CIN' }, { key: 'value', label: 'Value' }], rows, inv)), 'Printed where templates list registration numbers; use {registrations.0.value} in letterhead lines.');

  const contacts = sectionForm('contacts', 'Contacts', html`${rowsTable('contacts',
    [{ key: 'key', label: 'Key', placeholder: 'default' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'website', label: 'Website' }],
    mapRows(ownAt('contacts'), null, (c) => ({ ...c })), inv)}${inheritedMap('contacts', (c) => Object.values(c).join(', '))}`,
  inherits ? 'Contacts merge with the inherited ones key by key.' : 'A "default" contact is required; others (hr, billing…) fall back to it per field.');

  const bank = sectionForm('bankAccounts', 'Bank accounts', listBlock('bankAccounts', (rows) => rowsTable('bankAccounts',
    [{ key: 'accountName', label: 'Account name' }, { key: 'bankName', label: 'Bank' }, { key: 'accountNumber', label: 'Account number' },
      { key: 'ifsc', label: 'IFSC' }, { key: 'swift', label: 'SWIFT' }, { key: 'branch', label: 'Branch' }], rows, inv)));

  const letterhead = sectionForm('letterhead', 'Letterhead and footer', html`
<h3>Letterhead lines</h3>
${listBlock('letterhead.lines', (rows) => rowsTable('letterhead.lines', [{ key: null, label: 'Line' }], rows, inv))}
<h3>Footer</h3>
${scalarInput('Left', 'footer.left')}
${scalarInput('Centre', 'footer.center')}
${scalarInput('Right', 'footer.right')}`,
  'Placeholders such as {contact.email}, {legalName}, {strings.confidential} and, in the footer, {page} and {pages} are filled when a document is rendered.');

  const paletteKeys = [...new Set([...Object.keys(PALETTE_DEFAULTS), ...Object.keys(ownAt('palette') ?? {}), ...Object.keys((inherits && parent?.palette) || {})])];
  const palette = sectionForm('palette', 'Palette', html`<table class="rows"><thead><tr><th>Colour</th><th>Value</th><th>${inherits ? 'Inherit' : 'Default'}</th></tr></thead><tbody>
${paletteKeys.map((k) => {
    const mine = ownAt(`palette.${k}`);
    const fallback = (inherits ? parent?.palette?.[k] : undefined) ?? PALETTE_DEFAULTS[k] ?? '#000000';
    const value = mine ?? fallback;
    const name = `palette.${k}`;
    const input = /^#[0-9a-fA-F]{6}$/.test(value)
      ? html`<input type="color" name="${name}" value="${value.toLowerCase()}" data-default-for="$default.${name}">`
      : html`<input name="${name}" value="${value}" class="${cls(inv, name)}" data-default-for="$default.${name}">`;
    return html`<tr><td><code>${k}</code></td><td>${input}</td><td><label class="check"><input type="checkbox" name="$default.${name}" value="on"${mine === undefined ? html` checked` : ''}> ${fallback}</label></td></tr>`;
  })}
</tbody></table>`, 'Tick the last column to use the default (or inherited) colour; changing a colour unticks it.');

  const fontOptions = (w) => {
    const fallback = inherits ? at(parent, `fonts.${w}`) : resolved?.fonts?.[w];
    const opts = [['', `${inherits ? 'inherit' : 'default'}${fallback ? ` (${fallback})` : ''}`], ...builtinFonts.map((f) => [f, f])];
    const mine = ownAt(`fonts.${w}`);
    if (mine && !opts.some(([v]) => v === mine)) opts.push([mine, mine]);
    return opts;
  };
  const fonts = sectionForm('fonts', 'Fonts', html`<table class="rows"><thead><tr><th>Weight</th><th>Font</th></tr></thead><tbody>
${FONT_WEIGHTS.map((w) => html`<tr><td>${w}</td><td>${control({ type: 'select', options: fontOptions(w) }, `fonts.${w}`, ownAt(`fonts.${w}`) ?? '', inv)}</td></tr>`)}
</tbody></table>`, 'Upload a .ttf or .otf file per weight below; the uploaded file is selected automatically.');

  const upload = (title, keys, accept) => html`<form method="post" action="/settings/brands/${id}/assets" enctype="multipart/form-data" class="upload">
<label>${title} <select name="key">${keys.map(([k, label]) => html`<option value="${k}">${label}</option>`)}</select></label>
<label>File <input type="file" name="file" accept="${accept}" required></label>
<button type="submit">Upload</button>
</form>`;

  const assets = sectionForm('assets', 'Images', html`
${resolved ? html`<p><img class="logo" src="/assets/brands/${id}/logo${logoVersion ? `?v=${logoVersion}` : ''}" alt="Current logo of ${id}"></p>` : ''}
${scalarInput('Logo path', 'assets.logo')}
${scalarInput('Seal path', 'assets.seal')}
${scalarInput('Watermark path', 'assets.watermark')}`,
  'Paths are relative to the brand folder. Upload new images below (PNG or JPEG, up to 10 MB); a missing file prints a grey placeholder.');

  const signatories = sectionForm('signatories', 'Signatories', html`
${listBlock('signatories', (rows) => rowsTable('signatories', [
    { key: 'id', label: 'Id', placeholder: 'md' }, { key: 'name', label: 'Name' }, { key: 'title', label: 'Title' },
    { key: 'titleLong', label: 'Long title' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
    { key: 'signature', label: 'Signature image' }, { key: 'signatureLarge', label: 'Large signature image' }], rows, inv))}
<h3>Default signatory per template or category</h3>
${rowsTable('defaultSignatory', [{ key: 'key', label: 'Template or category', placeholder: 'invoice' }, { key: 'signatory', label: 'Signatory', type: 'select', options: sigOptions }],
    mapRows(ownAt('defaultSignatory'), 'signatory'), inv)}
${inheritedMap('defaultSignatory')}`);

  const strings = sectionForm('strings', 'Strings', html`${rowsTable('strings',
    [{ key: 'key', label: 'Key', placeholder: 'confidential' }, { key: 'value', label: 'Text', type: 'textarea' }], mapRows(ownAt('strings'), 'value'), inv)}
${inheritedMap('strings')}`, 'Free text used by templates (confidential, invoiceDeclaration, thankYou, forCompany…); placeholders allowed.');

  const modeIds = (effective('tax.modes') ?? []).map((m) => m.id);
  const tax = sectionForm('tax', 'Tax modes', html`
${listBlock('tax.modes', (rows) => rowsTable('tax.modes', [{ key: 'id', label: 'Id', placeholder: 'igst' }, { key: 'label', label: 'Label' },
    { key: 'rates', label: 'Rates (one "label = 0.09" or "label = 9%" per line)', type: 'textarea', rows: 3 }],
  rows.map((m) => ({ ...m, rates: ratesText(m.rates) })), inv))}
<label>Default mode <select name="tax.defaultMode" class="${cls(inv, 'tax.defaultMode')}"><option value="">${inherits ? `inherit (${text(at(parent, 'tax.defaultMode'))})` : 'none'}</option>${modeIds.map((m) => html`<option value="${m}"${ownAt('tax.defaultMode') === m ? html` selected` : ''}>${m}</option>`)}</select></label>
${scalarInput('Default HSN/SAC', 'tax.defaultHsn')}`);

  const series = sectionForm('series', 'Numbering series by template', html`${rowsTable('series',
    [{ key: 'key', label: 'Template id', placeholder: 'invoice' }, { key: 'series', label: 'Series', type: 'select', options: [['', '—'], ...seriesIds.map((s) => [s, s])] }],
    mapRows(ownAt('series'), 'series'), inv)}
${inheritedMap('series')}`, html`Series are defined on the <a href="/settings/series">series page</a>.`);

  const imageKeys = [['logo', 'Logo'], ['seal', 'Seal'], ['watermark', 'Watermark'],
    ...signatoryIds.flatMap((s) => [[`signature:${s}`, `Signature: ${s}`], [`signature-large:${s}`, `Large signature: ${s}`]])];

  return layout({
    ...shell,
    active: 'settings',
    title: `Brand ${id}`,
    body: html`
<p class="muted"><a href="/settings">Settings</a> · <a href="/settings/brands">Brands</a> · ${id} · <a href="/settings/brands/${id}/brand.json">download brand.json</a></p>
${error ? notice('error', `${error.code}: ${error.message}`) : ''}
${failedSection === 'upload' ? errorNotice(errors, file) : ''}
${saved === 'upload' ? notice('info', 'Uploaded and saved.') : ''}
<div class="cols settings">
<div class="stack">
${identity}${registrations}${contacts}${bank}${letterhead}${palette}${fonts}
<section class="card" id="sec-uploads"><h2>Upload images and fonts</h2>
${upload('Image', imageKeys, 'image/png,image/jpeg')}
${upload('Font weight', FONT_WEIGHTS.map((w) => [`font:${w}`, w]), '.ttf,.otf,font/ttf,font/otf')}
</section>
${assets}${signatories}${strings}${tax}${series}
</div>
<section id="preview" class="sticky">
<h2>Letterhead preview</h2>
<p class="muted"><a href="/settings/brands/${id}/preview.pdf" target="_blank" rel="noopener">Open the preview PDF</a> (letterhead, footer and the first signatory, with the saved settings).</p>
${resolved ? html`<iframe class="pdf" title="Letterhead preview" src="/settings/brands/${id}/preview.pdf?v=${configHash.slice(0, 12)}"></iframe>` : ''}
</section>
</div>`,
  });
}

/**
 * The series.json editor.
 * @param {{ shell: object, list: object[], errors?: object[]|null, saved?: boolean, usage: Record<string, string[]> }} p
 */
export function seriesPage({ shell, list, errors = null, saved = false, usage = {} }) {
  const inv = invalidNames(errors, 'series.json', 'series.');
  const ids = list.map((s) => s.id).filter(Boolean);
  const rows = list.map((s) => ({ ...s, start: s.start ?? '', counter: s.counter ?? '' }));
  return layout({
    ...shell,
    active: 'settings',
    title: 'Number series',
    body: html`
<p class="muted"><a href="/settings">Settings</a> · Number series</p>
${saved ? notice('info', 'Saved.') : ''}
${errorNotice(errors?.map((e) => ({ ...e, path: e.file === 'series.json' && /^\d/.test(e.path) ? `series.${e.path}` : e.path })), 'series.json')}
<form method="post" action="/settings/series" class="card">
${rowsTable('series', [
    { key: 'id', label: 'Id' },
    { key: 'pattern', label: 'Pattern', placeholder: 'ACM-{YYYY}-{####}' },
    { key: 'scope', label: 'Counter restarts per', type: 'select', options: [['', 'default (brand+year)'], ...SERIES_SCOPES.map((s) => [s, s])] },
    { key: 'start', label: 'Start', placeholder: '1' },
    { key: 'counter', label: 'Shares the counter of', type: 'select', options: [['', '— own counter —'], ...ids.map((s) => [s, s])] },
  ], rows, inv)}
<p class="buttons"><button type="submit" class="primary">Save series</button></p>
</form>
<h2>Where they are used</h2>
<table class="list"><thead><tr><th>Series</th><th>Brands and templates</th></tr></thead><tbody>
${ids.map((s) => html`<tr><td>${s}</td><td>${(usage[s] ?? []).join(', ')}</td></tr>`)}
</tbody></table>
<p class="muted">Tokens: <code>{YYYY}</code> <code>{YY}</code> <code>{MM}</code> <code>{FY}</code> <code>{BRAND}</code> <code>{CLIENT}</code> <code>{CODE}</code> and one counter such as <code>{####}</code>. A series that shares a counter must name a series that owns its own counter (no chains) and use the same scope.</p>`,
  });
}

/**
 * The workspace.json editor: name, default brand, locale and users.
 * @param {{ shell: object, file: object, brandIds: string[], errors?: object[]|null, saved?: boolean }} p
 */
export function workspacePage({ shell, file, brandIds, errors = null, saved = false }) {
  const inv = invalidNames(errors, 'workspace.json');
  const users = Object.entries(file.users ?? {}).map(([uid, u]) => ({ id: uid, clearance: u?.clearance ?? '' }));
  const LOCALE_DEFAULTS = { currencySymbol: '₹', currencyCode: 'INR', numberLocale: 'en-IN', 'dateFormats.short': 'DD/MM/YYYY', 'dateFormats.long': 'D MMMM YYYY',
    'dateFormats.us': 'MMMM D, YYYY', 'currencyWords.major': 'Rupees', 'currencyWords.minor': 'Paise', 'currencyWords.suffix': 'Only' };
  return layout({
    ...shell,
    active: 'settings',
    title: 'Workspace',
    body: html`
<p class="muted"><a href="/settings">Settings</a> · Workspace</p>
${saved ? notice('info', 'Saved.') : ''}
${errorNotice(errors, 'workspace.json')}
<form method="post" action="/settings/workspace" class="card wide">
<label>Name <input name="name" value="${text(file.name)}" class="${cls(inv, 'name')}"></label>
<label>Default brand <select name="defaultBrand" class="${cls(inv, 'defaultBrand')}">${brandIds.map((b) => html`<option value="${b}"${file.defaultBrand === b ? html` selected` : ''}>${b}</option>`)}</select></label>
<fieldset><legend>Locale <span class="muted">(blank uses the default shown)</span></legend>
${WORKSPACE_LOCALE_PATHS.map((p) => html`<label>${p} <input name="locale.${p}" value="${text(at(file.locale, p))}" placeholder="${LOCALE_DEFAULTS[p]}" class="${cls(inv, `locale.${p}`)}"></label>`)}
</fieldset>
<fieldset><legend>Users and clearance <span class="muted">(users not listed get Confidential)</span></legend>
${rowsTable('users', [{ key: 'id', label: 'User id' }, { key: 'clearance', label: 'Clearance', type: 'select', options: [['', 'default (Confidential)'], ...CLEARANCES.map((c) => [c, c])] }], users, inv)}
</fieldset>
<p class="buttons"><button type="submit" class="primary">Save workspace</button></p>
</form>
<p class="muted">The folder hierarchy (<code>hierarchy</code>) is kept as it is; edit it in <code>workspace.json</code>.</p>`,
  });
}

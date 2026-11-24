import { html } from '../html.js';
import { layout, notice } from './layout.js';

/**
 * Template chooser grouped by category.
 * @param {{ shell: object, templates: object[] }} p
 */
export function generateListPage({ shell, templates }) {
  const byCat = new Map();
  for (const t of templates) {
    if (!byCat.has(t.category)) byCat.set(t.category, []);
    byCat.get(t.category).push(t);
  }
  return layout({
    ...shell,
    active: 'generate',
    title: 'Generate a document',
    body: html`${[...byCat].map(([cat, list]) => html`<h2 class="cat">${cat}</h2>
<ul class="cards">${list.map((t) => html`<li><a href="/generate/${encodeURIComponent(t.id)}"><strong>${t.meta.title}</strong></a><br><span class="muted">${t.meta.description ?? ''}</span></li>`)}</ul>`)}`,
  });
}

const getPath = (obj, path) => path.split('.').reduce((v, k) => (v !== null && typeof v === 'object' && Object.hasOwn(v, k) ? v[k] : undefined), obj);

/** Text shown in a textarea for a list or object value: one entry per line for a list of strings, else JSON. */
export function listText(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.join('\n');
  return JSON.stringify(v, null, 2);
}

const scalar = (v) => (v === undefined || v === null ? '' : typeof v === 'object' ? (v.name ?? '') : String(v));

function itemInput(name, type, value) {
  if (type === 'text') return html`<textarea name="${name}" rows="2">${scalar(value)}</textarea>`;
  if (type === 'date') return html`<input type="date" name="${name}" value="${scalar(value)}">`;
  if (type === 'boolean') return html`<select name="${name}"><option value=""></option>${['true', 'false'].map((b) => html`<option value="${b}"${String(value) === b ? html` selected` : ''}>${b === 'true' ? 'Yes' : 'No'}</option>`)}</select>`;
  const numeric = type === 'money' || type === 'number';
  return html`<input name="${name}" value="${scalar(value)}"${numeric ? html` inputmode="decimal" class="num"` : ''}>`;
}

function arrayRows(f, rows) {
  const keys = Object.keys(f.item);
  const list = Array.isArray(rows) && rows.length ? rows : [{}];
  const row = (r, i) => html`<tr>${keys.map((k) => html`<td>${itemInput(`${f.name}.${i}.${k}`, f.item[k], r?.[k])}</td>`)}<td><button type="button" class="link danger" data-remove-row>remove</button></td></tr>`;
  return html`<table class="rows" data-rows="${f.name}">
<thead><tr>${keys.map((k) => html`<th>${k} <span class="muted">${f.item[k]}</span></th>`)}<th></th></tr></thead>
<tbody>${list.map((r, i) => row(r, i))}</tbody>
</table>
<template data-row-template="${f.name}">${row({}, '__i__')}</template>
<button type="button" data-add-row="${f.name}">Add row</button>`;
}

function fieldInput(f, value, hint) {
  const name = f.name;
  if (f.entityKind) return html`<input name="${name}" list="entities-${f.entityKind}" value="${scalar(value)}" placeholder="${f.entityKind} name or id">`;
  if (f.choices) {
    return html`<select name="${name}"><option value="">${hint ? `default (${hint})` : '—'}</option>${f.choices.map((c) => html`<option value="${c}"${String(value ?? '') === c ? html` selected` : ''}>${c}</option>`)}</select>`;
  }
  switch (f.type) {
    case 'boolean':
      return html`<select name="${name}"><option value="">${hint !== '' ? `default (${hint === 'true' ? 'yes' : 'no'})` : '—'}</option>${['true', 'false'].map((b) => html`<option value="${b}"${String(value ?? '') === b ? html` selected` : ''}>${b === 'true' ? 'Yes' : 'No'}</option>`)}</select>`;
    case 'date': return html`<input type="date" name="${name}" value="${scalar(value)}">${hint ? html` <span class="muted">default ${hint}</span>` : ''}`;
    case 'text': return html`<textarea name="${name}" rows="4" placeholder="${hint}">${scalar(value)}</textarea>`;
    case 'array':
      if (f.item) return arrayRows(f, value);
      return html`<textarea name="${name}" rows="4" placeholder="One entry per line, or JSON">${listText(value)}</textarea>`;
    case 'object': return html`<textarea name="${name}" rows="4" placeholder="JSON object">${listText(value)}</textarea>`;
    case 'money':
    case 'number': return html`<input name="${name}" value="${scalar(value)}" inputmode="decimal" class="num">`;
    case null:
    case undefined:
      if (Array.isArray(value) || (f.help ?? '').toLowerCase().includes('line')) return html`<textarea name="${name}" rows="3" placeholder="${hint}">${listText(value)}</textarea>`;
      return html`<input name="${name}" value="${scalar(value)}" placeholder="${hint}">`;
    default: return html`<input name="${name}" value="${scalar(value)}" placeholder="${hint}">`;
  }
}

/** A short text for the default a field resolves to without input (dates, strings, enums, yes/no). */
function hintOf(f, v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return String(v);
  if (f.type === 'money' || f.type === 'number') return '';
  if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 77)}…` : v;
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.join(' / ');
  if (typeof v === 'object' && typeof v.name === 'string') return v.name;
  return '';
}

/** The preview / result panel (also rebuilt by app.js from the JSON response). */
export function previewPanel(preview) {
  if (!preview) return html`<p class="muted" id="preview-empty">Press Preview to render an unnumbered draft.</p>`;
  if (!preview.ok) return '';
  const pdf = preview.renditions.find((r) => r.kind === 'pdf');
  return html`
${preview.warnings.length ? notice('warning', 'Placeholders that print empty:', preview.warnings.map((w) => html`<code>${w.name}</code> — ${w.message}`)) : ''}
<p class="muted">Draft renditions: ${preview.renditions.map((r) => html`<a href="${r.url}" target="_blank" rel="noopener">${r.kind}</a> `)}</p>
${pdf ? html`<iframe class="pdf" id="preview-frame" title="Draft preview" src="${pdf.url}"></iframe>` : ''}`;
}

/**
 * The generate form for one template, with the problems of the last attempt and the draft preview.
 * @param {{ shell: object, template: { id: string, meta: object }, fields: ReturnType<typeof import('../../services/fields.js').formFields>,
 *   input: Record<string, unknown>, resolved: { values: object, missing: object[], errors: object[] },
 *   brands: Array<{ id: string, name: string }>, brandId: string, entityOptions: Record<string, Array<{ id: number, name: string }>>,
 *   regenerate: { id: string, status: string }|null, force: boolean, note: string, preview?: object|null,
 *   problems?: { missing: object[], errors: object[] }|null, error?: object|null }} p
 */
export function generateFormPage(p) {
  const { shell, template, fields, input, resolved, brands, brandId, entityOptions, regenerate, force, note, preview = null, problems = null, error = null } = p;
  const missingNames = new Set((problems?.missing ?? []).map((m) => m.name));
  const errorNames = new Set((problems?.errors ?? []).map((m) => m.name.split('.')[0]));
  const locked = regenerate && ['Sent', 'Signed', 'Paid'].includes(regenerate.status);
  const action = `/generate/${encodeURIComponent(template.id)}`;
  return layout({
    ...shell,
    active: 'generate',
    title: regenerate ? `Regenerate ${regenerate.id} (${template.meta.title})` : template.meta.title,
    body: html`
<p class="muted">${template.meta.description ?? ''} <a href="/templates#${template.id}">Template details</a></p>
${error ? notice('error', `${error.code}: ${error.message}`) : ''}
<div id="problems">
${problems?.missing?.length ? notice('error', 'Required fields are empty:', problems.missing.map((m) => html`${m.label} <code>${m.name}</code>`)) : ''}
${problems?.errors?.length ? notice('error', 'Some values are not valid:', problems.errors.map((e) => html`<code>${e.name}</code>: ${e.message}`)) : ''}
</div>
<div class="cols gen">
<form method="post" action="${action}" id="gen-form" data-preview-url="${action}/preview" class="card wide">
${Object.entries(entityOptions).map(([kind, list]) => html`<datalist id="entities-${kind}">${list.map((e) => html`<option value="${e.name}"></option>`)}</datalist>`)}
${brands.length > 1 && !regenerate ? html`<label>Brand <select name="$brand">${brands.map((b) => html`<option value="${b.id}"${b.id === brandId ? html` selected` : ''}>${b.name}</option>`)}</select></label>` : html`<input type="hidden" name="$brand" value="${brandId}">`}
${regenerate ? html`<input type="hidden" name="$documentId" value="${regenerate.id}">
<label>Version note <input name="$note" value="${note}"></label>
${locked ? html`<label class="check"><input type="checkbox" name="$force" value="true"${force ? html` checked` : ''}> Force: ${regenerate.id} is ${regenerate.status}; regenerating resets it to Draft</label>` : ''}` : ''}
${fields.map((f) => {
    const hint = hintOf(f, getPath(resolved.values, f.name));
    const cls = missingNames.has(f.name) || errorNames.has(f.name) ? 'field invalid' : 'field';
    return html`<div class="${cls}"><span class="flabel">${f.label}${f.required ? html` <span class="req" title="required">*</span>` : ''} <code class="muted">${f.name}</code></span>
${fieldInput(f, getPath(input, f.name), hint)}
${f.help ? html`<small class="muted">${f.help}</small>` : ''}</div>`;
  })}
<p class="buttons">
<button type="submit" name="$action" value="preview">Preview</button>
<button type="submit" name="$action" value="generate" class="primary">${regenerate ? 'Regenerate' : 'Generate'}</button>
</p>
</form>
<section id="preview">
<h2>Preview</h2>
<div id="preview-body">${previewPanel(preview)}</div>
</section>
</div>`,
  });
}

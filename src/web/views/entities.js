import { html, qs } from '../html.js';
import { layout, notice } from './layout.js';

const opt = (value, current, label = value) => html`<option value="${value}"${String(value) === String(current ?? '') ? html` selected` : ''}>${label}</option>`;

/**
 * Entity list with search, kind filter and the create form.
 * @param {{ shell: object, q: string, kind: string, kinds: string[], brands: string[], list: object[],
 *   values?: Record<string, string>, error?: object|null }} p
 */
export function entitiesPage({ shell, q, kind, kinds, brands, list, values = {}, error = null }) {
  const v = (k) => values[k] ?? '';
  return layout({
    ...shell,
    active: 'entities',
    title: 'Entities',
    body: html`
${error ? notice('error', `${error.code}: ${error.message}`, error.details?.existingId ? [html`Existing entity: <a href="/entities/${error.details.existingId}">#${error.details.existingId}</a>`] : []) : ''}
<form method="get" action="/entities" class="searchbar">
<input type="search" name="q" value="${q}" placeholder="Name or alias">
<select name="kind"><option value="">all kinds</option>${kinds.map((k) => opt(k, kind))}</select>
<button type="submit">Find</button>
</form>
<table class="list"><thead><tr><th>Name</th><th>Kind</th><th>Aliases</th><th>Brand</th></tr></thead><tbody>
${list.map((e) => html`<tr><td><a href="/entities/${e.id}">${e.name}</a>${e.matched ? html` <span class="muted">(matched ${e.matched})</span>` : ''}</td><td>${e.kind}</td><td>${e.aliases.join(', ')}</td><td>${e.brand ?? ''}</td></tr>`)}
</tbody></table>
${list.length ? '' : html`<p class="muted">No entities${q ? html` match “${q}”` : ''}.</p>`}
<form method="post" action="/entities" class="card">
<h2>New entity</h2>
<label>Kind <select name="kind" required>${kinds.map((k) => opt(k, v('kind')))}</select></label>
<label>Name <input name="name" value="${v('name')}" required></label>
<label>Aliases <input name="aliases" value="${v('aliases')}" placeholder="comma separated"></label>
<label>Brand <select name="brand"><option value="">—</option>${brands.map((b) => opt(b, v('brand')))}</select></label>
<label>Attributes (JSON) <textarea name="attrs" rows="3" placeholder='{"email": "someone@example.com"}'>${v('attrs')}</textarea></label>
<button type="submit">Create</button>
</form>`,
  });
}

/**
 * One entity: names, attributes, relations, and the edit and relate forms.
 * @param {{ shell: object, entity: object, roles: string[], brands: string[], error?: object|null, message?: string|null }} p
 */
export function entityPage({ shell, entity: e, roles, brands, error = null, message = null }) {
  return layout({
    ...shell,
    active: 'entities',
    title: e.name,
    body: html`
${error ? notice('error', `${error.code}: ${error.message}`) : ''}
${message ? notice('info', message) : ''}
<table class="meta">
<tr><th>Id</th><td>${e.id}</td></tr>
<tr><th>Kind</th><td>${e.kind}</td></tr>
<tr><th>Aliases</th><td>${e.aliases.length ? e.aliases.join(', ') : html`<span class="muted">—</span>`}</td></tr>
<tr><th>Brand</th><td>${e.brand ?? html`<span class="muted">—</span>`}</td></tr>
<tr><th>Documents</th><td>${e.documentCount ? html`<a href="/search${qs({ q: e.name })}">${e.documentCount}</a>` : '0'}</td></tr>
<tr><th>Attributes</th><td>${Object.keys(e.attrs).length ? html`<pre>${JSON.stringify(e.attrs, null, 2)}</pre>` : html`<span class="muted">—</span>`}</td></tr>
</table>
<h2>Relations</h2>
${e.relations.length ? html`<ul>${e.relations.map((r) => html`<li>${r.direction === 'out' ? html`${e.name} <em>${r.role}</em> <a href="/entities/${r.entity.id}">${r.entity.name}</a>` : html`<a href="/entities/${r.entity.id}">${r.entity.name}</a> <em>${r.role}</em> ${e.name}`} <span class="muted">${r.entity.kind}</span></li>`)}</ul>` : html`<p class="muted">None.</p>`}
<div class="forms">
<form method="post" action="/entities/${e.id}" class="card">
<h3>Edit</h3>
<label>Name <input name="name" value="${e.name}" required></label>
<label>Add aliases <input name="aliases" placeholder="comma separated"></label>
<label>Brand <select name="brand"><option value="">—</option>${brands.map((b) => opt(b, e.brand))}</select></label>
<label>Attributes (JSON, merged; null removes a key) <textarea name="attrs" rows="4">${Object.keys(e.attrs).length ? JSON.stringify(e.attrs, null, 2) : ''}</textarea></label>
<button type="submit">Save</button>
</form>
<form method="post" action="/entities/${e.id}/relations" class="card">
<h3>Relate</h3>
<label>${e.name} <select name="role">${roles.map((r) => opt(r, null))}</select></label>
<label>Entity id or name <input name="to" required></label>
<button type="submit">Add relation</button>
</form>
</div>`,
  });
}

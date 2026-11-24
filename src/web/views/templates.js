import { html } from '../html.js';
import { layout, notice } from './layout.js';

/**
 * Templates page: every loaded template with its metadata, then the folders that failed to load.
 * @param {{ shell: object, templates: object[], errors: object[] }} p
 */
export function templatesPage({ shell, templates, errors }) {
  return layout({
    ...shell,
    active: 'templates',
    title: 'Templates',
    body: html`
${errors.length ? notice('error', 'Some template folders did not load:', errors.map((e) => html`<code>${e.id}</code> (${e.source}): ${e.code} — ${e.message}`)) : ''}
<table class="list">
<thead><tr><th>Template</th><th>Category</th><th>Document type</th><th>Numbering</th><th>Renditions</th><th>Sensitivity</th><th>Source</th></tr></thead>
<tbody>
${templates.map((t) => html`<tr id="${t.id}">
<td><a href="/generate/${encodeURIComponent(t.id)}"><strong>${t.meta.title}</strong></a> <code>${t.id}</code> v${t.version}<br><span class="muted">${t.meta.description ?? ''}</span></td>
<td>${t.category}</td>
<td>${t.type}</td>
<td>${t.meta.numbering ? html`${t.meta.numbering.series}${t.meta.numbering.required === false ? html` <span class="muted">(optional)</span>` : ''}` : html`<span class="muted">none</span>`}</td>
<td>${(t.meta.renditions ?? []).join(', ')}</td>
<td>${t.meta.sensitivity}</td>
<td>${t.source}${t.inherits ? html` <span class="muted">(inherits built-in)</span>` : ''}</td>
</tr>`)}
</tbody></table>`,
  });
}

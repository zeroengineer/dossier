import { html } from '../html.js';
import { layout, money, notice, statusBadge } from './layout.js';

/** Snippet text with the matched words (between `[` and `]`) highlighted; everything escaped. */
export function snippet(text) {
  if (!text) return '';
  return String(text).split(/(\[[^\]]*\])/).map((p) => (/^\[[^\]]*\]$/.test(p) ? html`<mark>${p.slice(1, -1)}</mark>` : p));
}

const docLine = (d) => html`<a href="/documents/${d.id}">${d.id}</a> ${d.type}${d.docNumber ? html` <strong>${d.docNumber}</strong>` : ''} — ${d.title}
${d.party ? html` · ${d.party.name}` : ''}${d.docDate ? html` · ${d.docDate}` : ''}${d.amountMinor !== null ? html` · ${money(d.amountMinor, d.currency)}` : ''} ${statusBadge(d.status)}`;

/**
 * Search page: the query form, direct hits, related documents and matching entities.
 * @param {{ shell: object, q: string, result: ReturnType<typeof import('../../services/search.js').search>|null,
 *   error?: object|null }} p
 */
export function searchPage({ shell, q, result, error = null }) {
  return layout({
    ...shell,
    active: 'search',
    title: 'Search',
    body: html`
<form method="get" action="/search" class="searchbar">
<input type="search" name="q" value="${q}" placeholder="Number, party, title or text" autofocus>
<button type="submit">Search</button>
</form>
${error ? notice('error', `${error.code}: ${error.message}`) : ''}
${result ? html`
<h2>Matched <span class="count">${result.hits.length}</span></h2>
${result.hits.length ? html`<ol class="hits">${result.hits.map((h) => html`<li>${docLine(h.document)} <span class="muted">(${h.match})</span>${h.snippet ? html`<blockquote>${snippet(h.snippet)}</blockquote>` : ''}</li>`)}</ol>` : html`<p class="muted">No documents match “${q}”.</p>`}
${result.related.length ? html`<h2>Related <span class="count">${result.related.length}</span></h2>
<ul class="hits">${result.related.map((r) => html`<li>${docLine(r.document)} <span class="muted">via ${r.via.kind} ${r.via.from} (${r.via.relation})</span></li>`)}</ul>` : ''}
${result.entities.length ? html`<h2>Entities</h2>
<ul>${result.entities.map((e) => html`<li><a href="/entities/${e.id}">${e.name}</a> <span class="muted">${e.kind}${e.matched ? ` · alias ${e.matched}` : ''}</span></li>`)}</ul>` : ''}` : ''}`,
  });
}

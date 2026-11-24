import { html, qs } from '../html.js';
import { layout, money, notice, statusBadge } from './layout.js';

const entityLink = (e) => (e ? html`<a href="/entities/${e.id}">${e.name}</a>` : html`<span class="muted">—</span>`);
const opt = (value, current, label = value) => html`<option value="${value}"${value === current ? html` selected` : ''}>${label}</option>`;
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

/** URL of one rendition through the document (sensitivity-checked by readRendition). */
export const renditionUrl = (docId, kind, versionNo, extra = {}) => `/documents/${encodeURIComponent(docId)}/renditions/${encodeURIComponent(kind)}${qs({ version: versionNo, ...extra })}`;

function metaTable(d) {
  const rows = [
    ['Document id', d.id],
    ['Type', d.type],
    ['Title', d.title],
    ['Party', d.party ? html`${entityLink(d.party)} <span class="muted">(${d.party.type})</span>` : null],
    ['Business line', d.businessLine ? entityLink(d.businessLine) : null],
    ['Engagement', d.engagement ? entityLink(d.engagement) : null],
    ['Issuing entity', d.issuingEntity ? entityLink(d.issuingEntity) : null],
    ['Issuing brand', d.issuingBrandId],
    ['Number', d.docNumber ? html`${d.docNumber}${d.numberConflict ? html` <span class="badge warn" title="This number is used by another document of the series">number conflict</span>` : ''}` : null],
    ['Number series', d.numberSeries],
    ['Date', d.docDate],
    ['Due / expiry date', d.dueDate],
    ['Amount', d.amountMinor !== null ? money(d.amountMinor, d.currency) : null],
    ['Status', statusBadge(d.status)],
    ['Sensitivity', d.sensitivity],
    ['Current version', d.currentVersion],
    ['Generated from', d.template ? html`<a href="/templates#${d.template.id}">${d.template.id}</a> v${d.template.version}` : null],
    ['Created', `${d.createdAt} by ${d.createdBy ?? 'unknown'}`],
    ['Updated', d.updatedAt],
  ];
  return html`<table class="meta">${rows.map(([k, v]) => html`<tr><th>${k}</th><td>${v === null || v === undefined || v === '' ? html`<span class="muted">—</span>` : v}</td></tr>`)}</table>`;
}

function versionsTable(d) {
  if (!d.versions.length) return html`<p class="muted">No versions yet.</p>`;
  return html`<table class="list"><thead><tr><th>Version</th><th>Created</th><th>Note</th><th>Renditions</th></tr></thead><tbody>
${[...d.versions].reverse().map((v) => html`<tr${v.isCurrent ? html` class="current"` : ''}>
<td>v${v.versionNo}${v.isCurrent ? html` <span class="badge">current</span>` : ''}</td>
<td>${v.createdAt}<br><span class="muted">${v.createdBy ?? ''}</span></td>
<td>${v.note ?? ''}</td>
<td><ul class="renditions">${v.renditions.map((r) => html`<li><strong>${r.kind}</strong> ${r.displayName}
<span class="muted">${kb(r.bytes)}${r.pageCount ? ` · ${r.pageCount} p` : ''} · sha256 ${r.sha256.slice(0, 12)}…</span>
<a href="${renditionUrl(d.id, r.kind, v.versionNo)}" target="_blank" rel="noopener">open</a>
<a href="${renditionUrl(d.id, r.kind, v.versionNo, { download: 1 })}">download</a></li>`)}</ul></td>
</tr>`)}
</tbody></table>`;
}

function relationsList(d) {
  if (!d.relations.length) return html`<p class="muted">No related documents.</p>`;
  return html`<table class="list"><thead><tr><th>Relation</th><th>Document</th><th></th></tr></thead><tbody>
${d.relations.map((r) => {
    const other = r.document ? html`<a href="/documents/${r.document.id}">${r.document.id}</a> ${r.document.type} ${r.document.docNumber ?? ''} — ${r.document.title} ${statusBadge(r.document.status)}`
      : html`template <a href="/templates#${r.template.id}">${r.template.id}</a> v${r.template.version}`;
    const from = r.direction === 'out' ? d.id : r.document?.id;
    const to = r.direction === 'out' ? (r.document?.id ?? `template:${r.template.id}@${r.template.version}`) : d.id;
    const label = r.direction === 'out' ? `this ${r.type} →` : `← ${r.type} this`;
    return html`<tr><td>${label}</td><td>${other}</td><td>${from ? html`<form method="post" action="/documents/${d.id}/links/delete" class="inline">
<input type="hidden" name="fromId" value="${from}"><input type="hidden" name="toId" value="${to}"><input type="hidden" name="type" value="${r.type}">
<button class="link danger" type="submit">unlink</button></form>` : ''}</td></tr>`;
  })}
</tbody></table>`;
}

/**
 * The document page: metadata (PLAN B4), versions and renditions, entities, relations and the edit forms.
 * @param {{ doc: object, shell: object, statuses: string[], relationTypes: string[], levels: string[],
 *   generated?: { warnings: string[] }|null, message?: string|null }} p
 */
export function documentPage({ doc: d, shell, statuses, relationTypes, levels, generated = null, message = null }) {
  const pdf = d.renditions.find((r) => r.kind === 'pdf');
  const locked = ['Sent', 'Signed', 'Paid'].includes(d.status);
  return layout({
    ...shell,
    active: 'tree',
    title: `${d.id} · ${d.title}`,
    body: html`
${generated ? notice(generated.warnings.length ? 'warning' : 'info', generated.warnings.length ? 'Document generated, but some placeholders printed empty:' : 'Document generated.', generated.warnings) : ''}
${message ? notice('info', message) : ''}
<div class="cols">
<section>
<h2>Metadata</h2>
${metaTable(d)}
${d.template ? html`<p><a class="button" href="/generate/${encodeURIComponent(d.template.id)}${qs({ documentId: d.id })}">Regenerate as a new version</a>${locked ? html` <span class="muted">(${d.status}: needs “force”)</span>` : ''}</p>` : ''}
</section>
<section>
${pdf ? html`<h2>Current PDF</h2><iframe class="pdf" title="Current PDF" src="${renditionUrl(d.id, 'pdf', d.currentVersion)}"></iframe>` : ''}
</section>
</div>

<h2>Versions and renditions</h2>
${versionsTable(d)}

<h2>Related entities</h2>
${d.entities.length ? html`<ul>${d.entities.map((e) => html`<li>${entityLink(e)} <span class="muted">${e.kind} · ${e.role}</span></li>`)}</ul>` : html`<p class="muted">None.</p>`}

<h2>Related documents</h2>
${relationsList(d)}

<div class="forms">
<form method="post" action="/documents/${d.id}/status" class="card">
<h3>Change status</h3>
<label>Status <select name="status">${statuses.map((s) => opt(s, d.status))}</select></label>
<button type="submit">Save status</button>
</form>

<form method="post" action="/documents/${d.id}/links" class="card">
<h3>Link a document</h3>
<label>This document <select name="type">${relationTypes.map((t) => opt(t, null))}</select></label>
<label>Document id <input name="toId" placeholder="DOC-000001" pattern="DOC-[0-9]{6,}" required></label>
<button type="submit">Add link</button>
</form>

<form method="post" action="/documents/${d.id}/metadata" class="card">
<h3>Edit metadata</h3>
<label>Title <input name="title" value="${d.title}"></label>
<label>Number <input name="docNumber" value="${d.docNumber ?? ''}"></label>
<label>Date <input type="date" name="docDate" value="${d.docDate ?? ''}"></label>
<label>Due / expiry date <input type="date" name="dueDate" value="${d.dueDate ?? ''}"></label>
<label>Sensitivity <select name="sensitivity">${levels.map((l) => opt(l, d.sensitivity))}</select></label>
<button type="submit">Save metadata</button>
</form>

<form method="post" action="/upload" enctype="multipart/form-data" class="card">
<h3>Upload a new version</h3>
<input type="hidden" name="documentId" value="${d.id}">
<label>File <input type="file" name="file" required></label>
<label>Note <input name="note"></label>
<label class="check"><input type="checkbox" name="makeCurrent" value="true" checked> Make it the current version</label>
<button type="submit">Upload version</button>
</form>
</div>`,
  });
}

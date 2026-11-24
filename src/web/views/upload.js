import { html } from '../html.js';
import { layout, notice } from './layout.js';

const opt = (value, current, label = value) => html`<option value="${value}"${String(value) === String(current ?? '') ? html` selected` : ''}>${label}</option>`;

/**
 * Upload page: a file plus the metadata of the new document (or the id of the document it is a new version of).
 * @param {{ shell: object, types: string[], parties: Array<{ id: number, kind: string, name: string }>,
 *   statuses: string[], levels: string[], partyTypes: string[], values?: Record<string, string>, error?: object|null }} p
 */
export function uploadPage({ shell, types, parties, statuses, levels, partyTypes, values = {}, error = null }) {
  const v = (k) => values[k] ?? '';
  return layout({
    ...shell,
    active: 'upload',
    title: 'Upload',
    body: html`
${error ? notice('error', `${error.code}: ${error.message}`) : ''}
<form method="post" action="/upload" enctype="multipart/form-data" class="card wide">
<label>File <input type="file" name="file" required></label>
<fieldset>
<legend>New version of an existing document</legend>
<label>Document id <input name="documentId" value="${v('documentId')}" placeholder="DOC-000001 (leave empty for a new document)"></label>
<label>Version note <input name="note" value="${v('note')}"></label>
</fieldset>
<fieldset>
<legend>New document</legend>
<label>Type <input name="type" list="doc-types" value="${v('type')}" placeholder="e.g. Invoice"></label>
<datalist id="doc-types">${types.map((t) => html`<option value="${t}"></option>`)}</datalist>
<label>Title <input name="title" value="${v('title')}" placeholder="defaults to the file name"></label>
<label>Party <select name="partyId"><option value="">—</option>${parties.map((p) => opt(p.id, v('partyId'), `${p.name} (${p.kind})`))}</select></label>
<label>Party type <select name="partyType"><option value="">from the party's kind</option>${partyTypes.map((t) => opt(t, v('partyType')))}</select></label>
<label>Number <input name="docNumber" value="${v('docNumber')}"></label>
<label>Number series <input name="numberSeries" value="${v('numberSeries')}"></label>
<label>Date <input type="date" name="docDate" value="${v('docDate')}"></label>
<label>Due / expiry date <input type="date" name="dueDate" value="${v('dueDate')}"></label>
<label>Amount <input name="amount" value="${v('amount')}" inputmode="decimal" placeholder="1,234.50"></label>
<label>Currency <input name="currency" value="${v('currency')}" placeholder="INR" size="4"></label>
<label>Status <select name="status"><option value="">Draft</option>${statuses.map((s) => opt(s, v('status')))}</select></label>
<label>Sensitivity <select name="sensitivity"><option value="">Internal</option>${levels.map((l) => opt(l, v('sensitivity')))}</select></label>
</fieldset>
<button type="submit">Upload</button>
</form>`,
  });
}

import { html } from '../html.js';
import { layout } from './layout.js';

/**
 * Read-only workspace settings: where the data lives, the acting user, brands and series. (Editing brands is a later
 * feature.)
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
<tr><th>Workspace</th><td>${info.workspace}</td></tr>
<tr><th>Workspace folder</th><td><code>${info.home}</code></td></tr>
<tr><th>Data folder</th><td><code>${info.dataDir}</code></td></tr>
<tr><th>User</th><td>${info.user.id} (clearance ${info.user.clearance})</td></tr>
<tr><th>Default brand</th><td>${info.defaultBrand}</td></tr>
</table>
<h2>Brands</h2>
<table class="list"><thead><tr><th>Id</th><th>Legal name</th><th>Signatories</th></tr></thead><tbody>
${info.brands.map((b) => html`<tr><td>${b.id}</td><td>${b.name}</td><td>${b.signatories.join(', ')}</td></tr>`)}
</tbody></table>
<h2>Number series</h2>
<table class="list"><thead><tr><th>Id</th><th>Pattern</th><th>Scope</th></tr></thead><tbody>
${info.series.map((s) => html`<tr><td>${s.id}</td><td><code>${s.pattern}</code></td><td>${s.scope}</td></tr>`)}
</tbody></table>
<p class="muted">Edit <code>workspace.json</code>, <code>brands/&lt;id&gt;/brand.json</code> and <code>series.json</code> in the workspace folder; restart the server to load changes.</p>`,
  });
}

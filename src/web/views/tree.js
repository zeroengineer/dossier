import { html, qs } from '../html.js';
import { layout, statusBadge } from './layout.js';

const countDocs = (n) => n.documents.length + n.children.reduce((s, c) => s + countDocs(c), 0);

function nodeView(n, depth) {
  const total = countDocs(n);
  return html`<details class="folder"${depth === 0 && total > 0 ? ' open' : ''}>
<summary><a href="/${qs({ node: n.id })}">${n.name}</a> <span class="count">${total}</span></summary>
${n.children.map((c) => nodeView(c, depth + 1))}
${n.documents.length ? html`<ul class="docs">${n.documents.map((d) => html`<li><a href="/documents/${d.id}">${d.displayName}</a> ${statusBadge(d.status)} <span class="muted">${d.id} · ${d.sensitivity}</span></li>`)}</ul>` : ''}
</details>`;
}

/**
 * The folder tree page (root, or one node with its subtree).
 * @param {{ node: import('../../services/hierarchy.js').TreeNode, shell: object }} p
 */
export function treePage({ node, shell }) {
  const isRoot = node.id === '';
  const crumbs = isRoot ? [] : node.id.split('/').map((_, i, a) => a.slice(0, i + 1).join('/'));
  return layout({
    ...shell,
    active: 'tree',
    title: isRoot ? 'Vault' : node.name,
    body: html`
${isRoot ? '' : html`<p class="crumbs"><a href="/">Vault</a>${crumbs.map((c) => html` / <a href="/${qs({ node: c })}">${c.split('/').at(-1)}</a>`)}</p>`}
<p class="actions"><a class="button" href="/upload">Upload a file</a> <a class="button" href="/generate">Generate a document</a></p>
<div class="tree">
${isRoot ? node.children.map((c) => nodeView(c, 0)) : nodeView(node, 0)}
</div>
${isRoot && countDocs(node) === 0 ? html`<p class="muted">The vault is empty. Upload a file or generate a document to start.</p>` : ''}`,
  });
}

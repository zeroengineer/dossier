import { html } from '../html.js';

const NAV = [
  ['tree', '/', 'Vault'],
  ['search', '/search', 'Search'],
  ['upload', '/upload', 'Upload'],
  ['generate', '/generate', 'Generate'],
  ['templates', '/templates', 'Templates'],
  ['entities', '/entities', 'Entities'],
  ['settings', '/settings', 'Settings'],
];

/**
 * The page shell: head, navigation, the acting user and the page body.
 * @param {{ title: string, active?: string, user?: { id: string, clearance: string }, workspace?: string, body: unknown }} page
 * @returns {import('../html.js').SafeHtml}
 */
export function layout({ title, active, user, workspace, body }) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Dossier</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/static/app.css">
<script src="/static/app.js" defer></script>
</head>
<body>
<header class="top">
  <a class="brand" href="/">Dossier</a>
  <nav>${NAV.map(([id, href, label]) => html`<a href="${href}"${id === active ? html` aria-current="page"` : ''}>${label}</a>`)}</nav>
  <span class="who">${workspace ? html`${workspace} · ` : ''}${user ? html`${user.id} (${user.clearance})` : ''}</span>
</header>
<main>
<h1>${title}</h1>
${body}
</main>
</body>
</html>
`;
}

/**
 * A list of problems (`missing` fields, field errors, warnings) as a notice box; nothing when empty.
 * @param {string} kind 'error'|'warning'|'info'
 * @param {string} heading
 * @param {unknown[]} items already-rendered items or strings
 */
export function notice(kind, heading, items = []) {
  return html`<div class="notice ${kind}" role="${kind === 'error' ? 'alert' : 'status'}"><strong>${heading}</strong>${items.length ? html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>` : ''}</div>`;
}

/** Money in minor units as a plain decimal string with the currency code. */
export function money(minor, currency) {
  if (minor === null || minor === undefined) return '';
  const sign = minor < 0 ? '-' : '';
  const a = Math.abs(minor);
  return `${sign}${Math.floor(a / 100).toLocaleString('en-IN')}.${String(a % 100).padStart(2, '0')}${currency ? ` ${currency}` : ''}`;
}

/** A status pill. */
export const statusBadge = (status) => html`<span class="badge status-${String(status).toLowerCase()}">${status}</span>`;

import { html } from '../html.js';
import { layout } from './layout.js';

/**
 * Error page for a failed page request.
 * @param {{ status: number, body: { code: string, message: string } }} err
 * @param {object} [shell] layout extras (user, workspace)
 */
export function errorPage({ status, body }, shell = {}) {
  const title = status === 404 ? 'Not found' : status === 403 ? 'Forbidden' : status >= 500 ? 'Something went wrong' : 'Request refused';
  return layout({
    ...shell,
    title,
    body: html`<p class="error-code">${status} · ${body.code}</p><p>${body.message}</p><p><a href="/">Back to the vault</a></p>`,
  });
}

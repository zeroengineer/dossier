// Markdown rendition of a block document (GitHub-flavoured: pipe tables, `**bold**` kept as written).
import { interpolate } from '../../workspace/index.js';
import { normaliseTable, validateBlocks } from '../blocks.js';
import { brandScope } from '../pdf/document.js';

const oneLine = (s) => String(s ?? '').replace(/\s*\n\s*/g, ' ').trim();
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const hardBreaks = (s) => String(s ?? '').replace(/\r?\n/g, '  \n');

function table(b) {
  const t = normaliseTable(b);
  const sep = (c) => ({ right: '---:', center: ':---:' })[c.align] ?? '---';
  const row = (r, bold) => `| ${t.columns.map((c) => {
    const v = cell(r[c.key]);
    return bold && v ? `**${v}**` : v;
  }).join(' | ')} |`;
  return [
    `| ${t.columns.map((c) => cell(c.label)).join(' | ')} |`,
    `| ${t.columns.map(sep).join(' | ')} |`,
    ...t.rows.map((r) => row(r, false)),
    ...t.totalRows.map((r) => row(r, true)),
  ].join('\n');
}

function signature(b, brand, contact) {
  const out = [];
  const party = b.party ?? (b.signatoryId && brand ? interpolate(brand.strings?.forCompany ?? '', brandScope(brand, contact)) : '');
  if (party) out.push(`**${oneLine(party)}**`);
  const s = b.signatoryId ? brand?.signatories?.find((x) => x.id === b.signatoryId) : null;
  if (b.signatoryId && !s) throw new Error(`blocksToMarkdown: brand has no signatory "${b.signatoryId}"`);
  if (s) out.push(s.name, ...(s.title ? [s.title] : []));
  else out.push('______________________________');
  out.push(...(b.lines ?? []).map(oneLine));
  return out.join('  \n');
}

/**
 * Render blocks as Markdown. A `title` becomes a level-1 heading unless the first block already is that heading.
 * `brand` supplies signatory names and the default "For …" line of signature blocks.
 * @param {Array<object>} blocks
 * @param {{ brand?: object, title?: string, contact?: string }} [opts]
 * @returns {string}
 */
export function blocksToMarkdown(blocks, { brand, title, contact = 'default' } = {}) {
  validateBlocks(blocks);
  const parts = [];
  const first = blocks[0];
  if (title && !(first?.type === 'heading' && first.level === 1 && oneLine(first.text) === oneLine(title))) parts.push(`# ${oneLine(title)}`);
  for (const b of blocks) {
    switch (b.type) {
      case 'heading': parts.push(`${'#'.repeat(b.level)} ${oneLine(b.text)}`); break;
      case 'paragraph': parts.push(hardBreaks(b.text)); break;
      case 'bullets': parts.push(b.items.map((i) => `- ${oneLine(i)}`).join('\n')); break;
      case 'numbered': parts.push(b.items.map((i, n) => `${n + 1}. ${oneLine(i)}`).join('\n')); break;
      case 'table': parts.push(table(b)); break;
      case 'keyValue': parts.push(b.rows.map(([k, v]) => `- **${oneLine(k)}:** ${oneLine(v)}`).join('\n')); break;
      case 'signature': parts.push(signature(b, brand, contact)); break;
      case 'divider': parts.push('---'); break;
      case 'pageBreak': parts.push('<!-- page break -->'); break;
      case 'custom': {
        const md = b.data?.md ?? b.data?.text;
        if (md !== undefined && md !== '') parts.push(String(md));
        break;
      }
      default: break; // spacer
    }
  }
  return `${parts.join('\n\n')}\n`;
}

export { fillMarkdown } from './fill.js';
export { parseMarkdownBlocks } from './parse.js';

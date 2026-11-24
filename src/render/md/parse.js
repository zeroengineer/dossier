// Markdown -> blocks, following the legacy MoU parser (docs/DISCOVERY.md A8 §12): `#`/`##`/`###` headings, `---`
// dividers, `-`/`*` bullets, numbered items, paragraphs (consecutive lines joined with a space), `|` tables with an
// optional alignment row; standalone HTML tags are skipped.

const SIGNATURE_HEADING = /^For\s/;

/**
 * Parse Markdown into blocks. Blocks before the first divider are flagged `cover: true` (when the text has a divider).
 * Each `## For …` heading starts a signature section: it becomes `{ type: 'signature', party: 'For …', lines }` whose
 * lines are the section's paragraphs and list items (bold markers removed); other blocks after the first such heading
 * are dropped, as in the legacy parser. Heading levels 4–6 become 3.
 * @param {string} md
 * @returns {Array<object>}
 */
export function parseMarkdownBlocks(md) {
  const raw = parseRaw(String(md ?? ''));
  const firstDivider = raw.findIndex((b) => b.type === 'divider');
  const blocks = [];
  let sig = null;
  raw.forEach((b, i) => {
    if (b.type === 'heading' && b.level === 2 && SIGNATURE_HEADING.test(b.text)) {
      sig = { type: 'signature', party: b.text, lines: [] };
      blocks.push(sig);
      return;
    }
    if (sig) {
      const plain = (t) => t.replace(/\*\*/g, '');
      if (b.type === 'paragraph') sig.lines.push(plain(b.text));
      else if (b.type === 'bullets' || b.type === 'numbered') sig.lines.push(...b.items.map(plain));
      return;
    }
    if (firstDivider > 0 && i < firstDivider) b.cover = true;
    blocks.push(b);
  });
  return blocks;
}

function parseRaw(md) {
  const lines = md.split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let list = null;
  let table = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: list.type, items: list.items });
    list = null;
  };
  const flushTable = () => {
    if (table) {
      const n = table.headers.length;
      blocks.push({
        type: 'table',
        columns: table.headers.map((label, i) => ({ label, align: table.aligns[i] })),
        rows: table.rows.map((r) => Array.from({ length: n }, (_, i) => r[i] ?? '')),
      });
    }
    table = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
  };
  const pushItem = (type, text) => {
    flushParagraph();
    flushTable();
    if (list && list.type !== type) flushList();
    list ??= { type, items: [] };
    list.items.push(text.trim());
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 1) {
      flushParagraph();
      flushList();
      const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim());
      if (table && table.rows.length === 0 && !table.aligned && cells.every((c) => /^:?-+:?$/.test(c))) {
        table.aligns = cells.map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'));
        table.aligned = true;
        continue;
      }
      if (!table) table = { headers: cells, aligns: cells.map(() => 'left'), rows: [] };
      else table.rows.push(cells);
      continue;
    } else if (table) {
      flushTable();
    }

    if (trimmed.startsWith('#')) {
      flushAll();
      const m = /^(#{1,6})\s+(.*)$/.exec(trimmed);
      if (m) blocks.push({ type: 'heading', level: Math.min(m[1].length, 3), text: m[2].trim() });
      continue;
    }
    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushAll();
      blocks.push({ type: 'divider' });
      continue;
    }
    let m = /^[-*]\s+(.*)$/.exec(trimmed);
    if (m) {
      pushItem('bullets', m[1]);
      continue;
    }
    m = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (m) {
      pushItem('numbered', m[1]);
      continue;
    }
    if (trimmed === '') {
      flushAll();
      continue;
    }
    if (/^<[^>]+>$/.test(trimmed)) continue;
    flushList();
    flushTable();
    paragraph.push(trimmed);
  }
  flushAll();
  return blocks;
}

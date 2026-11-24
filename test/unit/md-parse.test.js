import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMarkdownBlocks } from '../../src/render/md/parse.js';
import { validateBlocks } from '../../src/render/blocks.js';

const MOU = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'mou.md'), 'utf8');

test('parses the fake MoU fixture like the legacy MoU parser', () => {
  const blocks = parseMarkdownBlocks(MOU);
  validateBlocks(blocks);
  assert.deepEqual(blocks, [
    { type: 'heading', level: 1, text: 'MEMORANDUM OF UNDERSTANDING', cover: true },
    { type: 'heading', level: 2, text: 'Between', cover: true },
    { type: 'paragraph', text: '**Acme Events Private Limited**, Example City (the "First Party")', cover: true },
    { type: 'paragraph', text: 'and', cover: true },
    { type: 'paragraph', text: '**Example Partner Organisation**, Sample Town (the "Second Party")', cover: true },
    { type: 'divider' },
    { type: 'heading', level: 2, text: '1. Purpose' },
    { type: 'paragraph', text: 'This memorandum records the understanding between the parties for the **Example Annual Meet**, to be held at the venue named below.' },
    { type: 'heading', level: 3, text: '1.1 Scope' },
    { type: 'bullets', items: ['Ticketing for the event', 'Settlement of collections'] },
    { type: 'numbered', items: ['First numbered step', 'Second numbered step'] },
    {
      type: 'table',
      columns: [{ label: 'Particulars', align: 'left' }, { label: 'Amount', align: 'right' }],
      rows: [['Platform fee', '₹10,000'], ['Total', '₹10,000']],
    },
    { type: 'heading', level: 3, text: 'Deep heading' },
    { type: 'divider' },
    { type: 'signature', party: 'For Acme Events Private Limited', lines: ['Name: ____________________', 'Designation: ____________________'] },
    { type: 'signature', party: 'For Example Partner Organisation', lines: ['Name: ____________________', 'Seal: ____________________'] },
  ]);
});

test('no divider means no cover section; table rows are padded to the header width', () => {
  const blocks = parseMarkdownBlocks('# Title\n\nText\n| A | B | C |\n| 1 |\nafter');
  assert.deepEqual(blocks, [
    { type: 'heading', level: 1, text: 'Title' },
    { type: 'paragraph', text: 'Text' },
    { type: 'table', columns: [{ label: 'A', align: 'left' }, { label: 'B', align: 'left' }, { label: 'C', align: 'left' }], rows: [['1', '', '']] },
    { type: 'paragraph', text: 'after' },
  ]);
});

test('list kinds switch cleanly, "#" without a space is dropped, *** is a divider (a leading one makes no cover)', () => {
  assert.deepEqual(parseMarkdownBlocks('***\n- a\n1) b\n- c\n#nospace\n'), [
    { type: 'divider' },
    { type: 'bullets', items: ['a'] },
    { type: 'numbered', items: ['b'] },
    { type: 'bullets', items: ['c'] },
  ]);
});

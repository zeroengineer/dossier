import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkClauses, clauseBlocks, letterScope, paragraphBlocks, referenceNumber, signatureBlock, textLines,
} from '../../src/render/letterTemplate.js';
import { validateBlocks } from '../../src/render/blocks.js';
import { brandScope, createFormatter } from '../../src/render/pdf/index.js';
import { effectiveParams } from '../../src/services/fields.js';

const fmt = createFormatter({ currencySymbol: '₹', numberLocale: 'en-IN', dateFormats: { long: 'D MMMM YYYY' } });
const brand = {
  id: 'acme', legalName: 'Acme Events Private Limited', series: { 'internship-certificate': 'hr-cert' },
  contacts: { default: { email: 'hello@example.com', website: 'www.example.com' }, hr: { email: 'hr@example.com' } },
};
const meta = {
  id: 'offer-letter', contact: 'hr', numbering: { series: 'brand', required: false },
  fields: [
    { name: 'employee', source: 'entity:person' }, { name: 'recipient.name', source: 'employee.name', type: 'string' },
    { name: 'date', source: 'today', type: 'date' }, { name: 'stipend', source: 'ask', type: 'money' },
    { name: 'placeOfWork', source: 'ask' }, { name: 'probation', source: 'ask', type: 'boolean' },
  ],
};
const env = { brand, meta, fmt, params: {} };

test('letterScope formats values for print and derives the full and first name', () => {
  const values = {
    employee: { id: 'E1', kind: 'person', name: 'Jordan Placeholder' }, recipient: { name: 'Jordan Placeholder' }, honorific: 'Mr.',
    date: '2026-08-29', stipend: 1000050, placeOfWork: ['Line 1', 'Line 2'], probation: false,
  };
  const s = letterScope(values, env, { extra: 'x' });
  assert.equal(s.company, 'Acme Events Private Limited');
  assert.equal(s.currency, '₹');
  assert.equal(s.employee, 'Jordan Placeholder');
  assert.equal(s.date, '29 August 2026');
  assert.equal(s.stipend, '₹10,000.50');
  assert.equal(s.stipendWords, 'Rupees Ten Thousand and Fifty Paise Only');
  assert.equal(s.placeOfWork, 'Line 1\nLine 2');
  assert.equal(s.probation, false);
  assert.deepEqual([s.fullName, s.firstName, s.extra], ['Mr. Jordan Placeholder', 'Jordan', 'x']);
  // The hr contact falls back per key to the default contact.
  assert.deepEqual(s.contact, { email: 'hr@example.com', website: 'www.example.com' });
  assert.equal(letterScope({ ...values, salutationName: 'Mr. Placeholder' }, env).firstName, 'Mr. Placeholder');
  assert.equal(letterScope({ ...values, stipend: 1000000 }, env).stipend, '₹10,000');
});

test('clauseBlocks numbers clauses, honours when / unless and takes bullets from values', () => {
  const clauses = [
    { title: 'Probation', when: 'probation', paragraphs: ['On probation.'] },
    { title: 'Duties of {role}', paragraphs: ['Intro:', { text: 'Only with probation.', when: 'probation' }, { text: 'No probation.', unless: 'probation', moveDown: 0.8 }],
      bullets: ['Default duty'], bulletsFrom: 'duties', after: ['After.'] },
    { title: 'Plain' },
  ];
  const blocks = clauseBlocks(clauses, { role: 'Tester' }, { probation: false, duties: ['Own duty', '{role} duty'] });
  assert.deepEqual(blocks, [
    { type: 'heading', level: 2, text: '1. Duties of Tester' },
    { type: 'paragraph', text: 'Intro:' },
    { type: 'paragraph', text: 'No probation.', style: { moveDown: 0.8 } },
    { type: 'bullets', items: ['Own duty', 'Tester duty'] },
    { type: 'paragraph', text: 'After.' },
    { type: 'heading', level: 2, text: '2. Plain' },
  ]);
  validateBlocks(blocks);
  const withDefaults = clauseBlocks(clauses, { role: 'Tester' }, { probation: true }, { number: false });
  assert.deepEqual(withDefaults.filter((b) => b.type === 'heading').map((b) => b.text), ['Probation', 'Duties of Tester', 'Plain']);
  assert.deepEqual(withDefaults.find((b) => b.type === 'bullets').items, ['Default duty']);
});

test('paragraphBlocks applies defaults that an item can override', () => {
  assert.deepEqual(paragraphBlocks(['A {x}', { text: 'B', align: 'justify', moveDown: 2 }], { x: 1 }, {}, { align: 'left', moveDown: 1.2 }), [
    { type: 'paragraph', text: 'A 1', align: 'left', style: { moveDown: 1.2 } },
    { type: 'paragraph', text: 'B', align: 'justify', style: { moveDown: 2 } },
  ]);
});

test('checkClauses names the first problem', () => {
  assert.equal(checkClauses([{ title: 'A', paragraphs: ['x', { text: 'y' }], bullets: ['z'] }]), true);
  assert.throws(() => checkClauses('x'), /clauses must be a list/);
  assert.throws(() => checkClauses([{ title: '' }]), /clauses\.0\.title is required/);
  assert.throws(() => checkClauses([{ title: 'A', paragraphs: [1] }]), /clauses\.0\.paragraphs\.0/);
  assert.throws(() => checkClauses([{ title: 'A', bullets: 'x' }]), /clauses\.0\.bullets/);
});

test('textLines, referenceNumber and the signature block variants', () => {
  assert.deepEqual(textLines('a\n\n b \r\nc'), ['a', 'b', 'c']);
  assert.deepEqual(textLines([' a ', '', 'b']), ['a', 'b']);
  assert.deepEqual(textLines(undefined), []);
  // Unnumbered offer letter: nothing, even in a preview. Mapped series: DRAFT in a preview, the number otherwise.
  assert.equal(referenceNumber({ number: null }, { ...env, draft: true }), '');
  const cert = { ...env, meta: { ...meta, id: 'internship-certificate', numbering: { series: 'brand', required: true } } };
  assert.equal(referenceNumber({ number: null }, { ...cert, draft: true }), 'DRAFT');
  assert.equal(referenceNumber({ number: 'ACM/HR/2026/EXP-001' }, { ...cert, draft: false }), 'ACM/HR/2026/EXP-001');
  const params = { signature: { forLine: 'For {legalName}', lines: ['Authorized Signatory'] } };
  const scope = brandScope(brand, 'hr');
  assert.deepEqual(signatureBlock({ signatory: { id: 'md' }, seal: true }, params, scope), {
    type: 'signature', signatoryId: 'md', party: 'For Acme Events Private Limited', lines: ['Authorized Signatory'],
  });
  assert.deepEqual(signatureBlock({ signatory: { id: 'md' }, seal: false }, params, scope).style,
    { block: { seal: null, offsets: { image: 16, name: 10 } } });
});

test('effectiveParams: brand templateParams replace whole top-level keys', () => {
  const m = { id: 'offer-letter', params: { a: 1, clauses: [{ title: 'x' }], nested: { k: 1, j: 2 } } };
  assert.equal(effectiveParams(m, {}), m.params);
  assert.deepEqual(effectiveParams(m, { templateParams: { 'offer-letter': { clauses: [], nested: { k: 3 } } } }),
    { a: 1, clauses: [], nested: { k: 3 } });
});

test('spacer blocks take points or lines', () => {
  validateBlocks([{ type: 'spacer', size: 12 }, { type: 'spacer', lines: 1.2 }]);
  assert.throws(() => validateBlocks([{ type: 'spacer', lines: -1 }]), /lines must be a non-negative number/);
  assert.throws(() => validateBlocks([{ type: 'spacer' }]), /size must be a non-negative number/);
});

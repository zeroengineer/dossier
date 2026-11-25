import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_TYPE_KEYWORDS, IDENTITY_TYPES, TEXT_WINDOW, findTextDate, hasKeyword, nameHasKeyword, plausibleDate, textType,
  textTypes, typeKeywordTable, wordsOf,
} from '../../src/domain/doctypes.js';
import { DEFAULT_ROUTES, leafIn, routeFor, routingConfig } from '../../src/domain/routing.js';
import { chooseDate } from '../../src/services/importer.js';
import { WorkspaceSchema, formatIssues } from '../../src/workspace/schemas.js';

const NOW = new Date('2026-06-15T12:00:00Z');
const date = (text, opts = {}) => findTextDate(text, { now: NOW, ...opts })?.date ?? null;

test('keywords match whole words only: "pan" is not in "company", "moa" is not in "moana"', () => {
  const name = (s) => wordsOf(s);
  assert.equal(hasKeyword(name('company_profile'), 'pan'), false);
  assert.equal(hasKeyword(name('Company Pan Card'), 'pan'), true);
  assert.equal(hasKeyword(name('pan-2026'), 'pan'), true);
  assert.equal(hasKeyword(name('japan trip'), 'pan'), false);
  assert.equal(hasKeyword(name('moana_notes'), 'moa'), false);
  assert.equal(hasKeyword(name('MOA'), 'moa'), true);
  assert.equal(hasKeyword(name('Example_Org_MoA.signed'), 'moa'), true);
  // A plural, and a phrase written together.
  assert.equal(hasKeyword(name('Voters_Card'), 'voter'), true);
  assert.equal(hasKeyword(name('example-pancard'), 'pan card'), true);
  assert.equal(hasKeyword(name('cancelled check'), 'cancelled check'), true);
  assert.equal(hasKeyword(name('uncancelled checklist'), 'cancelled check'), false);
  assert.equal(hasKeyword(name('anything'), '--'), false);
});

test('every built-in keyword type has a route, identity types route to the identity folder and the company keeps its own', () => {
  for (const t of Object.keys(BUILTIN_TYPE_KEYWORDS)) assert.ok(DEFAULT_ROUTES[t], `${t} has a route`);
  const cfg = routingConfig({});
  for (const t of IDENTITY_TYPES) assert.equal(routeFor(t, cfg).leaf, 'Identity Documents');
  assert.equal(leafIn('people', 'Identity Documents'), 'Identity Documents');
  assert.equal(leafIn('company', 'Identity Documents'), 'Legal and Registration');
  assert.deepEqual(routeFor('GST Certificate', cfg), { top: 'company', leaf: 'Legal and Registration', known: true, override: false });
  assert.deepEqual(routeFor('Cancelled Cheque', cfg), { top: 'company', leaf: 'Banking and Payments', known: true, override: false });
  assert.equal(leafIn('products', DEFAULT_ROUTES.Pricing.leaf), 'Pricing');
});

test('text phrases: whole words, case and line breaks ignored, the earliest phrase wins', () => {
  const table = typeKeywordTable();
  assert.deepEqual(textType('INCOME TAX DEPARTMENT\nPermanent Account\nNumber Card', table), { type: 'PAN Card', phrase: 'Permanent Account Number' });
  assert.equal(textType('Government of India\nUnique Identification Authority of India', table).type, 'Aadhaar Card');
  // Earliest: a GST certificate that mentions incorporation later is a GST certificate.
  assert.equal(textType('Form GST REG-06 ... see the Certificate of Incorporation', table).type, 'GST Certificate');
  // Phrases other documents quote are not built in.
  for (const quoted of ['our proposal for the event', 'see our brochure', 'Tax Invoice', 'Memorandum of Understanding']) {
    assert.equal(textType(quoted, table), null, quoted);
  }
  assert.equal(textType('Impermanent Account Numbers', table), null);
  // Only the first TEXT_WINDOW characters are read.
  assert.equal(textType(`${'x '.repeat(TEXT_WINDOW)}Permanent Account Number`, table), null);
});

test('workspace type keywords merge over the built-ins and add local types', () => {
  const table = typeKeywordTable({
    'PAN Card': { names: ['tax id card'] },
    'Startup Mission Certificate': { names: ['startup mission'], text: ['Example Startup Mission'] },
  });
  assert.deepEqual(table.get('pan card').names, ['pan', 'pancard', 'pan card', 'tax id card']);
  assert.deepEqual(table.get('pan card').text, ['Permanent Account Number']);
  assert.deepEqual(table.get('startup mission certificate'), { type: 'Startup Mission Certificate', names: ['startup mission'], text: ['Example Startup Mission'] });
  assert.equal(textType('This certifies registration with the Example Startup Mission.', table).type, 'Startup Mission Certificate');
});

test('workspace.json import.typeKeywords is validated', () => {
  const ok = WorkspaceSchema.parse({ name: 'W', defaultBrand: 'a', import: { typeKeywords: { 'Local Permit': { names: ['permit'] } } } });
  assert.deepEqual(ok.import.typeKeywords['Local Permit'], { names: ['permit'], text: [] });
  assert.deepEqual(WorkspaceSchema.parse({ name: 'W', defaultBrand: 'a' }).import, { typeKeywords: {} });
  const bad = (typeKeywords) => {
    const r = WorkspaceSchema.safeParse({ name: 'W', defaultBrand: 'a', import: { typeKeywords } });
    assert.equal(r.success, false);
    return formatIssues(r.error);
  };
  assert.match(bad({ X: { names: ['--'] } }), /import\.typeKeywords\.X\.names\.0/);
  assert.match(bad({ X: { words: ['x'] } }), /import\.typeKeywords\.X/);
  assert.match(bad({ X: { names: 'x' } }), /import\.typeKeywords\.X\.names/);
});

test('date formats: day first, ISO, month names with ordinals', () => {
  assert.equal(date('05/03/2025'), '2025-03-05');
  assert.equal(date('05-03-2025'), '2025-03-05');
  assert.equal(date('05.03.2025'), '2025-03-05');
  assert.equal(date('5/3/2025'), '2025-03-05');
  assert.equal(date('2025-03-05'), '2025-03-05');
  assert.equal(date('5 March 2025'), '2025-03-05');
  assert.equal(date('12th Mar, 2025'), '2025-03-12');
  assert.equal(date('22nd day of September,\n2025'), '2025-09-22');
  assert.equal(date('March 5, 2025'), '2025-03-05');
  assert.equal(date('Sept 1st 2025'), '2025-09-01');
  assert.equal(date('Mar 12th, 2025'), '2025-03-12');
  // Not dates: mixed separators, numbers inside longer numbers, document numbers.
  assert.equal(date('05/03-2025'), null);
  assert.equal(date('ACM-2026-0131 and 1205/03/20251'), null);
});

test('date plausibility: impossible dates, before 1990 and more than a year ahead are rejected', () => {
  assert.equal(date('31/02/2025'), null);
  assert.equal(date('29/02/2024'), '2024-02-29');
  assert.equal(date('13/13/2025'), null);
  assert.equal(date('31/12/1989'), null);
  assert.equal(date('01/01/1990'), '1990-01-01');
  assert.equal(date('15/06/2027'), '2027-06-15');
  assert.equal(date('16/06/2027'), null);
  assert.equal(plausibleDate(0, 1, 2025, NOW), null);
  assert.equal(plausibleDate(1, 'Feb', 2025, NOW), '2025-02-01');
});

test('a labelled date beats an earlier unlabelled one; birth and expiry dates are not document dates', () => {
  assert.deepEqual(findTextDate('Period 01/01/2025 to 31/01/2025\nDate: 05/02/2025', { now: NOW }), { date: '2025-02-05', labelled: true });
  assert.deepEqual(findTextDate('Period 01/01/2025 to 31/01/2025', { now: NOW }), { date: '2025-01-01', labelled: false });
  for (const [label, iso] of [['Dated 12th March 2025', '2025-03-12'], ['Date of Issue: 01.04.2025', '2025-04-01'],
    ['Issued on Jan 23, 2025', '2025-01-23'], ['Invoice Date - 2025-05-06', '2025-05-06'],
    ['Date of Incorporation 31/10/2024', '2024-10-31'], ['w.e.f. 01/04/2025', '2025-04-01'],
    ['Date of Registration 14/02/2026', '2026-02-14'], ['Dated, Example City, 19-05-2023', '2023-05-19']]) {
    assert.deepEqual(findTextDate(`Ref 01/01/2020\n${label}`, { now: NOW }), { date: iso, labelled: true }, label);
  }
  // "Updated" is not the label "date"; a label whose date is not a date falls through to the next.
  assert.equal(date('Updated 01/01/2024\nDate: 02/02/2024'), '2024-02-02');
  assert.equal(date('Date: TBD\nDate: 03/03/2024'), '2024-03-03');
  // Birth and expiry dates.
  assert.equal(date('Date of Birth: 01/01/1995'), null);
  assert.equal(date('DOB 01/01/1995\nIssued on 02/02/2024'), '2024-02-02');
  assert.equal(date('Valid till 01/01/2026, Name'), null);
  assert.equal(date('01/01/1995', { labelledOnly: true }), null);
  assert.equal(date('Date: 01/01/1995', { labelledOnly: true }), '1995-01-01');
});

test('chooseDate: text, then file name, then file time; identity documents ignore unlabelled text dates', () => {
  const mtime = new Date(2026, 0, 2, 10, 0, 0);
  assert.deepEqual(chooseDate('Date: 05/03/2025', '2026-01-01_x.pdf', mtime, { now: NOW }), { date: '2025-03-05', from: 'text-labelled' });
  assert.deepEqual(chooseDate('see 05/03/2025', '2026-01-01_x.pdf', mtime, { now: NOW }), { date: '2025-03-05', from: 'text-first' });
  assert.deepEqual(chooseDate('no date here', '2026-01-01_x.pdf', mtime, { now: NOW }), { date: '2026-01-01', from: 'filename' });
  assert.deepEqual(chooseDate('', 'x.pdf', mtime, { now: NOW }), { date: '2026-01-02', from: 'mtime' });
  assert.deepEqual(chooseDate('01/11/1999 holder name', 'id.pdf', mtime, { now: NOW, identity: true }), { date: '2026-01-02', from: 'mtime' });
  assert.equal(chooseDate('', 'x.pdf', new Date(1980, 0, 1), { now: NOW }), null);
  assert.equal(chooseDate('', 'x.pdf', null, { now: NOW }), null);
});

test('guarded keywords: "pan" before "india", a bare "gst" in a filing, no bare "epic" or "recognition"', () => {
  const pan = (n) => nameHasKeyword(wordsOf(n), 'pan');
  assert.equal(pan('Pan India rollout plan'), false);
  assert.equal(pan('pan india'), false);
  assert.equal(pan('Example PAN'), true);
  assert.equal(pan('pan india and pan copy'), true);
  const gst = (n) => nameHasKeyword(wordsOf(n), 'gst');
  assert.equal(gst('acme_gst'), true);
  assert.equal(gst('Example Org GST'), true);
  assert.equal(gst('GST'), true);
  assert.equal(gst('GST return Q1'), false);
  assert.equal(gst('gst-2025-03'), false);
  assert.equal(gst('gst invoice'), false);
  assert.equal(gst('gst of the example org group'), false, 'more than three other words');
  assert.equal(nameHasKeyword(wordsOf('GST certificate 2025'), 'gst certificate'), true);
  // Certificate words allow longer names and digits; company suffixes and "copy" do not count as words.
  assert.equal(gst('Example Org Private Limited GST'), true);
  assert.equal(gst('GST Example Org Pvt Ltd copy'), true);
  assert.equal(gst('GST cert v2'), true);
  assert.equal(gst('the example org group gst registration 2025'), true);
  // Filing words, months and quarters always block it, also for the longer GST keywords.
  for (const n of ['GST Annual', 'GST Assessment Order', 'GST notice', 'GST ledger', 'GST payment', 'gst mar', 'GST September', 'gst q3', 'GST certificate statement']) {
    assert.equal(gst(n), false, n);
  }
  assert.equal(nameHasKeyword(wordsOf('GST registration annual return'), 'gst registration'), false);
  assert.equal(nameHasKeyword(wordsOf('Udyam filing'), 'udyam'), false);
  assert.equal(nameHasKeyword(wordsOf('Udyam certificate'), 'udyam'), true);
  assert.equal(nameHasKeyword(wordsOf('MSME payment report'), 'msme'), false);
  assert.equal(nameHasKeyword(wordsOf('Example Org MSME'), 'msme'), true);
  const all = (n) => [...typeKeywordTable().values()].filter((k) => k.names.some((w) => nameHasKeyword(wordsOf(n), w))).map((k) => k.type);
  assert.deepEqual(all('epic campaign'), []);
  assert.deepEqual(all('epic card'), ['Voter ID']);
  assert.deepEqual(all('recognition award'), []);
  assert.deepEqual(all('recognition certificate'), ['Startup Recognition Certificate']);
});

test('textTypes lists every phrase type, earliest first', () => {
  assert.deepEqual(textTypes('Form GST REG-06 ... Permanent Account Number', typeKeywordTable()).map((h) => h.type), ['GST Certificate', 'PAN Card']);
});

test('date labels: birth, expiry, validity, due and renewal dates are never taken; specific labels outrank "Date"', () => {
  assert.equal(date('Birth date: 01/01/1995'), null);
  assert.equal(date('Birth date: 01/01/1995', { labelledOnly: true }), null);
  assert.equal(date('Expiry Date: 01/01/2026'), null);
  assert.equal(date('Due Date: 10/03/2025'), null);
  assert.equal(date('Renewal date 01/04/2026'), null);
  assert.equal(date('Valid until date 01/04/2026'), null);
  assert.equal(date('Due Date: 10/03/2025\nInvoice Date: 01/03/2025'), '2025-03-01');
  assert.equal(date('Expiry Date: 01/01/2026\nDate: 02/02/2025'), '2025-02-02');
  assert.equal(date('Date: 02/02/2025\nDate of Issue: 03/03/2025'), '2025-03-03');
  assert.equal(date('Dated 01/01/2025\nIssued on 04/04/2025'), '2025-04-04');
  assert.equal(date('Date: 02/02/2025\nDate: 03/03/2025'), '2025-02-02', 'within a rank the first wins');
  // "Date of <words> Registration" ranks with the specific labels; the first specific one wins.
  assert.equal(date('Date: 01/01/2025\nDate of Example Registration 14/02/2026\nDate of Incorporation 31/10/2025'), '2026-02-14');
  // A birth word on the line before a label, within 30 characters, also disqualifies it.
  assert.equal(date('Holder born (birth) Date 01/01/1995'), null);
});

test('workspace.json import is strict and type names must not be blank', () => {
  const r1 = WorkspaceSchema.safeParse({ name: 'W', defaultBrand: 'a', import: { typeKeyword: {} } });
  assert.equal(r1.success, false);
  assert.match(formatIssues(r1.error), /import/);
  const r2 = WorkspaceSchema.safeParse({ name: 'W', defaultBrand: 'a', import: { typeKeywords: { '  ': { names: ['x'] } } } });
  assert.equal(r2.success, false);
  assert.match(formatIssues(r2.error), /import\.typeKeywords/);
});

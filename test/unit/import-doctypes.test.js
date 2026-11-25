import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_TYPE_KEYWORDS, IDENTITY_TYPES, TEXT_WINDOW, findTextDate, hasKeyword, plausibleDate, textType, typeKeywordTable, wordsOf,
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
  // Earliest: an MoU that mentions a certificate later is still an MoU.
  assert.equal(textType('Memorandum of Understanding between ... see the Certificate of Incorporation', table).type, 'MoU');
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
  assert.deepEqual(chooseDate('Date: 05/03/2025', '2026-01-01_x.pdf', mtime, { now: NOW }), { date: '2025-03-05', from: 'text' });
  assert.deepEqual(chooseDate('see 05/03/2025', '2026-01-01_x.pdf', mtime, { now: NOW }), { date: '2025-03-05', from: 'text' });
  assert.deepEqual(chooseDate('no date here', '2026-01-01_x.pdf', mtime, { now: NOW }), { date: '2026-01-01', from: 'filename' });
  assert.deepEqual(chooseDate('', 'x.pdf', mtime, { now: NOW }), { date: '2026-01-02', from: 'mtime' });
  assert.deepEqual(chooseDate('01/11/1999 holder name', 'id.pdf', mtime, { now: NOW, identity: true }), { date: '2026-01-02', from: 'mtime' });
  assert.equal(chooseDate('', 'x.pdf', new Date(1980, 0, 1), { now: NOW }), null);
  assert.equal(chooseDate('', 'x.pdf', null, { now: NOW }), null);
});

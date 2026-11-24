import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WorkspaceSchema, BrandSchema, SeriesFileSchema, SeedsSchema, PALETTE_DEFAULTS, formatIssues,
} from '../../src/workspace/schemas.js';
import { minimalBrand } from '../helpers/workspace.js';

test('WorkspaceSchema fills locale, users and hierarchy defaults', () => {
  const ws = WorkspaceSchema.parse({ name: 'W', defaultBrand: 'acme', users: { demo: {} } });
  assert.deepEqual(ws.locale, {
    currencySymbol: '₹', currencyCode: 'INR', numberLocale: 'en-IN',
    dateFormats: { short: 'DD/MM/YYYY', long: 'D MMMM YYYY', us: 'MMMM D, YYYY' },
  });
  assert.equal(ws.users.demo.clearance, 'Confidential');
  assert.deepEqual(ws.hierarchy, {});
});

test('WorkspaceSchema keeps partial locale overrides and fills the rest', () => {
  const ws = WorkspaceSchema.parse({ name: 'W', defaultBrand: 'a', locale: { currencySymbol: '$', dateFormats: { short: 'MM/DD/YYYY' } } });
  assert.equal(ws.locale.currencySymbol, '$');
  assert.equal(ws.locale.currencyCode, 'INR');
  assert.equal(ws.locale.dateFormats.short, 'MM/DD/YYYY');
  assert.equal(ws.locale.dateFormats.long, 'D MMMM YYYY');
});

test('WorkspaceSchema rejects an unknown clearance and a wrong-sized topLevel', () => {
  const r1 = WorkspaceSchema.safeParse({ name: 'W', defaultBrand: 'a', users: { x: { clearance: 'TopSecret' } } });
  assert.equal(r1.success, false);
  assert.match(formatIssues(r1.error), /users\.x\.clearance/);
  const r2 = WorkspaceSchema.safeParse({ name: 'W', defaultBrand: 'a', hierarchy: { topLevel: ['a', 'b'] } });
  assert.equal(r2.success, false);
  assert.match(formatIssues(r2.error), /hierarchy\.topLevel/);
});

test('BrandSchema fills palette, fonts, assets, tax and collection defaults', () => {
  const b = BrandSchema.parse(minimalBrand());
  assert.deepEqual(b.palette, PALETTE_DEFAULTS);
  assert.equal(PALETTE_DEFAULTS.ink, '#1a1a1a');
  assert.equal(PALETTE_DEFAULTS.section, '#606f7b');
  assert.equal(b.fonts.regular, 'builtin:Manrope-Regular');
  assert.equal(b.fonts.extrabold, 'builtin:Manrope-ExtraBold');
  assert.equal(b.fonts.extralight, 'builtin:Manrope-ExtraLight');
  assert.equal(b.assets.logo, 'assets/logo.png');
  assert.deepEqual(b.registrations, []);
  assert.deepEqual(b.bankAccounts, []);
  assert.deepEqual(b.signatories, []);
  assert.deepEqual(b.letterhead, { lines: [] });
  assert.deepEqual(b.footer, { left: '', center: '', right: '' });
  assert.equal(b.tax.defaultMode, 'none');
  assert.equal(b.tax.modes[0].id, 'none');
});

test('BrandSchema merges a partial palette with defaults', () => {
  const b = BrandSchema.parse(minimalBrand('acme', { palette: { accent: '#0a6b35' } }));
  assert.equal(b.palette.accent, '#0a6b35');
  assert.equal(b.palette.rule, '#e8e8e8');
});

test('BrandSchema requires contacts.default and names the field', () => {
  const r = BrandSchema.safeParse(minimalBrand('acme', { contacts: { hr: { email: 'hr@example.com' } } }));
  assert.equal(r.success, false);
  assert.match(formatIssues(r.error), /contacts/);
  assert.match(formatIssues(r.error), /default/);
});

test('BrandSchema reports a missing legalName with its path', () => {
  const { legalName, ...rest } = minimalBrand();
  const r = BrandSchema.safeParse(rest);
  assert.equal(r.success, false);
  assert.match(formatIssues(r.error), /^legalName: /m);
});

test('BrandSchema rejects a non-hex palette colour', () => {
  const r = BrandSchema.safeParse(minimalBrand('acme', { palette: { ink: 'black' } }));
  assert.equal(r.success, false);
  assert.match(formatIssues(r.error), /palette\.ink/);
});

test('BrandSchema rejects a tax.defaultMode that is not a declared mode', () => {
  const r = BrandSchema.safeParse(minimalBrand('acme', { tax: { modes: [{ id: 'igst', label: 'IGST', rates: [{ label: 'IGST', rate: 0.18 }] }], defaultMode: 'gst' } }));
  assert.equal(r.success, false);
  assert.match(formatIssues(r.error), /tax\.defaultMode/);
});

test('SeriesFileSchema fills start and counter defaults', () => {
  const s = SeriesFileSchema.parse([
    { id: 'inv', pattern: 'X-{YYYY}-{####}', scope: 'brand+year' },
    { id: 'dn', pattern: 'X-DN-{YYYY}-{####}', scope: 'brand+year', counter: 'inv', start: 5 },
  ]);
  assert.equal(s[0].start, 1);
  assert.equal(s[0].counter, 'inv');
  assert.equal(s[1].counter, 'inv');
  assert.equal(s[1].start, 5);
});

test('SeriesFileSchema rejects a bad scope, duplicate ids and an unknown counter', () => {
  const bad = SeriesFileSchema.safeParse([{ id: 'a', pattern: 'A', scope: 'planet' }]);
  assert.equal(bad.success, false);
  assert.match(formatIssues(bad.error), /0\.scope/);
  const dup = SeriesFileSchema.safeParse([{ id: 'a', pattern: 'A', scope: 'global' }, { id: 'a', pattern: 'B', scope: 'global' }]);
  assert.equal(dup.success, false);
  assert.match(formatIssues(dup.error), /duplicate series id "a"/);
  const ctr = SeriesFileSchema.safeParse([{ id: 'a', pattern: 'A', scope: 'global', counter: 'zzz' }]);
  assert.equal(ctr.success, false);
  assert.match(formatIssues(ctr.error), /0\.counter/);
});

test('SeriesFileSchema validates patterns and shared-counter scopes', () => {
  const tok = SeriesFileSchema.safeParse([{ id: 'a', pattern: 'A-{PREFIX}-{##}' }, { id: 'b', pattern: 'B-{YYYY}' }]);
  assert.equal(tok.success, false);
  assert.match(formatIssues(tok.error), /0\.pattern.*unknown token \{PREFIX\}/);
  assert.match(formatIssues(tok.error), /1\.pattern.*exactly one counter/);
  const scope = SeriesFileSchema.safeParse([
    { id: 'inv', pattern: 'I-{YYYY}-{####}' },
    { id: 'dn', pattern: 'D-{YYYY}-{####}', scope: 'brand', counter: 'inv' },
  ]);
  assert.equal(scope.success, false);
  assert.match(formatIssues(scope.error), /1\.scope.*shares the counter of "inv"/);
  const year = SeriesFileSchema.safeParse([
    { id: 'inv', pattern: 'I-{YYYY}-{####}' },
    { id: 'dn', pattern: 'D-{FY}-{####}', counter: 'inv' },
  ]);
  assert.equal(year.success, false);
  assert.match(formatIssues(year.error), /1\.pattern.*same year/);
  const chain = SeriesFileSchema.safeParse([
    { id: 'inv', pattern: 'I-{YYYY}-{####}' },
    { id: 'dn', pattern: 'D-{YYYY}-{####}', counter: 'inv' },
    { id: 'rec', pattern: 'R-{YYYY}-{####}', counter: 'dn' },
  ]);
  assert.equal(chain.success, false);
  assert.match(formatIssues(chain.error), /2\.counter.*counter must name a series that owns its counter/);
  assert.equal(SeriesFileSchema.safeParse([
    { id: 'inv', pattern: 'I-{YYYY}-{####}', counter: 'inv' },
    { id: 'dn', pattern: 'D-{YYYY}-{####}', counter: 'inv' },
  ]).success, true);
  assert.equal(SeriesFileSchema.safeParse([
    { id: 'inv', pattern: 'I-{YYYY}-{####}' },
    { id: 'rec', pattern: 'R-{YY}-{####}', counter: 'inv' },
  ]).success, true);
});

test('SeedsSchema defaults and validates kinds, roles and relation endpoints', () => {
  assert.deepEqual(SeedsSchema.parse({}), { entities: [], relations: [] });
  const ok = SeedsSchema.parse({
    entities: [{ kind: 'client', name: 'Example Client' }, { kind: 'business_line', name: 'Events' }],
    relations: [{ from: { kind: 'client', name: 'Example Client' }, to: { kind: 'business_line', name: 'Events' }, role: 'belongs_to_business_line' }],
  });
  assert.deepEqual(ok.entities[0].aliases, []);
  assert.deepEqual(ok.entities[0].attrs, {});
  const badKind = SeedsSchema.safeParse({ entities: [{ kind: 'planet', name: 'X' }] });
  assert.match(formatIssues(badKind.error), /entities\.0\.kind/);
  const badRef = SeedsSchema.safeParse({
    entities: [{ kind: 'client', name: 'A' }],
    relations: [{ from: { kind: 'client', name: 'A' }, to: { kind: 'client', name: 'Missing' }, role: 'contact_of' }],
  });
  assert.equal(badRef.success, false);
  assert.match(formatIssues(badRef.error), /relations\.0\.to/);
});

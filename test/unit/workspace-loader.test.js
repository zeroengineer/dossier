import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { writeWorkspace, minimalBrand } from '../helpers/workspace.js';
import {
  loadWorkspace, brandAsset, interpolate, initWorkspace, clearanceFor, WorkspaceError, deepMerge,
} from '../../src/workspace/index.js';
import { EXAMPLE_WORKSPACE, PLACEHOLDERS_DIR, FONTS_DIR } from '../../src/paths.js';

function withWs(spec, fn) {
  const { dir, cleanup } = tmpDir();
  try { writeWorkspace(dir, spec); return fn(dir); } finally { cleanup(); }
}

test('loadWorkspace returns config, brands, series, seeds, templatesDir and a configHash', () => {
  withWs({ series: [{ id: 'inv', pattern: 'A-{####}', scope: 'brand' }] }, (dir) => {
    const ws = loadWorkspace(dir);
    assert.equal(ws.home, dir);
    assert.equal(ws.config.name, 'Test Workspace');
    assert.ok(ws.brands instanceof Map);
    assert.equal(ws.brands.get('acme').legalName, 'Acme Events Private Limited');
    assert.ok(ws.series instanceof Map);
    assert.equal(ws.series.get('inv').counter, 'inv');
    assert.deepEqual(ws.seeds, { entities: [], relations: [] });
    assert.equal(ws.templatesDir, join(dir, 'templates'));
    assert.match(ws.configHash, /^[0-9a-f]{64}$/);
  });
});

test('configHash is stable across loads and changes when a brand changes', () => {
  withWs({}, (dir) => {
    const h1 = loadWorkspace(dir).configHash;
    assert.equal(loadWorkspace(dir).configHash, h1);
    writeFileSync(join(dir, 'brands/acme/brand.json'), JSON.stringify(minimalBrand('acme', { shortName: 'ACME' })));
    assert.notEqual(loadWorkspace(dir).configHash, h1);
  });
});

test('missing workspace.json is reported with the file name', () => {
  const { dir, cleanup } = tmpDir();
  try {
    assert.throws(() => loadWorkspace(dir), (e) => e instanceof WorkspaceError && /workspace\.json/.test(e.message));
  } finally { cleanup(); }
});

test('invalid JSON is reported with the file name', () => {
  withWs({ brands: { acme: '{ not json' } }, (dir) => {
    assert.throws(() => loadWorkspace(dir), /brands\/acme\/brand\.json: invalid JSON/);
  });
});

test('schema errors name the file and the field', () => {
  const { legalName, ...noName } = minimalBrand();
  withWs({ brands: { acme: noName } }, (dir) => {
    assert.throws(() => loadWorkspace(dir), (e) => {
      assert.ok(e instanceof WorkspaceError);
      assert.equal(e.file, 'brands/acme/brand.json');
      assert.match(e.message, /brands\/acme\/brand\.json/);
      assert.match(e.message, /legalName/);
      return true;
    });
  });
  withWs({ series: [{ id: 'a', pattern: 'A', scope: 'nowhere' }] }, (dir) => {
    assert.throws(() => loadWorkspace(dir), /series\.json[\s\S]*0\.scope/);
  });
});

test('cross-file references are checked: defaultBrand, brand id, series, signatories', () => {
  withWs({ workspace: { name: 'W', defaultBrand: 'nope' } }, (dir) => {
    assert.throws(() => loadWorkspace(dir), /workspace\.json[\s\S]*defaultBrand/);
  });
  withWs({ brands: { acme: minimalBrand('other') } }, (dir) => {
    assert.throws(() => loadWorkspace(dir), /brands\/acme\/brand\.json[\s\S]*id/);
  });
  withWs({ brands: { acme: minimalBrand('acme', { series: { invoice: 'missing-series' } }) } }, (dir) => {
    assert.throws(() => loadWorkspace(dir), /brands\/acme\/brand\.json[\s\S]*series\.invoice/);
  });
  withWs({ brands: { acme: minimalBrand('acme', { defaultSignatory: { invoice: 'ghost' } }) } }, (dir) => {
    assert.throws(() => loadWorkspace(dir), /defaultSignatory\.invoice/);
  });
});

test('inheritsFrom deep-merges the parent: child wins, arrays replace, objects merge', () => {
  const parent = minimalBrand('acme', {
    registrations: [{ label: 'CIN', value: 'U00000XX2000PTC000000' }, { label: 'GSTIN', value: '00AAAAA0000A0Z0' }],
    palette: { accent: '#123456', ink: '#000000' },
    strings: { thankYou: 'THANK YOU', confidential: 'Confidential' },
    signatories: [{ id: 'md', name: 'Sam Sample', title: 'Managing Director' }],
  });
  const child = {
    id: 'acme-labs', inheritsFrom: 'acme', shortName: 'Acme Labs',
    registrations: [{ label: 'LLPIN', value: 'AAA-0000' }],
    palette: { accent: '#abcdef' },
    strings: { thankYou: 'THANKS' },
  };
  withWs({ brands: { acme: parent, 'acme-labs': child } }, (dir) => {
    const ws = loadWorkspace(dir);
    const b = ws.brands.get('acme-labs');
    assert.equal(b.id, 'acme-labs');
    assert.equal(b.legalName, 'Acme Events Private Limited');
    assert.equal(b.shortName, 'Acme Labs');
    assert.deepEqual(b.registrations, [{ label: 'LLPIN', value: 'AAA-0000' }]);
    assert.equal(b.palette.accent, '#abcdef');
    assert.equal(b.palette.ink, '#000000');
    assert.equal(b.palette.rule, '#e8e8e8');
    assert.deepEqual(b.strings, { thankYou: 'THANKS', confidential: 'Confidential' });
    assert.equal(b.signatories[0].id, 'md');
    assert.equal(ws.brands.get('acme').shortName, 'Acme');
  });
});

test('inheritsFrom rejects unknown parents and cycles', () => {
  withWs({ brands: { acme: minimalBrand('acme', { inheritsFrom: 'ghost' }) } }, (dir) => {
    assert.throws(() => loadWorkspace(dir), /inheritsFrom/);
  });
  withWs({ brands: { a: minimalBrand('a', { inheritsFrom: 'b' }), b: minimalBrand('b', { inheritsFrom: 'a' }) }, workspace: { name: 'W', defaultBrand: 'a' } }, (dir) => {
    assert.throws(() => loadWorkspace(dir), /cycle/);
  });
});

test('deepMerge: plain objects merge recursively, arrays and scalars replace', () => {
  assert.deepEqual(deepMerge({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { c: [3] }, d: 2 }), { a: { b: 1, c: [3] }, d: 2 });
});

test('interpolate replaces {a.b.c} paths and blanks missing ones', () => {
  const scope = { legalName: 'Acme', contact: { email: 'a@example.com', website: 'www.example.com' }, page: 2, n: 0 };
  assert.equal(interpolate('FOR {legalName}', scope), 'FOR Acme');
  assert.equal(interpolate('Email: {contact.email} | {contact.website}', scope), 'Email: a@example.com | www.example.com');
  assert.equal(interpolate('Page {page} of {pages}', scope), 'Page 2 of ');
  assert.equal(interpolate('{n}/{missing.deep.path}', scope), '0/');
  assert.equal(interpolate('ACM-{####} {YYYY-}', scope), 'ACM-{####} {YYYY-}');
  assert.equal(interpolate('{contact}', scope), '');
  assert.equal(interpolate(undefined, scope), '');
});

test('interpolate keeps unresolved all-uppercase tokens (numbering tokens) and blanks other misses', () => {
  const scope = { legalName: 'Acme', CODE: 'EV', nested: { YYYY: '1999' }, ZERO: 0, OBJ: {} };
  assert.equal(interpolate('ACM-{YYYY}-{FY}-{YY}-{MM}-{####}', scope), 'ACM-{YYYY}-{FY}-{YY}-{MM}-{####}');
  assert.equal(interpolate('FSS/{CLIENT}/{YYYY}/{###} for {legalName}', scope), 'FSS/{CLIENT}/{YYYY}/{###} for Acme');
  assert.equal(interpolate('Q-{CODE}', scope), 'Q-EV');
  assert.equal(interpolate('{ZERO}|{OBJ}|{BRAND_2}', scope), '0||{BRAND_2}');
  assert.equal(interpolate('{Yyyy}|{yyyy}|{nested.YYYY}|{nested.MM}|{MISSING.PATH}', scope), '||1999||');
});

test('brandAsset falls back to placeholders and built-in fonts when brand files are missing', () => {
  const brand = minimalBrand('acme', {
    assets: { logo: 'assets/logo.png', seal: 'assets/seal.png' },
    signatories: [{ id: 'md', name: 'Sam Sample', title: 'Managing Director', signature: 'assets/sign-md.png' }],
    fonts: { bold: 'assets/fonts/Custom-Bold.ttf' },
  });
  withWs({ brands: { acme: brand } }, (dir) => {
    const ws = loadWorkspace(dir);
    assert.equal(brandAsset(ws, 'acme', 'assets.logo'), join(PLACEHOLDERS_DIR, 'logo.png'));
    assert.equal(brandAsset(ws, 'acme', 'assets.seal'), join(PLACEHOLDERS_DIR, 'seal.png'));
    assert.equal(brandAsset(ws, 'acme', 'signature:md'), join(PLACEHOLDERS_DIR, 'signature.png'));
    assert.equal(brandAsset(ws, 'acme', 'signature-large:md'), join(PLACEHOLDERS_DIR, 'signature-large.png'));
    assert.equal(brandAsset(ws, 'acme', 'font:regular'), join(FONTS_DIR, 'Manrope', 'Manrope-Regular.ttf'));
    assert.equal(brandAsset(ws, 'acme', 'font:bold'), join(FONTS_DIR, 'Manrope', 'Manrope-Bold.ttf'));
    assert.equal(brandAsset(ws, 'acme', 'assets.watermark'), null);
    assert.throws(() => brandAsset(ws, 'acme', 'signature:ghost'), /signatory "ghost"/);
    assert.throws(() => brandAsset(ws, 'nope', 'assets.logo'), /unknown brand "nope"/);
    assert.throws(() => brandAsset(ws, 'acme', 'whatever'), /unknown asset key/);
  });
});

test('brandAsset returns brand files when present, and parent files for inheriting brands', () => {
  const parent = minimalBrand('acme', { signatories: [{ id: 'md', name: 'Sam Sample', title: 'MD', signature: 'assets/sign-md.png' }], fonts: { bold: 'assets/Custom-Bold.ttf' } });
  const child = { id: 'kid', inheritsFrom: 'acme', shortName: 'Kid' };
  withWs({
    brands: { acme: parent, kid: child },
    files: { 'brands/acme/assets/logo.png': 'x', 'brands/acme/assets/sign-md.png': 'x', 'brands/kid/assets/logo.png': 'y', 'brands/acme/assets/Custom-Bold.ttf': 'f' },
  }, (dir) => {
    const ws = loadWorkspace(dir);
    assert.equal(brandAsset(ws, 'acme', 'assets.logo'), join(dir, 'brands/acme/assets/logo.png'));
    assert.equal(brandAsset(ws, 'kid', 'assets.logo'), join(dir, 'brands/kid/assets/logo.png'));
    assert.equal(brandAsset(ws, 'kid', 'signature:md'), join(dir, 'brands/acme/assets/sign-md.png'));
    assert.equal(brandAsset(ws, 'kid', 'font:bold'), join(dir, 'brands/acme/assets/Custom-Bold.ttf'));
  });
});

test('unknown builtin font is a validation error naming the field', () => {
  withWs({ brands: { acme: minimalBrand('acme', { fonts: { bold: 'builtin:Comic-Bold' } }) } }, (dir) => {
    assert.throws(() => loadWorkspace(dir), /brands\/acme\/brand\.json[\s\S]*fonts\.bold/);
  });
});

test('clearanceFor uses workspace users and defaults unknown users to Confidential', () => {
  withWs({ workspace: { name: 'W', defaultBrand: 'acme', users: { boss: { clearance: 'Restricted' } } } }, (dir) => {
    const ws = loadWorkspace(dir);
    assert.equal(clearanceFor(ws, 'boss'), 'Restricted');
    assert.equal(clearanceFor(ws, 'stranger'), 'Confidential');
  });
});

test('the shipped example workspace validates and is fully wired', () => {
  const ws = loadWorkspace(EXAMPLE_WORKSPACE);
  assert.equal(ws.config.name, 'Example Workspace');
  assert.equal(ws.config.defaultBrand, 'acme');
  assert.equal(clearanceFor(ws, 'demo'), 'Confidential');
  const b = ws.brands.get('acme');
  assert.equal(b.legalName, 'Acme Events Private Limited');
  assert.deepEqual(Object.keys(b.contacts).sort(), ['billing', 'default', 'hr']);
  assert.deepEqual(b.signatories.map((s) => [s.id, s.name, s.title]), [
    ['ops', 'Alex Example', 'Chief Operating Officer'], ['md', 'Sam Sample', 'Managing Director'],
  ]);
  assert.equal(b.letterhead.lines[0], 'CIN: U00000XX2000PTC000000');
  assert.equal(b.letterhead.lines[3], 'Email: {contact.email} | {contact.website}');
  assert.deepEqual(b.footer, { left: '{contact.email} | {contact.website}', center: '{strings.confidential}', right: 'Page {page} of {pages}' });
  assert.equal(interpolate(b.strings.forCompany, b), 'FOR Acme Events Private Limited');
  assert.deepEqual(b.tax.modes.map((m) => m.id), ['none', 'cgst_sgst', 'igst']);
  assert.deepEqual(b.tax.modes[1].rates, [{ label: 'CGST (9%)', rate: 0.09 }, { label: 'SGST (9%)', rate: 0.09 }]);
  assert.deepEqual(b.tax.modes[2].rates, [{ label: 'IGST @ 18%', rate: 0.18 }]);
  assert.equal(b.tax.defaultHsn, '998596');
  const templateIds = ['invoice', 'debit-note', 'receipt', 'internship-certificate',
    'experience-certificate', 'relieving-letter', 'client-final-settlement', 'mou', 'board-resolution', 'proposal', 'pricing-report'];
  for (const t of templateIds) assert.ok(ws.series.has(b.series[t]), `series for ${t}`);
  // Statements other than the client final settlement are unnumbered unless a brand maps a series.
  for (const t of ['employee-final-settlement', 'ticketing-settlement-statement', 'remittance-statement', 'expense-statement']) {
    assert.equal(b.series[t], undefined, t);
  }
  assert.equal(b.series['client-final-settlement'], 'settlement');
  // Offer letters are unnumbered unless a brand maps a series; certificates and the relieving letter share hr-cert.
  assert.equal(b.series['offer-letter'], undefined);
  assert.equal(b.series['internship-offer'], undefined);
  for (const t of ['internship-certificate', 'experience-certificate', 'relieving-letter']) assert.equal(b.series[t], 'hr-cert', t);
  assert.equal(ws.series.get('invoice-main').pattern, 'ACM-{YYYY}-{####}');
  assert.equal(ws.series.get('invoice-main').scope, 'brand+year');
  assert.equal(ws.series.get('debit-note').counter, 'invoice-main');
  assert.equal(ws.series.get('receipt').counter, 'invoice-main');
  assert.equal(ws.series.get('settlement').scope, 'brand+year+client');
  assert.equal(ws.series.get('hr-cert').pattern, 'ACM/HR/{YYYY}/EXP-{###}');
  const kinds = (k) => ws.seeds.entities.filter((e) => e.kind === k).length;
  assert.equal(kinds('business_line'), 2);
  assert.equal(kinds('client'), 3);
  assert.equal(kinds('person'), 2);
  assert.equal(kinds('vendor'), 1);
  assert.equal(kinds('product'), 1);
  const engagementsPerClient = {};
  for (const r of ws.seeds.relations.filter((r) => r.role === 'engagement_of')) engagementsPerClient[r.to.name] = (engagementsPerClient[r.to.name] ?? 0) + 1;
  assert.ok(Object.values(engagementsPerClient).includes(2));
  // every asset resolves to an existing file (placeholders, since the example ships none)
  for (const key of ['assets.logo', 'assets.seal', 'signature:ops', 'signature:md', 'font:regular', 'font:extrabold']) {
    assert.ok(existsSync(brandAsset(ws, 'acme', key)), key);
  }
});

test('initWorkspace copies the example tree and refuses a non-empty target', () => {
  const { dir, cleanup } = tmpDir();
  try {
    const target = join(dir, 'new-ws');
    const out = initWorkspace(target);
    assert.equal(out, target);
    assert.ok(existsSync(join(target, 'workspace.json')));
    assert.ok(existsSync(join(target, 'brands/acme/brand.json')));
    assert.ok(existsSync(join(target, 'brands/acme/assets')));
    assert.ok(existsSync(join(target, 'series.json')));
    assert.ok(existsSync(join(target, 'seeds/entities.json')));
    assert.equal(loadWorkspace(target).config.name, 'Example Workspace');
    assert.throws(() => initWorkspace(target), /not empty/);
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    initWorkspace(empty);
    assert.ok(readdirSync(empty).includes('workspace.json'));
  } finally { cleanup(); }
});

test('initWorkspace copies from a custom source', () => {
  const { dir, cleanup } = tmpDir();
  try {
    mkdirSync(join(dir, 'src-ws'));
    const src = writeWorkspace(join(dir, 'src-ws'), {});
    const target = join(dir, 'copy');
    initWorkspace(target, { from: src });
    assert.equal(loadWorkspace(target).config.name, 'Test Workspace');
  } finally { cleanup(); }
});

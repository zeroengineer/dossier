import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';
import { tmpDir } from '../helpers/tmp.js';
import { fakeSpaDir } from '../helpers/spa.js';
import { extractItems } from '../helpers/pdfText.js';
import { initWorkspace } from '../../src/workspace/index.js';
import { openContext } from '../../src/context.js';
import { buildServer } from '../../src/server.js';
import { FONTS_DIR } from '../../src/paths.js';
import { FONT_WEIGHTS } from '../../src/workspace/schemas.js';
import { BUILTIN_TEMPLATES_DIR } from '../../src/services/templates.js';

// Settings are edited through the JSON API (the web app's settings pages): brands, series.json and workspace.json.

const ORIGIN = 'http://localhost:80';
let tmp; let home; let ctx; let app;

const brandFile = (id = 'acme') => join(home, 'brands', id, 'brand.json');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const brandJson = (id) => readJson(brandFile(id));

const api = (method, url, body, headers) => app.inject({ method, url, ...(body !== undefined ? { payload: body } : {}), ...(headers ? { headers } : {}) });

/** A multipart body with one file and text fields. */
function multipart(fields, file) {
  const boundary = '----dossiersettings';
  const parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.mime}\r\n\r\n`));
    parts.push(file.buffer, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
const upload = (url, fields, file, headers = { origin: ORIGIN }) => {
  const m = multipart(fields, file);
  return app.inject({ method: 'POST', url, payload: m.payload, headers: { ...m.headers, ...headers } });
};

const png = (width, height) => sharp({ create: { width, height, channels: 4, background: { r: 20, g: 40, b: 200, alpha: 1 } } }).png().toBuffer();
const configHash = (id = 'acme') => ctx.db.prepare('SELECT config_hash FROM brands WHERE id = ?').get(id).config_hash;
const pdfText = async (buf) => (await extractItems(buf)).map((i) => i.text).join(' ');

/** PUT the brand file with `patch` applied over what is on disk; expect 200 and return the file as written. */
async function saveBrand(patch, id = 'acme') {
  const r = await api('PUT', `/api/brands/${id}`, { ...brandJson(id), ...patch });
  assert.equal(r.statusCode, 200, `${Object.keys(patch)}: ${r.body.slice(0, 600)}`);
  assert.deepEqual(r.json().file, brandJson(id));
  return brandJson(id);
}

/** PUT a patch that must fail with WORKSPACE_INVALID naming `path` (message matching `re`); brand.json stays byte-identical. */
async function rejectBrand(patch, path, re, id = 'acme') {
  const before = readFileSync(brandFile(id));
  const r = await api('PUT', `/api/brands/${id}`, { ...brandJson(id), ...patch });
  assert.equal(r.statusCode, 400, `${path}: ${r.body.slice(0, 300)}`);
  assert.equal(r.json().code, 'WORKSPACE_INVALID', path);
  const e = r.json().details.errors.find((x) => x.path === path);
  assert.ok(e, `${path} in ${r.body}`);
  if (re) assert.match(e.message, re, path);
  assert.deepEqual(readFileSync(brandFile(id)), before, 'brand.json untouched');
  return r;
}

before(() => {
  tmp = tmpDir();
  home = join(tmp.dir, 'ws');
  initWorkspace(home);
  ctx = openContext({ home, user: 'demo', env: {} });
  app = buildServer(ctx, { spaDir: fakeSpaDir(tmp.dir) });
});

after(async () => {
  await app?.close();
  ctx?.close();
  tmp?.cleanup();
});

describe('brand files', () => {
  test('list, download brand.json and the preview PDF (no-store)', async () => {
    const list = await api('GET', '/api/brands');
    assert.equal(list.statusCode, 200);
    assert.ok(list.json().brands.some((b) => b.id === 'acme' && b.legalName === 'Acme Events Private Limited'));
    assert.equal((await api('GET', '/api/brands/nope')).statusCode, 404);
    const dl = await api('GET', '/api/brands/acme/file');
    assert.equal(dl.statusCode, 200);
    assert.match(dl.headers['content-disposition'], /^attachment; filename="acme.json"/);
    assert.deepEqual(JSON.parse(dl.body), brandJson('acme'));
    const pv = await api('GET', '/api/brands/acme/preview.pdf');
    assert.equal(pv.statusCode, 200);
    assert.equal(pv.headers['content-type'], 'application/pdf');
    assert.match(pv.headers['cache-control'], /no-store/);
    const text = await pdfText(pv.rawPayload);
    assert.match(text, /Acme Events Private Limited/);
    assert.match(text, /Page 1 of 1/);
    assert.match(text, /Sam Sample/);
  });
});

describe('brand round-trip through PUT /api/brands/:id', () => {
  test('identity, registrations, contacts and bank accounts', async () => {
    let b = await saveBrand({
      legalName: 'Acme Events Two Private Limited', shortName: 'Acme Two',
      addresses: { business: ['Unit 1, Example Park', 'Example City 000000'] }, projectContact: 'md',
    });
    assert.equal(b.legalName, 'Acme Events Two Private Limited');
    assert.deepEqual(b.addresses, { business: ['Unit 1, Example Park', 'Example City 000000'] });
    assert.equal(b.projectContact, 'md');
    assert.equal(ctx.ws.brands.get('acme').legalName, 'Acme Events Two Private Limited', 'ctx.ws reloaded');

    b = await saveBrand({ registrations: [{ label: 'CIN', value: 'U00000XX2000PTC000000' }, { label: 'GSTIN', value: '00AAAAA0000A0Z0' }] });
    assert.deepEqual(b.registrations, [{ label: 'CIN', value: 'U00000XX2000PTC000000' }, { label: 'GSTIN', value: '00AAAAA0000A0Z0' }]);

    b = await saveBrand({
      contacts: {
        default: { email: 'hello@example.com', phone: '+00 00000 00000', website: 'www.example.com' },
        billing: { email: 'billing@example.com' },
      },
    });
    assert.equal(b.contacts.billing.email, 'billing@example.com');

    b = await saveBrand({ bankAccounts: [{ accountName: 'Acme Events Two Private Limited', bankName: 'Example Bank', accountNumber: '000000000001', ifsc: 'EXMP0000001' }] });
    assert.equal(b.bankAccounts[0].accountNumber, '000000000001');
    assert.equal((await api('GET', '/api/brands/acme')).json().resolved.bankAccounts[0].ifsc, 'EXMP0000001');
  });

  test('letterhead, palette, fonts and image paths', async () => {
    let b = await saveBrand({
      letterhead: { lines: ['CIN: {registrations.0.value}', 'Email: {contact.email}'] },
      footer: { left: '{contact.website}', right: 'Page {page} of {pages}' },
    });
    assert.deepEqual(b.letterhead, { lines: ['CIN: {registrations.0.value}', 'Email: {contact.email}'] });

    b = await saveBrand({ palette: { accent: '#aa3300', section: '#203040' } });
    assert.deepEqual(b.palette, { accent: '#aa3300', section: '#203040' });
    assert.equal(ctx.ws.brands.get('acme').palette.ink, '#1a1a1a', 'a colour left out keeps the default');

    const { bold, ...fonts } = brandJson('acme').fonts ?? {};
    b = await saveBrand({ fonts: { ...fonts, regular: 'builtin:Manrope-Medium' } });
    assert.equal(b.fonts.regular, 'builtin:Manrope-Medium');
    assert.equal(ctx.ws.brands.get('acme').fonts.bold, bold ?? 'builtin:Manrope-Bold');

    const assets = brandJson('acme').assets ?? {};
    await rejectBrand({ assets: { ...assets, watermark: 'assets/wm.png' } }, 'assets.watermark', /no file "assets\/wm.png"/);
    writeFileSync(join(home, 'brands', 'acme', 'assets', 'wm.png'), await png(4, 4));
    b = await saveBrand({ assets: { ...assets, watermark: 'assets/wm.png' } });
    assert.equal(b.assets.watermark, 'assets/wm.png');
  });

  test('signatories, strings, tax modes and the series map', async () => {
    let b = await saveBrand({
      signatories: [
        { id: 'md', name: 'Sam Sample', title: 'Director', signature: brandJson('acme').signatories.find((s) => s.id === 'md').signature },
        { id: 'ops', name: 'Alex Example', title: 'Operations', email: 'alex@example.com' },
      ],
      defaultSignatory: { invoice: 'ops', letter: 'md' },
    });
    assert.deepEqual(b.defaultSignatory, { invoice: 'ops', letter: 'md' });

    b = await saveBrand({ strings: { confidential: 'Private and confidential', forCompany: 'FOR {legalName}' } });
    assert.deepEqual(b.strings, { confidential: 'Private and confidential', forCompany: 'FOR {legalName}' });

    const tax = {
      modes: [{ id: 'none', label: 'No tax', rates: [] }, { id: 'gst', label: 'GST', rates: [{ label: 'CGST (9%)', rate: 0.09 }, { label: 'SGST (9%)', rate: 0.09 }] }],
      defaultMode: 'gst', defaultHsn: '000000',
    };
    b = await saveBrand({ tax });
    assert.deepEqual(b.tax, tax);

    b = await saveBrand({ series: { invoice: 'generic', receipt: 'receipt' } });
    assert.deepEqual(b.series, { invoice: 'generic', receipt: 'receipt' });
    assert.equal(ctx.ws.brands.get('acme').series.invoice, 'generic');
  });

  test('a save changes the config hash, is audited and reaches the preview without a restart', async () => {
    const hash = configHash();
    const legalBefore = brandJson('acme').legalName;
    await saveBrand({ legalName: 'Acme Preview Check Private Limited' });
    assert.notEqual(configHash(), hash);
    assert.equal(configHash(), ctx.ws.brandHashes.get('acme'));
    const row = ctx.db.prepare("SELECT * FROM audit_log WHERE action = 'workspace.write' AND target_id = 'brands/acme/brand.json' ORDER BY id DESC LIMIT 1").get();
    assert.equal(row.target_kind, 'workspace');
    assert.equal(JSON.parse(row.before).legalName, legalBefore);
    assert.equal(JSON.parse(row.after).legalName, 'Acme Preview Check Private Limited');
    const pv = await api('GET', '/api/brands/acme/preview.pdf');
    assert.match(await pdfText(pv.rawPayload), /Acme Preview Check Private Limited/);
  });
});

describe('invalid brand input', () => {
  test('field errors name the path and brand.json is untouched', async () => {
    const b = brandJson('acme');
    await rejectBrand({ legalName: '' }, 'legalName');
    await rejectBrand({ addresses: { business: [] } }, 'addresses.business');
    await rejectBrand({ palette: { accent: 'red' } }, 'palette.accent', /hex/);
    await rejectBrand({ fonts: { bold: 'builtin:Nope-Bold' } }, 'fonts.bold', /unknown built-in font/);
    await rejectBrand({ assets: { ...b.assets, logo: '../../outside.png' } }, 'assets.logo', /must be a relative path inside the brand folder/);
    await rejectBrand({ assets: { ...b.assets, logo: '/etc/hosts' } }, 'assets.logo', /must be a relative path/);
    await rejectBrand({ assets: { ...b.assets, logo: 'assets/nothing-here.png' } }, 'assets.logo', /no file "assets\/nothing-here.png"/);
    await rejectBrand({ tax: { modes: [{ id: 'none', label: 'No tax', rates: [] }], defaultMode: 'gst' } }, 'tax.defaultMode', /"gst" is not one of tax.modes/);
    await rejectBrand({ series: { invoice: 'no-such-series' } }, 'series.invoice', /unknown series "no-such-series"/);
  });

  test('brand ids such as .. and %2F are not found or refused, and nothing is written', async () => {
    const before = readdirSync(home).sort();
    const brandsBefore = readdirSync(join(home, 'brands')).sort();
    for (const url of ['/api/brands/%2E%2E', '/api/brands/%2F', '/api/brands/%2E%2E/preview.pdf', '/api/brands/..%2F..%2Fworkspace/file']) {
      const r = await api('GET', url);
      assert.equal(r.statusCode, 404, `${url}: ${r.statusCode}`);
    }
    for (const url of ['/api/brands/%2E%2E', '/api/brands/%2F', '/api/brands/..%2F..%2Fx', '/api/brands/a%2Fb']) {
      const r = await api('PUT', url, { legalName: 'X', shortName: 'X', addresses: { business: ['L'] }, contacts: { default: {} } });
      // %2E%2E is normalised to ".." by URL parsing and leaves no route (404); other ids are refused (400).
      assert.ok([400, 404].includes(r.statusCode), `${url}: ${r.body}`);
      assert.ok(['INVALID_INPUT', 'NOT_FOUND'].includes(r.json().code), url);
    }
    const up = await upload('/api/brands/%2E%2E/assets/logo', {}, { filename: 'a.png', mime: 'image/png', buffer: await png(4, 4) });
    assert.equal(up.statusCode, 404);
    const created = await api('POST', '/api/brands', { id: '..', legalName: 'X', shortName: 'X', addresses: { business: ['L'] }, contacts: { default: {} } });
    assert.equal(created.statusCode, 400);
    assert.deepEqual(readdirSync(home).sort(), before);
    assert.deepEqual(readdirSync(join(home, 'brands')).sort(), brandsBefore);
    assert.equal(existsSync(join(tmp.dir, 'brand.json')), false);
  });
});

describe('brand assets', () => {
  test('a PNG logo is stored in the brand folder and used by the preview', async () => {
    const buffer = await png(300, 40);
    const r = await upload('/api/brands/acme/assets/logo', {}, { filename: '../../evil name.png', mime: 'image/png', buffer });
    assert.equal(r.statusCode, 200, r.body.slice(0, 300));
    const logo = brandJson('acme').assets.logo;
    assert.equal(r.json().path, logo);
    assert.match(logo, /^assets\/logo-[0-9a-f]{12}\.png$/, 'generated name, nothing from the client');
    assert.deepEqual(readFileSync(join(home, 'brands', 'acme', logo)), buffer);
    assert.deepEqual(r.json().brand.file, brandJson('acme'));
    const pv = await api('GET', '/api/brands/acme/preview.pdf');
    // The letterhead resizes the logo to height 80: 300x40 becomes 600x80 (the placeholder would be 351 wide).
    assert.match(pv.rawPayload.toString('latin1'), /\/Width 600\s/);
    const served = await app.inject({ url: '/assets/brands/acme/logo' });
    assert.deepEqual(served.rawPayload, buffer);
    const rows = ctx.db.prepare("SELECT id, target_id FROM audit_log WHERE action = 'workspace.write' ORDER BY id DESC LIMIT 2").all();
    assert.deepEqual(rows.map((x) => x.target_id).sort(), [`brands/acme/${logo}`, 'brands/acme/brand.json'].sort(), 'asset and brand.json audited together');
  });

  test('signatures, JPEG and fonts', async () => {
    const jpeg = await sharp({ create: { width: 120, height: 48, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    const sig = await upload('/api/brands/acme/assets/signature:ops', {}, { filename: 's.jpg', mime: 'image/jpeg', buffer: jpeg }, { 'x-dossier-client': 'test' });
    assert.equal(sig.statusCode, 200, sig.body);
    assert.match(sig.json().path, /^assets\/sign-ops-[0-9a-f]{12}\.jpg$/);
    assert.equal(brandJson('acme').signatories.find((s) => s.id === 'ops').signature, sig.json().path);

    const ttf = readFileSync(join(FONTS_DIR, 'Manrope', 'Manrope-SemiBold.ttf'));
    const font = await upload('/api/brands/acme/assets/font:bold', {}, { filename: 'x.ttf', mime: 'font/ttf', buffer: ttf });
    assert.equal(font.statusCode, 200, font.body);
    assert.match(brandJson('acme').fonts.bold, /^assets\/fonts\/bold-[0-9a-f]{12}\.ttf$/);
    const pv = await api('GET', '/api/brands/acme/preview.pdf');
    assert.equal(pv.statusCode, 200);
  });

  test('non-images, broken images, junk fonts, unknown keys and missing files are rejected; brand.json untouched', async () => {
    const before = readFileSync(brandFile());
    const cases = [
      ['logo', { filename: 'logo.png', mime: 'image/png', buffer: Buffer.from('this is not an image at all') }, /PNG or JPEG/],
      ['logo', { filename: 'logo.png', mime: 'image/png', buffer: Buffer.concat([(await png(10, 10)).subarray(0, 40)]) }, /could not be decoded/],
      ['font:bold', { filename: 'f.ttf', mime: 'font/ttf', buffer: Buffer.from('not a font file') }, /TrueType/],
      ['font:bold', { filename: 'f.ttf', mime: 'font/ttf', buffer: Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(64)]) }, /could not be read/],
      ['signature:nobody', { filename: 's.png', mime: 'image/png', buffer: await png(10, 10) }, /no signatory "nobody"/],
      ['nope', { filename: 's.png', mime: 'image/png', buffer: await png(10, 10) }, /Unknown asset key/],
    ];
    for (const [key, file, re] of cases) {
      const r = await upload(`/api/brands/acme/assets/${encodeURIComponent(key)}`, {}, file);
      assert.equal(r.statusCode, 400, `${key}: ${r.body.slice(0, 200)}`);
      assert.match(r.json().message, re, key);
    }
    assert.equal((await upload('/api/brands/acme/assets/logo', {}, cases[0][1])).json().code, 'ASSET_INVALID');
    const none = await upload('/api/brands/acme/assets/logo', { note: 'no file part' }, null);
    assert.equal(none.statusCode, 400);
    assert.equal(none.json().code, 'INVALID_INPUT');
    const huge = Buffer.concat([(await png(4, 4)), Buffer.alloc(10 * 1024 * 1024)]);
    const big = await upload('/api/brands/acme/assets/logo', {}, { filename: 'big.png', mime: 'image/png', buffer: huge });
    assert.equal(big.statusCode, 413, big.body.slice(0, 200));
    assert.equal(big.json().code, 'ASSET_TOO_LARGE');
    assert.deepEqual(readFileSync(brandFile()), before);
  });
});

describe('inherited brands', () => {
  test('a child brand stores only its own fields and inherits the rest', async () => {
    const created = await api('POST', '/api/brands', { id: 'acme-llp', inheritsFrom: 'acme', legalName: 'Acme Events LLP' });
    assert.equal(created.statusCode, 201, created.body.slice(0, 400));
    assert.deepEqual(brandJson('acme-llp'), { id: 'acme-llp', inheritsFrom: 'acme', legalName: 'Acme Events LLP' });
    assert.ok(ctx.ws.brands.has('acme-llp'));
    assert.ok(ctx.db.prepare('SELECT 1 FROM brands WHERE id = ?').get('acme-llp'), 'brand row synced');
    const got = (await api('GET', '/api/brands/acme-llp')).json();
    assert.equal(got.resolved.shortName, ctx.ws.brands.get('acme').shortName, 'inherited value resolved');
    assert.equal(got.file.shortName, undefined);

    let b = await saveBrand({ registrations: [{ label: 'LLPIN', value: 'AAA-0000' }] }, 'acme-llp');
    assert.deepEqual(b.registrations, [{ label: 'LLPIN', value: 'AAA-0000' }]);
    b = await saveBrand({ palette: { accent: '#00aa00' } }, 'acme-llp');
    assert.deepEqual(b.palette, { accent: '#00aa00' });
    assert.equal(ctx.ws.brands.get('acme-llp').palette.section, '#203040', 'inherited from acme');

    const up = await upload('/api/brands/acme-llp/assets/signature:md', {}, { filename: 's.png', mime: 'image/png', buffer: await png(50, 50) });
    assert.equal(up.statusCode, 200, up.body.slice(0, 300));
    b = brandJson('acme-llp');
    assert.equal(b.signatories.length, ctx.ws.brands.get('acme').signatories.length, 'inherited list copied before setting the path');
    assert.ok(existsSync(join(home, 'brands', 'acme-llp', b.signatories.find((s) => s.id === 'md').signature)));
  });
});

describe('brand API', () => {
  test('GET and PUT /api/brands/:id', async () => {
    const got = await api('GET', '/api/brands/acme');
    assert.equal(got.statusCode, 200);
    assert.deepEqual(got.json().file, brandJson('acme'));
    assert.equal(got.json().resolved.palette.ink, '#1a1a1a');
    const body = { ...got.json().file, shortName: 'Acme API' };
    const put = await api('PUT', '/api/brands/acme', body);
    assert.equal(put.statusCode, 200);
    assert.equal(put.json().resolved.shortName, 'Acme API');
    assert.notEqual(put.json().configHash, got.json().configHash);

    const created = await api('PUT', '/api/brands/gamma', { legalName: 'Gamma Example', shortName: 'Gamma', addresses: { business: ['L'] }, contacts: { default: {} } });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(brandJson('gamma').id, 'gamma');

    const before = readFileSync(brandFile());
    const bad = await api('PUT', '/api/brands/acme', { ...body, contacts: {}, defaultSignatory: { invoice: 'ghost' } });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().code, 'WORKSPACE_INVALID');
    const paths = bad.json().details.errors.map((e) => e.path).sort();
    assert.deepEqual(paths, ['contacts', 'defaultSignatory.invoice']);
    const mismatch = await api('PUT', '/api/brands/acme', { ...body, id: 'other' });
    assert.equal(mismatch.statusCode, 400);
    const escape = await api('PUT', '/api/brands/acme', { ...body, fonts: { bold: '../../../x.ttf' } });
    assert.equal(escape.statusCode, 400);
    assert.deepEqual(readFileSync(brandFile()), before);
  });

  test('POST /api/brands creates a brand and never overwrites one', async () => {
    const body = { id: 'epsilon', legalName: 'Epsilon Example', shortName: 'Epsilon', addresses: { business: ['L'] }, contacts: { default: {} } };
    const created = await api('POST', '/api/brands', body);
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().id, 'epsilon');
    assert.deepEqual(brandJson('epsilon'), body);

    const before = readFileSync(brandFile());
    const dup = await api('POST', '/api/brands', { ...body, id: 'acme', legalName: 'Overwritten' });
    assert.equal(dup.statusCode, 409);
    assert.equal(dup.json().code, 'BRAND_DUPLICATE');
    assert.deepEqual(readFileSync(brandFile()), before);

    const noId = await api('POST', '/api/brands', { legalName: 'No id' });
    assert.equal(noId.statusCode, 400);
    assert.equal(noId.json().code, 'INVALID_INPUT');
    const invalid = await api('POST', '/api/brands', { id: 'zeta', shortName: 'Zeta' });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().code, 'WORKSPACE_INVALID');
    assert.equal(existsSync(join(home, 'brands', 'zeta')), false);
  });
});

describe('series', () => {
  test('round-trip through PUT /api/series', async () => {
    const list = (await api('GET', '/api/series')).json().series;
    assert.deepEqual(list, readJson(join(home, 'series.json')));
    const edited = list.map((s) => (s.id === 'report' ? { ...s, pattern: 'ACM-RPT-{YYYY}-{####}', start: 100 } : s));
    const r = await api('PUT', '/api/series', { series: edited });
    assert.equal(r.statusCode, 200, r.body.slice(0, 500));
    const saved = readJson(join(home, 'series.json'));
    assert.deepEqual(saved.find((s) => s.id === 'report'), { id: 'report', pattern: 'ACM-RPT-{YYYY}-{####}', scope: 'brand+year', start: 100 });
    assert.deepEqual(saved.find((s) => s.id === 'receipt'), { id: 'receipt', pattern: 'ACM-REC-{YYYY}-{####}', scope: 'brand+year', counter: 'invoice-main' });
    assert.equal(ctx.ws.series.get('report').start, 100);
    assert.deepEqual(r.json().series, saved);
  });

  test('a chained counter, a bad pattern, a bad start and a series still in use are rejected; series.json untouched', async () => {
    const file = join(home, 'series.json');
    const before = readFileSync(file);
    const list = readJson(file);
    const chained = list.map((s) => (s.id === 'receipt' ? { ...s, counter: 'debit-note' } : s));
    const r1 = await api('PUT', '/api/series', chained);
    assert.equal(r1.statusCode, 400);
    assert.match(r1.json().details.errors[0].message, /counter must name a series that owns its counter/);

    const r2 = await api('PUT', '/api/series', [...list, { id: 'only', pattern: 'X-{PREFIX}-{##}' }]);
    assert.equal(r2.statusCode, 400);
    assert.match(JSON.stringify(r2.json().details.errors), /PREFIX/);

    const r3 = await api('PUT', '/api/series', list.filter((s) => s.id !== 'generic'));
    assert.equal(r3.statusCode, 400);
    assert.equal(r3.json().details.errors[0].file, 'brands/acme/brand.json');

    const r4 = await api('PUT', '/api/series', [...list, { id: 'a', pattern: 'A-{##}', start: 'one' }]);
    assert.equal(r4.statusCode, 400);
    assert.equal(r4.json().code, 'WORKSPACE_INVALID');
    assert.deepEqual(readFileSync(file), before);
  });

  test('removing a series a workspace template numbers with is refused', async () => {
    const meta = readJson(join(BUILTIN_TEMPLATES_DIR, 'mou', 'template.json'));
    const dir = join(home, 'templates', 'memo-fixed');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'template.json'), JSON.stringify({ ...meta, id: 'memo-fixed', numbering: { series: 'report', required: true } }));
    writeFileSync(join(dir, 'body.md'), '# Memo\n\nText.\n');
    const list = readJson(join(home, 'series.json'));
    const r = await api('PUT', '/api/series', list.filter((s) => s.id !== 'report'));
    assert.equal(r.statusCode, 400, r.body);
    assert.match(r.json().details.errors[0].message, /template "memo-fixed" would no longer load/);
    rmSync(dir, { recursive: true });
  });

  test('a new series is stored as written', async () => {
    const list = (await api('GET', '/api/series')).json().series;
    const put = await api('PUT', '/api/series', { series: [...list, { id: 'extra', pattern: 'ACM-X-{FY}-{###}', scope: 'brand+year' }] });
    assert.equal(put.statusCode, 200, put.body);
    assert.ok(ctx.ws.series.has('extra'));
    assert.equal(put.json().series.at(-1).counter, undefined, 'stored as written, not with the defaulted counter');
  });
});

describe('workspace settings', () => {
  test('round-trip through PUT /api/workspace keeps the hierarchy', async () => {
    const w = (await api('GET', '/api/workspace')).json().workspace;
    assert.deepEqual(w, readJson(join(home, 'workspace.json')));
    const r = await api('PUT', '/api/workspace', {
      workspace: {
        ...w, name: 'Renamed Workspace', locale: { currencySymbol: '$', currencyCode: 'USD' },
        users: { demo: { clearance: 'Confidential' }, intern: { clearance: 'Internal' } },
      },
    });
    assert.equal(r.statusCode, 200, r.body.slice(0, 500));
    const saved = readJson(join(home, 'workspace.json'));
    assert.equal(saved.name, 'Renamed Workspace');
    assert.deepEqual(saved.locale, { currencySymbol: '$', currencyCode: 'USD' });
    assert.deepEqual(saved.users, { demo: { clearance: 'Confidential' }, intern: { clearance: 'Internal' } });
    assert.deepEqual(saved.hierarchy, w.hierarchy);
    assert.equal(ctx.ws.config.locale.numberLocale, 'en-IN', 'a locale key left out takes the default');
    assert.equal((await api('GET', '/api/me')).json().workspace.name, 'Renamed Workspace');
  });

  test('invalid values and clearances above your own are refused', async () => {
    const file = join(home, 'workspace.json');
    const before = readFileSync(file);
    const w = (await api('GET', '/api/workspace')).json().workspace;
    const r1 = await api('PUT', '/api/workspace', { ...w, locale: { currencyCode: 'dollars' } });
    assert.equal(r1.statusCode, 400);
    assert.ok(r1.json().details.errors.some((e) => e.path === 'locale.currencyCode' && /3-letter ISO code/.test(e.message)), r1.body);
    const r2 = await api('PUT', '/api/workspace', { ...w, users: { ...w.users, demo: { clearance: 'Restricted' } } });
    assert.equal(r2.statusCode, 400);
    assert.match(JSON.stringify(r2.json().details.errors), /above your own clearance/);
    const r3 = await api('PUT', '/api/workspace', { name: 'W', defaultBrand: 'missing' });
    assert.equal(r3.statusCode, 400);
    assert.equal(r3.json().details.errors[0].path, 'defaultBrand');
    assert.deepEqual(readFileSync(file), before);
  });

  test('lowering your own clearance applies at once', async () => {
    const w = (await api('GET', '/api/workspace')).json().workspace;
    const r = await api('PUT', '/api/workspace', { ...w, users: { ...w.users, demo: { clearance: 'Internal' }, senior: { clearance: 'Confidential' } } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(ctx.user.clearance, 'Internal');
  });

  test('the clearance rule uses effective clearances: blank, removed and new users default to Confidential', async () => {
    const file = join(home, 'workspace.json');
    const before = readFileSync(file);
    const w = (await api('GET', '/api/workspace')).json().workspace;
    const { demo, ...others } = w.users;
    const { senior, ...notSenior } = w.users;
    const refused = [
      [{ ...w.users, demo: {} }, 'users.demo.clearance', /would give demo clearance Confidential/],
      [others, 'users.demo.clearance', /above your own clearance \(Internal\)/],
      [{ ...w.users, newbie: {} }, 'users.newbie.clearance', /would give newbie clearance Confidential/],
      [{ ...w.users, newbie: { clearance: 'Restricted' } }, 'users.newbie.clearance', /Restricted/],
      [{ ...w.users, senior: { clearance: 'Public' } }, 'users.senior.clearance', /cannot change a user with clearance Confidential/],
      [notSenior, 'users.senior.clearance', /cannot remove a user with clearance Confidential/],
    ];
    for (const [users, path, re] of refused) {
      const r = await api('PUT', '/api/workspace', { ...w, users });
      assert.equal(r.statusCode, 400, `${JSON.stringify(users)}: ${r.body}`);
      const e = r.json().details.errors.find((x) => x.path === path);
      assert.ok(e, `${path} in ${r.body}`);
      assert.match(e.message, re);
    }
    assert.deepEqual(readFileSync(file), before);
    assert.equal(ctx.user.clearance, 'Internal');
    assert.ok(demo && senior);

    const ok = await api('PUT', '/api/workspace', { ...w, users: { ...w.users, newbie: { clearance: 'Public' } } });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ctx.ws.config.users.newbie.clearance, 'Public');
  });
});

describe('same-origin checks on settings writes', () => {
  test('cross-site and origin-less writes are refused and change nothing', async () => {
    const files = [brandFile(), join(home, 'series.json'), join(home, 'workspace.json')];
    const before = files.map((f) => readFileSync(f));
    const evil = { origin: 'http://evil.example', 'content-type': 'application/json' };
    const attempts = [
      app.inject({ method: 'PUT', url: '/api/brands/acme', headers: evil, payload: JSON.stringify({ ...brandJson('acme'), legalName: 'Hacked' }) }),
      app.inject({ method: 'POST', url: '/api/brands', headers: evil, payload: JSON.stringify({ id: 'hacked', legalName: 'H' }) }),
      app.inject({ method: 'POST', url: '/api/brands', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'id=hacked&legalName=H' }),
      app.inject({ method: 'PUT', url: '/api/series', headers: evil, payload: '[]' }),
      app.inject({ method: 'PUT', url: '/api/workspace', headers: evil, payload: JSON.stringify({ name: 'Hacked', defaultBrand: 'acme' }) }),
      upload('/api/brands/acme/assets/logo', {}, { filename: 'a.png', mime: 'image/png', buffer: await png(5, 5) }, { origin: 'http://evil.example' }),
      upload('/api/brands/acme/assets/logo', {}, { filename: 'a.png', mime: 'image/png', buffer: await png(5, 5) }, {}),
    ];
    for (const r of await Promise.all(attempts)) {
      assert.equal(r.statusCode, 403, r.body);
      assert.equal(r.json().code, 'CSRF_REJECTED');
    }
    files.forEach((f, i) => assert.deepEqual(readFileSync(f), before[i], f));
    assert.equal(existsSync(join(home, 'brands', 'hacked')), false);
  });
});

describe('settings API for the web app', () => {
  test('GET /api/series/usage lists brand series maps and templates per series', async () => {
    const r = await api('GET', '/api/series/usage');
    assert.equal(r.statusCode, 200);
    const { usage } = r.json();
    let n = 0;
    for (const [bid, b] of ctx.ws.brands) {
      for (const [tid, sid] of Object.entries(b.series)) {
        assert.ok(usage[sid]?.includes(`${bid}: ${tid}`), `${sid} used by ${bid}: ${tid}`);
        n += 1;
      }
    }
    assert.ok(n > 0, 'the example workspace maps some series');
  });

  test('GET /api/brands/:id/assets reports what the renderer uses for every slot, with served urls', async () => {
    const created = await api('PUT', '/api/brands/delta', {
      legalName: 'Delta Example', shortName: 'Delta', addresses: { business: ['L'] }, contacts: { default: {} },
      signatories: [{ id: 'md', name: 'Sam Sample', title: 'Director' }],
      fonts: { regular: 'builtin:Manrope-Regular' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const list = async () => {
      const r = await api('GET', '/api/brands/delta/assets');
      assert.equal(r.statusCode, 200, r.body);
      return Object.fromEntries(r.json().assets.map((a) => [a.key, a]));
    };
    const fetchPinned = async (a, bytes) => {
      assert.match(a.version, /^[0-9a-f]{12}$/, a.key);
      assert.ok(a.url.endsWith(`?v=${a.version}`), a.url);
      const r = await app.inject({ url: a.url });
      assert.equal(r.statusCode, 200, `${a.url}: ${r.body}`);
      assert.match(r.headers['cache-control'], /immutable/, a.url);
      if (bytes) assert.deepEqual(r.rawPayload, bytes, a.url);
    };

    let byKey = await list();
    assert.deepEqual(Object.keys(byKey), [
      'assets.logo', 'assets.seal', 'assets.watermark', 'signature:md', 'signature-large:md',
      ...FONT_WEIGHTS.map((w) => `font:${w}`),
    ]);
    for (const w of FONT_WEIGHTS) {
      const f = byKey[`font:${w}`];
      assert.equal(f.source, 'configured', w);
      assert.equal(f.present, true, w);
      assert.equal(f.url, `/assets/brands/delta/fonts/${w}?v=${f.version}`);
      await fetchPinned(f);
    }
    assert.equal(byKey['font:regular'].path, 'builtin:Manrope-Regular');

    // Nothing uploaded yet: placeholders (still served and versioned), no watermark at all.
    for (const [key, path, url] of [
      ['assets.logo', 'assets/logo.png', '/assets/brands/delta/logo'], ['assets.seal', null, '/assets/brands/delta/seal'],
      ['signature:md', null, '/assets/brands/delta/signatures/md'], ['signature-large:md', null, '/assets/brands/delta/signatures-large/md'],
    ]) {
      const a = byKey[key];
      assert.deepEqual({ path: a.path, source: a.source, present: a.present }, { path, source: 'placeholder', present: false }, key);
      assert.equal(a.url, `${url}?v=${a.version}`);
      await fetchPinned(a);
    }
    assert.deepEqual(byKey['assets.watermark'], { key: 'assets.watermark', path: null, source: null, present: false, version: null, url: '/assets/brands/delta/watermark' });
    assert.equal((await app.inject({ url: '/assets/brands/delta/watermark' })).statusCode, 404);

    // The seal's default file, present on disk but not named in brand.json.
    const seal = await png(30, 30);
    mkdirSync(join(home, 'brands', 'delta', 'assets'), { recursive: true });
    writeFileSync(join(home, 'brands', 'delta', 'assets', 'seal.png'), seal);
    // A signature without a large one: the large slot falls back to the signature.
    const sigBytes = await png(60, 20);
    const sig = await upload('/api/brands/delta/assets/signature:md', {}, { filename: 's.png', mime: 'image/png', buffer: sigBytes }, { origin: ORIGIN });
    assert.equal(sig.statusCode, 200, sig.body);
    const logoBytes = await png(40, 20);
    const logo = await upload('/api/brands/delta/assets/logo', {}, { filename: 'l.png', mime: 'image/png', buffer: logoBytes }, { origin: ORIGIN });
    assert.equal(logo.statusCode, 200, logo.body);

    byKey = await list();
    assert.deepEqual({ ...byKey['assets.seal'], version: undefined, url: undefined },
      { key: 'assets.seal', path: 'assets/seal.png', source: 'default', present: true, version: undefined, url: undefined });
    await fetchPinned(byKey['assets.seal'], seal);
    assert.deepEqual({ path: byKey['signature:md'].path, source: byKey['signature:md'].source, present: byKey['signature:md'].present },
      { path: sig.json().path, source: 'configured', present: true });
    assert.equal(byKey['signature:md'].version, sig.json().sha256.slice(0, 12));
    const large = byKey['signature-large:md'];
    assert.deepEqual({ path: large.path, source: large.source, present: large.present }, { path: sig.json().path, source: 'fallback', present: false });
    assert.equal(large.version, byKey['signature:md'].version, 'versioned from the file actually used');
    await fetchPinned(large, sigBytes);
    const l = byKey['assets.logo'];
    assert.deepEqual({ path: l.path, source: l.source, present: l.present, version: l.version }, { path: logo.json().path, source: 'configured', present: true, version: logo.json().sha256.slice(0, 12) });
    assert.equal(l.url, `/assets/brands/delta/logo?v=${l.version}`);
    await fetchPinned(l, logoBytes);

    // Its own large signature replaces the fallback.
    const bigBytes = await png(120, 40);
    const big = await upload('/api/brands/delta/assets/signature-large:md', {}, { filename: 'b.png', mime: 'image/png', buffer: bigBytes }, { origin: ORIGIN });
    assert.equal(big.statusCode, 200, big.body);
    const own = (await list())['signature-large:md'];
    assert.deepEqual({ path: own.path, source: own.source, present: own.present, version: own.version },
      { path: big.json().path, source: 'configured', present: true, version: big.json().sha256.slice(0, 12) });
    await fetchPinned(own, bigBytes);
    // An unpinned request revalidates instead.
    const unpinned = await app.inject({ url: '/assets/brands/delta/seal' });
    assert.equal(unpinned.headers['cache-control'], 'public, no-cache');
  });

  test('GET /api/brands/:id/file downloads <id>.json; preview.pdf is no-store', async () => {
    const dl = await api('GET', '/api/brands/acme/file');
    assert.equal(dl.statusCode, 200);
    assert.match(dl.headers['content-disposition'], /^attachment; filename="acme.json"/);
    assert.match(dl.headers['content-type'], /^application\/json/);
    assert.deepEqual(JSON.parse(dl.body), brandJson('acme'));
    const pv = await api('GET', '/api/brands/acme/preview.pdf');
    assert.equal(pv.statusCode, 200);
    assert.equal(pv.headers['content-type'], 'application/pdf');
    assert.match(pv.headers['cache-control'], /no-store/);
    assert.equal(pv.rawPayload.subarray(0, 5).toString('latin1'), '%PDF-');
  });

  test('unknown and unsafe brand ids are JSON 404s', async () => {
    for (const url of ['/api/brands/nope/assets', '/api/brands/nope/file', '/api/brands/nope/preview.pdf', '/api/brands/%2E%2E/assets', '/api/brands/a%2Fb/file']) {
      const r = await api('GET', url);
      assert.equal(r.statusCode, 404, `${url}: ${r.body}`);
      assert.ok(r.json().code, url);
    }
  });
});

describe('optimistic concurrency on whole-file saves (If-Match: <fileHash>)', () => {
  const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const cases = [
    {
      name: 'brands/acme/brand.json',
      file: () => brandFile('acme'),
      get: async () => { const j = (await api('GET', '/api/brands/acme')).json(); return { body: j.file, fileHash: j.fileHash }; },
      put: (body, headers) => api('PUT', '/api/brands/acme', body, headers),
      edit: (body, n) => ({ ...body, shortName: `Acme ${n}` }),
    },
    {
      name: 'series.json',
      file: () => join(home, 'series.json'),
      get: async () => { const j = (await api('GET', '/api/series')).json(); return { body: j.series, fileHash: j.fileHash }; },
      put: (body, headers) => api('PUT', '/api/series', { series: body }, headers),
      edit: (body, n) => body.map((s) => (s.id === 'report' ? { ...s, start: 200 + n } : s)),
    },
    {
      name: 'workspace.json',
      file: () => join(home, 'workspace.json'),
      get: async () => { const j = (await api('GET', '/api/workspace')).json(); return { body: j.workspace, fileHash: j.fileHash }; },
      put: (body, headers) => api('PUT', '/api/workspace', { workspace: body }, headers),
      edit: (body, n) => ({ ...body, name: `Workspace ${n}` }),
    },
  ];

  for (const c of cases) {
    test(`${c.name}: GET returns the file hash; a second save from the same base is 409 CONFLICT and changes nothing`, async () => {
      const base = await c.get();
      assert.equal(base.fileHash, sha(c.file()), 'fileHash is the sha256 of the stored bytes');
      const first = await c.put(c.edit(base.body, 1), { 'if-match': `"${base.fileHash}"` });
      assert.equal(first.statusCode, 200, first.body.slice(0, 400));
      const afterFirst = readFileSync(c.file());
      assert.equal(first.json().fileHash, sha(c.file()), 'the response carries the new hash');
      assert.notEqual(first.json().fileHash, base.fileHash);

      const second = await c.put(c.edit(base.body, 2), { 'if-match': base.fileHash });
      assert.equal(second.statusCode, 409, second.body.slice(0, 400));
      assert.equal(second.json().code, 'CONFLICT');
      assert.equal(second.json().details.currentHash, first.json().fileHash);
      assert.deepEqual(readFileSync(c.file()), afterFirst, 'file unchanged by the refused save');

      const current = await c.put(c.edit(base.body, 3), { 'if-match': first.json().fileHash });
      assert.equal(current.statusCode, 200, 'a save with the current hash succeeds');

      const blind = await c.put(c.edit(base.body, 4));
      assert.equal(blind.statusCode, 200, 'a save without a hash is still accepted');
      assert.equal(blind.json().fileHash, sha(c.file()));
    });
  }

  test('an asset upload changes brand.json and returns the new fileHash', async () => {
    const before = (await api('GET', '/api/brands/acme')).json().fileHash;
    const r = await upload('/api/brands/acme/assets/logo', {}, { filename: 'l.png', mime: 'image/png', buffer: await png(31, 17) });
    assert.equal(r.statusCode, 200, r.body.slice(0, 300));
    assert.notEqual(r.json().fileHash, before);
    assert.equal(r.json().fileHash, sha(brandFile('acme')));
    assert.equal(r.json().brand.fileHash, r.json().fileHash);
    const stale = await api('PUT', '/api/brands/acme', brandJson('acme'), { 'if-match': before });
    assert.equal(stale.statusCode, 409, 'a save based on the pre-upload hash is refused');
  });
});

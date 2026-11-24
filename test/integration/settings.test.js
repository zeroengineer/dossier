import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { tmpDir } from '../helpers/tmp.js';
import { extractItems } from '../helpers/pdfText.js';
import { initWorkspace } from '../../src/workspace/index.js';
import { openContext } from '../../src/context.js';
import { buildServer } from '../../src/server.js';
import { FONTS_DIR } from '../../src/paths.js';
import { FONT_WEIGHTS } from '../../src/workspace/schemas.js';
import { BUILTIN_TEMPLATES_DIR } from '../../src/services/templates.js';

const ORIGIN = 'http://localhost:80';
let tmp; let home; let ctx; let app;

const brandFile = (id = 'acme') => join(home, 'brands', id, 'brand.json');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const brandJson = (id) => readJson(brandFile(id));

/** urlencoded form post from this site. */
const post = (url, fields, headers = {}) => app.inject({
  method: 'POST', url, headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded', ...headers },
  payload: new URLSearchParams(fields).toString(),
});
const api = (method, url, body) => app.inject({ method, url, ...(body !== undefined ? { payload: body } : {}) });

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

/** Post a section and expect a redirect back to the editor. */
async function saveSection(section, fields, id = 'acme') {
  const r = await post(`/settings/brands/${id}`, { $section: section, ...fields });
  assert.equal(r.statusCode, 303, `${section}: ${r.body.slice(0, 600)}`);
  assert.equal(r.headers.location, `/settings/brands/${id}?saved=${section}#sec-${section}`);
  return brandJson(id);
}

/** Post a section that must fail with field errors and leave the file byte-identical. */
async function rejectSection(section, fields, pathRe, id = 'acme') {
  const before = readFileSync(brandFile(id));
  const r = await post(`/settings/brands/${id}`, { $section: section, ...fields });
  assert.equal(r.statusCode, 400, `${section}: ${r.body.slice(0, 300)}`);
  assert.match(r.body, /Not saved\. Fix these fields/);
  assert.match(r.body, pathRe);
  assert.deepEqual(readFileSync(brandFile(id)), before, 'brand.json untouched');
  return r;
}

before(() => {
  tmp = tmpDir();
  home = join(tmp.dir, 'ws');
  initWorkspace(home);
  ctx = openContext({ home, user: 'demo', env: {} });
  app = buildServer(ctx);
});

after(async () => {
  await app?.close();
  ctx?.close();
  tmp?.cleanup();
});

describe('settings pages', () => {
  test('every settings page answers 200', async () => {
    for (const [url, re] of [
      ['/settings', /href="\/settings\/brands"/],
      ['/settings/brands', /New brand/],
      ['/settings/brands/acme', /Letterhead preview/],
      ['/settings/series', /invoice-main/],
      ['/settings/workspace', /Users and clearance/],
    ]) {
      const r = await app.inject({ url });
      assert.equal(r.statusCode, 200, url);
      assert.match(r.body, re, url);
    }
    const missing = await app.inject({ url: '/settings/brands/nope' });
    assert.equal(missing.statusCode, 404);
  });

  test('download brand.json and the preview PDF (no-store)', async () => {
    const dl = await app.inject({ url: '/settings/brands/acme/brand.json' });
    assert.equal(dl.statusCode, 200);
    assert.match(dl.headers['content-disposition'], /^attachment; filename="acme.json"/);
    assert.deepEqual(JSON.parse(dl.body), brandJson('acme'));
    const pv = await app.inject({ url: '/settings/brands/acme/preview.pdf' });
    assert.equal(pv.statusCode, 200);
    assert.equal(pv.headers['content-type'], 'application/pdf');
    assert.match(pv.headers['cache-control'], /no-store/);
    const text = await pdfText(pv.rawPayload);
    assert.match(text, /Acme Events Private Limited/);
    assert.match(text, /Page 1 of 1/);
    assert.match(text, /Sam Sample/);
  });
});

describe('brand sections round-trip', () => {
  test('identity, registrations, contacts and bank accounts', async () => {
    let b = await saveSection('identity', {
      legalName: 'Acme Events Two Private Limited', shortName: 'Acme Two',
      'addresses.business': 'Unit 1, Example Park\r\nExample City 000000\r\n', 'addresses.registered': '', projectContact: 'md',
    });
    assert.equal(b.legalName, 'Acme Events Two Private Limited');
    assert.deepEqual(b.addresses, { business: ['Unit 1, Example Park', 'Example City 000000'] });
    assert.equal(b.projectContact, 'md');
    assert.equal(ctx.ws.brands.get('acme').legalName, 'Acme Events Two Private Limited', 'ctx.ws reloaded');

    b = await saveSection('registrations', {
      'registrations.0.label': 'CIN', 'registrations.0.value': 'U00000XX2000PTC000000',
      'registrations.1.label': '', 'registrations.1.value': '',
      'registrations.2.label': 'GSTIN', 'registrations.2.value': '00AAAAA0000A0Z0',
    });
    assert.deepEqual(b.registrations, [{ label: 'CIN', value: 'U00000XX2000PTC000000' }, { label: 'GSTIN', value: '00AAAAA0000A0Z0' }]);

    b = await saveSection('contacts', {
      'contacts.0.key': 'default', 'contacts.0.email': 'hello@example.com', 'contacts.0.phone': '+00 00000 00000', 'contacts.0.website': 'www.example.com',
      'contacts.1.key': 'billing', 'contacts.1.email': 'billing@example.com', 'contacts.1.phone': '', 'contacts.1.website': '',
    });
    assert.deepEqual(b.contacts, {
      default: { email: 'hello@example.com', phone: '+00 00000 00000', website: 'www.example.com' },
      billing: { email: 'billing@example.com' },
    });

    b = await saveSection('bankAccounts', {
      'bankAccounts.0.accountName': 'Acme Events Two Private Limited', 'bankAccounts.0.bankName': 'Example Bank',
      'bankAccounts.0.accountNumber': '000000000001', 'bankAccounts.0.ifsc': 'EXMP0000001', 'bankAccounts.0.swift': '', 'bankAccounts.0.branch': '',
    });
    assert.deepEqual(b.bankAccounts, [{ accountName: 'Acme Events Two Private Limited', bankName: 'Example Bank', accountNumber: '000000000001', ifsc: 'EXMP0000001' }]);

    const page = await app.inject({ url: '/settings/brands/acme?saved=bankAccounts' });
    assert.match(page.body, /value="000000000001"/);
    assert.match(page.body, /value="billing@example.com"/);
    assert.match(page.body, /Saved\./);
  });

  test('letterhead, palette, fonts and image paths', async () => {
    let b = await saveSection('letterhead', {
      'letterhead.lines.0': 'CIN: {registrations.0.value}', 'letterhead.lines.1': 'Email: {contact.email}', 'letterhead.lines.2': '',
      'footer.left': '{contact.website}', 'footer.center': '', 'footer.right': 'Page {page} of {pages}',
    });
    assert.deepEqual(b.letterhead, { lines: ['CIN: {registrations.0.value}', 'Email: {contact.email}'] });
    assert.deepEqual(b.footer, { left: '{contact.website}', right: 'Page {page} of {pages}' });

    b = await saveSection('palette', {
      'palette.accent': '#AA3300', 'palette.ink': '#111111', '$default.palette.ink': 'on', 'palette.section': '#203040',
    });
    assert.deepEqual(b.palette, { accent: '#aa3300', section: '#203040' });
    assert.equal(ctx.ws.brands.get('acme').palette.ink, '#1a1a1a', 'a default box leaves the default');

    b = await saveSection('fonts', { 'fonts.regular': 'builtin:Manrope-Medium', 'fonts.bold': '' });
    assert.equal(b.fonts.regular, 'builtin:Manrope-Medium');
    assert.equal(b.fonts.bold, undefined);
    assert.equal(ctx.ws.brands.get('acme').fonts.bold, 'builtin:Manrope-Bold');

    await rejectSection('assets', { 'assets.logo': 'assets/logo.png', 'assets.watermark': 'assets/wm.png' }, /assets.watermark<\/code>: no file &quot;assets\/wm.png&quot;/);
    writeFileSync(join(home, 'brands', 'acme', 'assets', 'wm.png'), await png(4, 4));
    b = await saveSection('assets', { 'assets.logo': 'assets/logo.png', 'assets.seal': '', 'assets.watermark': 'assets/wm.png' });
    assert.deepEqual(b.assets, { logo: 'assets/logo.png', watermark: 'assets/wm.png' }, 'an unchanged missing logo path is left alone');
  });

  test('signatories, strings, tax modes and the series map', async () => {
    let b = await saveSection('signatories', {
      'signatories.0.id': 'md', 'signatories.0.name': 'Sam Sample', 'signatories.0.title': 'Director', 'signatories.0.signature': 'assets/sign-md.png',
      'signatories.1.id': 'ops', 'signatories.1.name': 'Alex Example', 'signatories.1.title': 'Operations', 'signatories.1.email': 'alex@example.com',
      'defaultSignatory.0.key': 'invoice', 'defaultSignatory.0.signatory': 'ops',
      'defaultSignatory.1.key': 'letter', 'defaultSignatory.1.signatory': 'md',
    });
    assert.deepEqual(b.signatories, [
      { id: 'md', name: 'Sam Sample', title: 'Director', signature: 'assets/sign-md.png' },
      { id: 'ops', name: 'Alex Example', title: 'Operations', email: 'alex@example.com' },
    ]);
    assert.deepEqual(b.defaultSignatory, { invoice: 'ops', letter: 'md' });

    b = await saveSection('strings', {
      'strings.0.key': 'confidential', 'strings.0.value': 'Private and confidential',
      'strings.1.key': 'forCompany', 'strings.1.value': 'FOR {legalName}',
    });
    assert.deepEqual(b.strings, { confidential: 'Private and confidential', forCompany: 'FOR {legalName}' });

    b = await saveSection('tax', {
      'tax.modes.0.id': 'none', 'tax.modes.0.label': 'No tax', 'tax.modes.0.rates': '',
      'tax.modes.1.id': 'gst', 'tax.modes.1.label': 'GST', 'tax.modes.1.rates': 'CGST (9%) = 9%\nSGST (9%) = 0.09',
      'tax.defaultMode': 'gst', 'tax.defaultHsn': '000000',
    });
    assert.deepEqual(b.tax, {
      modes: [{ id: 'none', label: 'No tax', rates: [] }, { id: 'gst', label: 'GST', rates: [{ label: 'CGST (9%)', rate: 0.09 }, { label: 'SGST (9%)', rate: 0.09 }] }],
      defaultMode: 'gst', defaultHsn: '000000',
    });

    b = await saveSection('series', { 'series.0.key': 'invoice', 'series.0.series': 'generic', 'series.1.key': 'receipt', 'series.1.series': 'receipt' });
    assert.deepEqual(b.series, { invoice: 'generic', receipt: 'receipt' });
    assert.equal(ctx.ws.brands.get('acme').series.invoice, 'generic');

    const page = await app.inject({ url: '/settings/brands/acme' });
    assert.match(page.body, /CGST \(9%\) = 0.09/);
    assert.match(page.body, /Private and confidential/);
  });

  test('keys the form does not edit are kept', async () => {
    const put = await api('PUT', '/api/brands/acme', { ...brandJson('acme'), layoutProfiles: { letter: { ML: 40 } }, templateParams: { 'offer-letter': { clauses: [] } } });
    assert.equal(put.statusCode, 200, put.body);
    const b = await saveSection('identity', { legalName: 'Acme Events Private Limited', shortName: 'Acme Events', 'addresses.business': 'Unit 1, Example Park' });
    assert.deepEqual(b.layoutProfiles, { letter: { ML: 40 } });
    assert.deepEqual(b.templateParams, { 'offer-letter': { clauses: [] } });
    assert.equal(b.projectContact, undefined, 'blank select removes the key');
  });

  test('a save changes the config hash, is audited and reaches the preview without a restart', async () => {
    const hash = configHash();
    await saveSection('identity', { legalName: 'Acme Preview Check Private Limited', shortName: 'Acme Events', 'addresses.business': 'Unit 1, Example Park' });
    assert.notEqual(configHash(), hash);
    assert.equal(configHash(), ctx.ws.brandHashes.get('acme'));
    const row = ctx.db.prepare("SELECT * FROM audit_log WHERE action = 'workspace.write' AND target_id = 'brands/acme/brand.json' ORDER BY id DESC LIMIT 1").get();
    assert.equal(row.target_kind, 'workspace');
    assert.equal(JSON.parse(row.before).legalName, 'Acme Events Private Limited');
    assert.equal(JSON.parse(row.after).legalName, 'Acme Preview Check Private Limited');
    const pv = await app.inject({ url: '/settings/brands/acme/preview.pdf' });
    assert.match(await pdfText(pv.rawPayload), /Acme Preview Check Private Limited/);
  });
});

describe('invalid brand input', () => {
  test('field errors are shown and brand.json is untouched', async () => {
    await rejectSection('identity', { legalName: '', shortName: 'Acme', 'addresses.business': 'Line' }, /<code>legalName<\/code>: must not be empty/);
    await rejectSection('identity', { legalName: 'Acme', shortName: 'Acme', 'addresses.business': '' }, /addresses.business<\/code>: needs at least one line/);
    await rejectSection('registrations', { 'registrations.0.label': 'CIN', 'registrations.0.value': '' }, /registrations.0.value<\/code>: must not be empty/);
    await rejectSection('contacts', { 'contacts.0.key': 'billing', 'contacts.0.email': 'billing@example.com' }, /must contain a &quot;default&quot; contact/);
    await rejectSection('contacts', { 'contacts.0.key': 'default', 'contacts.1.key': 'default', 'contacts.1.email': 'x@example.com' }, /duplicate key/);
    await rejectSection('palette', { 'palette.accent': 'red' }, /palette.accent<\/code>: must be a hex colour/);
    await rejectSection('fonts', { 'fonts.bold': 'builtin:Nope-Bold' }, /unknown built-in font/);
    await rejectSection('assets', { 'assets.logo': '../../outside.png' }, /assets.logo<\/code>: must be a relative path inside the brand folder/);
    await rejectSection('assets', { 'assets.logo': '/etc/hosts' }, /assets.logo<\/code>: must be a relative path/);
    await rejectSection('assets', { 'assets.logo': 'assets/nothing-here.png' }, /assets.logo<\/code>: no file &quot;assets\/nothing-here.png&quot;/);
    await rejectSection('signatories', {
      'signatories.0.id': 'md', 'signatories.0.name': 'A', 'signatories.0.title': 'B',
      'signatories.1.id': 'md', 'signatories.1.name': 'C', 'signatories.1.title': 'D',
    }, /duplicate signatory id/);
    await rejectSection('tax', { 'tax.modes.0.id': 'none', 'tax.modes.0.label': 'No tax', 'tax.defaultMode': 'gst' }, /tax.defaultMode<\/code>: &quot;gst&quot; is not one of tax.modes/);
    await rejectSection('tax', { 'tax.modes.0.id': 'gst', 'tax.modes.0.label': 'GST', 'tax.modes.0.rates': 'GST = lots' }, /write each rate as/);
    await rejectSection('series', { 'series.0.key': 'invoice', 'series.0.series': 'no-such-series' }, /unknown series &quot;no-such-series&quot;/);
  });

  test('the failed form shows what was typed', async () => {
    const r = await rejectSection('registrations', { 'registrations.0.label': 'Typed label', 'registrations.0.value': '' }, /registrations.0.value/);
    assert.match(r.body, /value="Typed label"/);
    assert.match(r.body, /name="registrations.0.value" value="" class="invalid"/);
  });

  test('brand ids such as .. and %2F are not found or refused, and nothing is written', async () => {
    const before = readdirSync(home).sort();
    const brandsBefore = readdirSync(join(home, 'brands')).sort();
    const reqs = [
      ['GET', '/settings/brands/..'], ['GET', '/settings/brands/%2F'], ['GET', '/settings/brands/%2E%2E'], ['GET', '/settings/brands/..%2F..%2Fworkspace/brand.json'],
      ['GET', '/settings/brands/%2E%2E/preview.pdf'], ['GET', '/api/brands/%2E%2E'], ['GET', '/api/brands/%2F'],
    ];
    for (const [method, url] of reqs) {
      const r = await app.inject({ method, url });
      assert.equal(r.statusCode, 404, `${url}: ${r.statusCode}`);
    }
    for (const url of ['/settings/brands/%2E%2E', '/settings/brands/%2F', '/settings/brands/..']) {
      const r = await post(url, { $section: 'identity', legalName: 'X', shortName: 'X', 'addresses.business': 'L' });
      assert.equal(r.statusCode, 404, url);
    }
    for (const url of ['/api/brands/%2E%2E', '/api/brands/%2F', '/api/brands/..%2F..%2Fx', '/api/brands/a%2Fb']) {
      const r = await api('PUT', url, { legalName: 'X', shortName: 'X', addresses: { business: ['L'] }, contacts: { default: {} } });
      // %2E%2E is normalised to ".." by URL parsing and leaves no route (404); other ids are refused (400).
      assert.ok([400, 404].includes(r.statusCode), `${url}: ${r.body}`);
      assert.ok(['INVALID_INPUT', 'NOT_FOUND'].includes(r.json().code), url);
    }
    const up = await upload('/api/brands/%2E%2E/assets/logo', {}, { filename: 'a.png', mime: 'image/png', buffer: await png(4, 4) }, { origin: ORIGIN });
    assert.equal(up.statusCode, 404);
    const created = await post('/settings/brands', { id: '..', legalName: 'X', shortName: 'X', 'addresses.business': 'L', 'contact.email': 'x@example.com' });
    assert.equal(created.statusCode, 400);
    assert.deepEqual(readdirSync(home).sort(), before);
    assert.deepEqual(readdirSync(join(home, 'brands')).sort(), brandsBefore);
    assert.equal(existsSync(join(tmp.dir, 'brand.json')), false);
  });

  test('unknown sections and brands', async () => {
    const r = await post('/settings/brands/acme', { $section: 'nope' });
    assert.equal(r.statusCode, 400);
    const missing = await post('/settings/brands/nope', { $section: 'identity' });
    assert.equal(missing.statusCode, 404);
  });
});

describe('brand assets', () => {
  test('a PNG logo is stored in the brand folder and used by the preview', async () => {
    const buffer = await png(300, 40);
    const r = await upload('/settings/brands/acme/assets', { key: 'logo' }, { filename: '../../evil name.png', mime: 'image/png', buffer });
    assert.equal(r.statusCode, 303, r.body.slice(0, 300));
    const logo = brandJson('acme').assets.logo;
    assert.match(logo, /^assets\/logo-[0-9a-f]{12}\.png$/, 'generated name, nothing from the client');
    assert.deepEqual(readFileSync(join(home, 'brands', 'acme', logo)), buffer);
    const pv = await app.inject({ url: '/settings/brands/acme/preview.pdf' });
    // The letterhead resizes the logo to height 80: 300x40 becomes 600x80 (the placeholder would be 351 wide).
    assert.match(pv.rawPayload.toString('latin1'), /\/Width 600\s/);
    const served = await app.inject({ url: '/assets/brands/acme/logo' });
    assert.deepEqual(served.rawPayload, buffer);
    const rows = ctx.db.prepare("SELECT id, target_id FROM audit_log WHERE action = 'workspace.write' ORDER BY id DESC LIMIT 2").all();
    assert.deepEqual(rows.map((r) => r.target_id).sort(), [`brands/acme/${logo}`, 'brands/acme/brand.json'].sort(), 'asset and brand.json audited together');
  });

  test('signatures, JPEG and fonts through the API', async () => {
    const jpeg = await sharp({ create: { width: 120, height: 48, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    const sig = await upload('/api/brands/acme/assets/signature:ops', {}, { filename: 's.jpg', mime: 'image/jpeg', buffer: jpeg }, { 'x-dossier-client': 'test' });
    assert.equal(sig.statusCode, 200, sig.body);
    assert.match(sig.json().path, /^assets\/sign-ops-[0-9a-f]{12}\.jpg$/);
    assert.equal(brandJson('acme').signatories.find((s) => s.id === 'ops').signature, sig.json().path);

    const ttf = readFileSync(join(FONTS_DIR, 'Manrope', 'Manrope-SemiBold.ttf'));
    const font = await upload('/api/brands/acme/assets/font:bold', {}, { filename: 'x.ttf', mime: 'font/ttf', buffer: ttf }, { origin: ORIGIN });
    assert.equal(font.statusCode, 200, font.body);
    assert.match(brandJson('acme').fonts.bold, /^assets\/fonts\/bold-[0-9a-f]{12}\.ttf$/);
    const pv = await app.inject({ url: '/settings/brands/acme/preview.pdf' });
    assert.equal(pv.statusCode, 200);
  });

  test('non-images, broken images, junk fonts and unknown keys are rejected; brand.json untouched', async () => {
    const before = readFileSync(brandFile());
    const cases = [
      ['logo', { filename: 'logo.png', mime: 'image/png', buffer: Buffer.from('this is not an image at all') }, /PNG or JPEG/],
      ['logo', { filename: 'logo.png', mime: 'image/png', buffer: Buffer.concat([(await png(10, 10)).subarray(0, 40)]) }, /could not be decoded/],
      ['font:bold', { filename: 'f.ttf', mime: 'font/ttf', buffer: Buffer.from('not a font file') }, /TrueType/],
      ['font:bold', { filename: 'f.ttf', mime: 'font/ttf', buffer: Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(64)]) }, /could not be read/],
      ['signature:nobody', { filename: 's.png', mime: 'image/png', buffer: await png(10, 10) }, /no signatory &quot;nobody&quot;/],
      ['../x', { filename: 's.png', mime: 'image/png', buffer: await png(10, 10) }, /Unknown asset key/],
    ];
    const assetsBefore = readFileSync(brandFile());
    for (const [key, file, re] of cases) {
      const r = await upload('/settings/brands/acme/assets', { key }, file);
      assert.equal(r.statusCode, 400, `${key}: ${r.body.slice(0, 200)}`);
      assert.match(r.body, re, key);
    }
    const huge = Buffer.concat([(await png(4, 4)), Buffer.alloc(10 * 1024 * 1024)]);
    const big = await upload('/api/brands/acme/assets/logo', {}, { filename: 'big.png', mime: 'image/png', buffer: huge }, { origin: ORIGIN });
    assert.equal(big.statusCode, 413, big.body.slice(0, 200));
    assert.equal(big.json().code, 'ASSET_TOO_LARGE');
    const bigForm = await upload('/settings/brands/acme/assets', { key: 'logo' }, { filename: 'big.png', mime: 'image/png', buffer: huge });
    assert.equal(bigForm.statusCode, 413);
    assert.match(bigForm.body, /ASSET_TOO_LARGE/);
    const apiBad = await upload('/api/brands/acme/assets/logo', {}, cases[0][1], { origin: ORIGIN });
    assert.equal(apiBad.json().code, 'ASSET_INVALID');
    assert.deepEqual(readFileSync(brandFile()), before);
    assert.deepEqual(readFileSync(brandFile()), assetsBefore);
  });
});

describe('inherited brands', () => {
  test('a child brand writes only overridden fields and shows inherited values', async () => {
    const created = await post('/settings/brands', { id: 'acme-llp', inheritsFrom: 'acme', legalName: 'Acme Events LLP', shortName: '', 'addresses.business': '' });
    assert.equal(created.statusCode, 303, created.body.slice(0, 400));
    assert.deepEqual(brandJson('acme-llp'), { id: 'acme-llp', inheritsFrom: 'acme', legalName: 'Acme Events LLP' });
    assert.ok(ctx.ws.brands.has('acme-llp'));
    assert.ok(ctx.db.prepare('SELECT 1 FROM brands WHERE id = ?').get('acme-llp'), 'brand row synced');

    const page = await app.inject({ url: '/settings/brands/acme-llp' });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /name="shortName" value="" placeholder="Acme Events"/);
    assert.match(page.body, /Override the list inherited from <code>acme<\/code>/);

    let b = await saveSection('identity', { legalName: 'Acme Events LLP', shortName: '', 'addresses.business': '' }, 'acme-llp');
    assert.deepEqual(b, { id: 'acme-llp', inheritsFrom: 'acme', legalName: 'Acme Events LLP' });
    b = await saveSection('registrations', { 'registrations.0.label': 'LLPIN', 'registrations.0.value': 'AAA-0000' }, 'acme-llp');
    assert.equal(b.registrations, undefined, 'unticked override inherits the list');
    b = await saveSection('registrations', { '$override.registrations': 'on', 'registrations.0.label': 'LLPIN', 'registrations.0.value': 'AAA-0000' }, 'acme-llp');
    assert.deepEqual(b.registrations, [{ label: 'LLPIN', value: 'AAA-0000' }]);
    b = await saveSection('palette', { 'palette.accent': '#00aa00', 'palette.ink': '#000000', '$default.palette.ink': 'on' }, 'acme-llp');
    assert.deepEqual(b.palette, { accent: '#00aa00' });
    assert.equal(ctx.ws.brands.get('acme-llp').palette.section, '#203040', 'inherited from acme');

    const logo = await png(50, 50);
    const up = await upload('/settings/brands/acme-llp/assets', { key: 'signature:md' }, { filename: 's.png', mime: 'image/png', buffer: logo });
    assert.equal(up.statusCode, 303, up.body.slice(0, 300));
    b = brandJson('acme-llp');
    assert.equal(b.signatories.length, ctx.ws.brands.get('acme').signatories.length, 'inherited list copied before setting the path');
    assert.ok(existsSync(join(home, 'brands', 'acme-llp', b.signatories.find((s) => s.id === 'md').signature)));
  });

  test('a duplicate or invalid new brand is refused', async () => {
    const dup = await post('/settings/brands', { id: 'acme', legalName: 'X', shortName: 'X', 'addresses.business': 'L', 'contact.email': 'a@example.com' });
    assert.equal(dup.statusCode, 409);
    const bad = await post('/settings/brands', { id: 'beta', legalName: 'Beta', shortName: 'Beta', 'addresses.business': '' });
    assert.equal(bad.statusCode, 400);
    assert.match(bad.body, /addresses.business/);
    assert.equal(existsSync(join(home, 'brands', 'beta')), false);
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
});

describe('series', () => {
  test('form round-trip', async () => {
    const list = readJson(join(home, 'series.json'));
    const fields = {};
    list.forEach((s, i) => {
      fields[`series.${i}.id`] = s.id;
      fields[`series.${i}.pattern`] = s.id === 'report' ? 'ACM-RPT-{YYYY}-{####}' : s.pattern;
      fields[`series.${i}.scope`] = s.scope ?? '';
      fields[`series.${i}.start`] = s.id === 'report' ? '100' : String(s.start ?? '');
      fields[`series.${i}.counter`] = s.counter ?? '';
    });
    const r = await post('/settings/series', fields);
    assert.equal(r.statusCode, 303, r.body.slice(0, 500));
    const saved = readJson(join(home, 'series.json'));
    assert.deepEqual(saved.find((s) => s.id === 'report'), { id: 'report', pattern: 'ACM-RPT-{YYYY}-{####}', scope: 'brand+year', start: 100 });
    assert.deepEqual(saved.find((s) => s.id === 'receipt'), { id: 'receipt', pattern: 'ACM-REC-{YYYY}-{####}', scope: 'brand+year', counter: 'invoice-main' });
    assert.equal(ctx.ws.series.get('report').start, 100);
    const page = await app.inject({ url: '/settings/series?saved=1' });
    assert.match(page.body, /ACM-RPT-\{YYYY\}-\{####\}/);
  });

  test('a chained counter, a bad pattern and a series still in use are rejected; series.json untouched', async () => {
    const file = join(home, 'series.json');
    const before = readFileSync(file);
    const list = readJson(file);
    const chained = list.map((s) => (s.id === 'receipt' ? { ...s, counter: 'debit-note' } : s));
    const r1 = await api('PUT', '/api/series', chained);
    assert.equal(r1.statusCode, 400);
    assert.match(r1.json().details.errors[0].message, /counter must name a series that owns its counter/);

    const fields = { 'series.0.id': 'only', 'series.0.pattern': 'X-{PREFIX}-{##}' };
    const r2 = await post('/settings/series', fields);
    assert.equal(r2.statusCode, 400);
    assert.match(r2.body, /value="X-\{PREFIX\}-\{##\}"/);
    assert.match(r2.body, /series.0.pattern<\/code>: [^<]*PREFIX/);

    const r3 = await api('PUT', '/api/series', list.filter((s) => s.id !== 'generic'));
    assert.equal(r3.statusCode, 400);
    assert.equal(r3.json().details.errors[0].file, 'brands/acme/brand.json');

    const r4 = await post('/settings/series', { 'series.0.id': 'a', 'series.0.pattern': 'A-{##}', 'series.0.start': 'one' });
    assert.equal(r4.statusCode, 400);
    assert.match(r4.body, /must be a whole number/);
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

  test('GET/PUT /api/series', async () => {
    const got = await api('GET', '/api/series');
    const list = got.json().series;
    const put = await api('PUT', '/api/series', { series: [...list, { id: 'extra', pattern: 'ACM-X-{FY}-{###}', scope: 'brand+year' }] });
    assert.equal(put.statusCode, 200, put.body);
    assert.ok(ctx.ws.series.has('extra'));
    assert.equal(put.json().series.at(-1).counter, undefined, 'stored as written, not with the defaulted counter');
  });
});

describe('workspace settings', () => {
  test('form round-trip keeps the hierarchy', async () => {
    const r = await post('/settings/workspace', {
      name: 'Renamed Workspace', defaultBrand: 'acme', 'locale.currencySymbol': '$', 'locale.currencyCode': 'USD', 'locale.numberLocale': '',
      'users.0.id': 'demo', 'users.0.clearance': 'Confidential', 'users.1.id': 'intern', 'users.1.clearance': 'Internal',
    });
    assert.equal(r.statusCode, 303, r.body.slice(0, 500));
    const w = readJson(join(home, 'workspace.json'));
    assert.equal(w.name, 'Renamed Workspace');
    assert.deepEqual(w.locale, { currencySymbol: '$', currencyCode: 'USD' });
    assert.deepEqual(w.users, { demo: { clearance: 'Confidential' }, intern: { clearance: 'Internal' } });
    assert.deepEqual(w.hierarchy, {});
    assert.equal(ctx.ws.config.locale.numberLocale, 'en-IN');
    const page = await app.inject({ url: '/' });
    assert.match(page.body, /Renamed Workspace/);
  });

  test('invalid values and clearances above your own are refused', async () => {
    const file = join(home, 'workspace.json');
    const before = readFileSync(file);
    const r1 = await post('/settings/workspace', { name: 'W', defaultBrand: 'acme', 'locale.currencyCode': 'dollars', 'users.0.id': 'demo', 'users.0.clearance': 'Confidential' });
    assert.equal(r1.statusCode, 400);
    assert.match(r1.body, /locale.currencyCode<\/code>: must be a 3-letter ISO code/);
    const r2 = await post('/settings/workspace', { name: 'W', defaultBrand: 'acme', 'users.0.id': 'demo', 'users.0.clearance': 'Restricted' });
    assert.equal(r2.statusCode, 400);
    assert.match(r2.body, /above your own clearance/);
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
    const form = await post('/settings/workspace', { name: w.name, defaultBrand: 'acme', 'users.0.id': 'demo', 'users.0.clearance': '', 'users.1.id': 'senior', 'users.1.clearance': 'Confidential' });
    assert.equal(form.statusCode, 400);
    assert.match(form.body, /would give demo clearance Confidential/);
    assert.deepEqual(readFileSync(file), before);
    assert.equal(ctx.user.clearance, 'Internal');

    const ok = await api('PUT', '/api/workspace', { ...w, users: { ...w.users, newbie: { clearance: 'Public' } } });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ctx.ws.config.users.newbie.clearance, 'Public');
  });
});

describe('same-origin checks on settings writes', () => {
  test('cross-site and origin-less posts are refused and change nothing', async () => {
    const files = [brandFile(), join(home, 'series.json'), join(home, 'workspace.json')];
    const before = files.map((f) => readFileSync(f));
    const evil = { origin: 'http://evil.example' };
    const attempts = [
      post('/settings/brands/acme', { $section: 'identity', legalName: 'Hacked', shortName: 'H', 'addresses.business': 'L' }, evil),
      app.inject({ method: 'POST', url: '/settings/brands/acme', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: '$section=identity&legalName=Hacked' }),
      post('/settings/series', { 'series.0.id': 'x', 'series.0.pattern': 'X-{##}' }, evil),
      post('/settings/workspace', { name: 'Hacked', defaultBrand: 'acme' }, evil),
      post('/settings/brands', { id: 'hacked', legalName: 'H', shortName: 'H', 'addresses.business': 'L' }, evil),
      upload('/settings/brands/acme/assets', { key: 'logo' }, { filename: 'a.png', mime: 'image/png', buffer: await png(5, 5) }, evil),
      upload('/api/brands/acme/assets/logo', {}, { filename: 'a.png', mime: 'image/png', buffer: await png(5, 5) }, {}),
      app.inject({ method: 'PUT', url: '/api/series', headers: { origin: 'http://evil.example', 'content-type': 'application/json' }, payload: '[]' }),
    ];
    for (const r of await Promise.all(attempts)) {
      assert.equal(r.statusCode, 403, r.body);
      assert.equal(r.json().code, 'CSRF_REJECTED');
    }
    files.forEach((f, i) => assert.deepEqual(readFileSync(f), before[i], f));
    assert.equal(existsSync(join(home, 'brands', 'hacked')), false);
  });

  test('brand values are escaped in the settings pages', async () => {
    await saveSection('identity', { legalName: '<script>alert(1)</script> Ltd', shortName: 'Acme', 'addresses.business': 'L' });
    for (const url of ['/settings', '/settings/brands', '/settings/brands/acme']) {
      const r = await app.inject({ url });
      assert.doesNotMatch(r.body, /<script>alert/, url);
    }
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

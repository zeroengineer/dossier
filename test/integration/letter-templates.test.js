import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { openContext } from '../../src/context.js';
import { getDocument, readRendition } from '../../src/services/documents.js';
import { upsertEntity } from '../../src/services/entities.js';
import { generateDocument, previewDocument } from '../../src/services/generator.js';
import { listTemplateErrors, listTemplates } from '../../src/services/templates.js';
import { extractItems } from '../helpers/pdfText.js';
import { fixtureInput, withExampleCtx } from '../helpers/templateRender.js';

sharp.cache(false);
const LETTERS = ['offer-letter', 'internship-offer', 'internship-certificate', 'experience-certificate', 'relieving-letter'];
const pdfText = async (buf) => (await extractItems(buf)).map((i) => i.text).join(' ');

/** Edit the example brand of `home`, then run `fn` with a fresh context on it (people seeded). */
async function withEditedBrand(home, edit, fn) {
  const file = join(home, 'brands', 'acme', 'brand.json');
  const brand = JSON.parse(readFileSync(file, 'utf8'));
  edit(brand);
  writeFileSync(file, JSON.stringify(brand, null, 2));
  const ctx = openContext({ home, user: 'demo', dbFile: ':memory:', env: {} });
  try {
    const seeds = JSON.parse(readFileSync(join(home, 'seeds', 'entities.json'), 'utf8'));
    for (const e of seeds.entities.filter((x) => x.kind === 'person')) upsertEntity(ctx, e);
    return await fn(ctx);
  } finally {
    ctx.close();
  }
}

test('the letter templates load as built-ins without errors', () => withExampleCtx(async (ctx) => {
  const ids = listTemplates(ctx).map((t) => t.id);
  for (const id of LETTERS) assert.ok(ids.includes(id), id);
  assert.deepEqual(listTemplateErrors(ctx), []);
}));

test('certificates and the relieving letter share the hr-cert series; offer letters stay unnumbered', () => withExampleCtx(async (ctx) => {
  const cert = await generateDocument(ctx, 'internship-certificate', fixtureInput('internship-certificate'));
  const exp = await generateDocument(ctx, 'experience-certificate', fixtureInput('experience-certificate'));
  const rel = await generateDocument(ctx, 'relieving-letter', fixtureInput('relieving-letter'));
  assert.deepEqual([cert.number, exp.number, rel.number], ['ACM/HR/2026/EXP-001', 'ACM/HR/2026/EXP-002', 'ACM/HR/2026/EXP-003']);
  const offer = await generateDocument(ctx, 'offer-letter', fixtureInput('offer-letter'));
  const intern = await generateDocument(ctx, 'internship-offer', fixtureInput('internship-offer'));
  assert.deepEqual([offer.number, intern.number], [null, null]);

  const doc = getDocument(ctx, offer.documentId);
  assert.equal(doc.type, 'Offer Letter');
  assert.equal(doc.party.type, 'Person');
  assert.equal(doc.party.name, 'Jordan Placeholder');
  assert.equal(doc.docDate, '2026-08-29');
  assert.equal(doc.amountMinor, null);
  assert.equal(getDocument(ctx, rel.documentId).type, 'Relieving Letter');

  const offerText = await pdfText(readRendition(ctx, offer.documentId, { kind: 'pdf' }).buffer);
  assert.doesNotMatch(offerText, /DRAFT|Ref:/);
  const relText = await pdfText(readRendition(ctx, rel.documentId, { kind: 'pdf' }).buffer);
  assert.match(relText, /Ref: ACM\/HR\/2026\/EXP-003/);
  const md = readRendition(ctx, cert.documentId, { kind: 'md' }).buffer.toString('utf8');
  assert.match(md, /Ref: ACM\/HR\/2026\/EXP-001/);
}));

test('preview of an offer letter lists missing fields, then renders a draft', () => withExampleCtx(async (ctx) => {
  const r = await previewDocument(ctx, 'offer-letter', { date: '2026-08-29' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.map((m) => m.name).sort(), ['designation', 'earnings', 'employee', 'joiningDate', 'recipient.name']);
  const ok = await previewDocument(ctx, 'offer-letter', fixtureInput('offer-letter'));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.renditions.map((x) => x.kind), ['pdf', 'html', 'md']);
  const text = await pdfText(readFileSync(ok.renditions.find((x) => x.kind === 'pdf').path));
  assert.doesNotMatch(text, /Ref:/, 'an unnumbered letter prints no reference, not even in a preview');
}));

test('brand templateParams replace clause lists per workspace; a mapped series numbers the offer letter', () => withExampleCtx(async (_ctx, home) => {
  await withEditedBrand(home, (b) => {
    b.series['offer-letter'] = 'generic';
    b.templateParams = {
      'offer-letter': { termsTitle: 'Conditions', clauses: [{ title: 'Workspace Clause', paragraphs: ['Applies to **{designation}**.'] }] },
      'relieving-letter': { title: 'SERVICE AND RELIEVING LETTER' },
    };
  }, async (ctx) => {
    const offer = await generateDocument(ctx, 'offer-letter', fixtureInput('offer-letter'));
    assert.equal(offer.number, 'ACM-DOC-2026-0001');
    const text = await pdfText(readRendition(ctx, offer.documentId, { kind: 'pdf' }).buffer);
    assert.match(text, /Ref: ACM-DOC-2026-0001/);
    assert.match(text, /CONDITIONS 1\. Workspace Clause Applies to Software Developer/);
    assert.doesNotMatch(text, /Employment Status/);
    // Input still wins over the brand's list.
    const own = await generateDocument(ctx, 'offer-letter', { ...fixtureInput('offer-letter'), clauses: [{ title: 'Input Clause' }] });
    assert.match(await pdfText(readRendition(ctx, own.documentId, { kind: 'pdf' }).buffer), /1\. Input Clause/);
    const rel = await generateDocument(ctx, 'relieving-letter', fixtureInput('relieving-letter'));
    assert.match(await pdfText(readRendition(ctx, rel.documentId, { kind: 'pdf' }).buffer), /SERVICE AND RELIEVING LETTER/);
  });
}));

// Render a built-in template from a fake-data fixture (test/fixtures/inputs/<id>.json) without touching the vault:
// example workspace, in-memory database, the example client and person entities, a pinned number and creation date.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { initWorkspace } from '../../src/workspace/index.js';
import { openContext } from '../../src/context.js';
import { upsertEntity } from '../../src/services/entities.js';
import { getTemplate } from '../../src/services/templates.js';
import { resolveTemplateFields } from '../../src/services/fields.js';
import { renderRenditions } from '../../src/services/generator.js';
import { extractImages, extractItems } from './pdfText.js';
import { tmpDir } from './tmp.js';

const INPUTS = join(import.meta.dirname, '..', 'fixtures', 'inputs');
const SNAPSHOTS = join(import.meta.dirname, '..', 'snapshot', '__snapshots__');

/** The fixture input of a template. */
export const fixtureInput = (id) => JSON.parse(readFileSync(join(INPUTS, `${id}.json`), 'utf8'));

/**
 * Open a throwaway context on a copy of the example workspace with the example clients and people as entities.
 * @param {(ctx: object) => Promise<any>} fn
 */
export async function withExampleCtx(fn) {
  const { dir, cleanup } = tmpDir();
  let ctx;
  try {
    const home = join(dir, 'ws');
    initWorkspace(home);
    ctx = openContext({ home, user: 'demo', dbFile: ':memory:', env: {} });
    const seeds = JSON.parse(readFileSync(join(home, 'seeds', 'entities.json'), 'utf8'));
    for (const e of seeds.entities.filter((x) => x.kind === 'client' || x.kind === 'person')) upsertEntity(ctx, e);
    return await fn(ctx, home);
  } finally {
    ctx?.close();
    cleanup();
  }
}

/**
 * Resolve the fixture (plus `overrides`) and render every rendition with a pinned number and creation date.
 * @param {object} ctx @param {string} id @param {{ input?: object, number?: string|null, draft?: boolean }} [opts]
 * @returns {Promise<{ values: object, pdf: Buffer, html: string, md: string }>}
 */
export async function renderFixture(ctx, id, { input = fixtureInput(id), number = 'ACM-2026-0001', draft = false } = {}) {
  const t = await getTemplate(ctx, id);
  const r = resolveTemplateFields(ctx, t, input, { brandId: 'acme' });
  assert.deepEqual({ missing: r.missing, errors: r.errors }, { missing: [], errors: [] });
  const out = await renderRenditions(ctx, t, r.values, { brand: 'acme', number, draft, creationDate: '2026-01-01T00:00:00Z' });
  const by = Object.fromEntries(out.map((o) => [o.kind, o.buffer]));
  return { values: r.values, pdf: by.pdf, html: by.html.toString('utf8'), md: by.md.toString('utf8') };
}

/**
 * Compare a PDF's geometry (text items and images) with `test/snapshot/__snapshots__/<name>.json`; the file is written
 * when it is missing or UPDATE_SNAPSHOTS=1.
 * @param {string} name @param {Buffer} pdf
 */
export async function assertGeometrySnapshot(name, pdf) {
  const file = join(SNAPSHOTS, `${name}.json`);
  const current = { items: await extractItems(pdf), images: await extractImages(pdf) };
  if (process.env.UPDATE_SNAPSHOTS === '1' || !existsSync(file)) writeFileSync(file, `${JSON.stringify(current, null, 1)}\n`);
  assert.deepEqual(current, JSON.parse(readFileSync(file, 'utf8')));
  return current;
}

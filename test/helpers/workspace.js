import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A minimal valid brand.json body (fake values only). */
export function minimalBrand(id = 'acme', extra = {}) {
  return {
    id,
    legalName: 'Acme Events Private Limited',
    shortName: 'Acme',
    addresses: { business: ['1 Example Street', 'Example City 000000'] },
    contacts: { default: { email: 'hello@example.com', phone: '+00 00000 00000', website: 'www.example.com' } },
    ...extra,
  };
}

/**
 * Write a workspace tree into `dir`.
 * @param {string} dir
 * @param {{ workspace?: object, brands?: Record<string, object>, series?: any[], seeds?: object, files?: Record<string, string|Buffer> }} spec
 */
export function writeWorkspace(dir, spec = {}) {
  const workspace = spec.workspace ?? { name: 'Test Workspace', defaultBrand: 'acme' };
  const brands = spec.brands ?? { acme: minimalBrand('acme') };
  writeFileSync(join(dir, 'workspace.json'), JSON.stringify(workspace, null, 2));
  for (const [id, body] of Object.entries(brands)) {
    mkdirSync(join(dir, 'brands', id, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'brands', id, 'brand.json'), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
  if (spec.series !== undefined) writeFileSync(join(dir, 'series.json'), JSON.stringify(spec.series, null, 2));
  if (spec.seeds !== undefined) {
    mkdirSync(join(dir, 'seeds'), { recursive: true });
    writeFileSync(join(dir, 'seeds', 'entities.json'), JSON.stringify(spec.seeds, null, 2));
  }
  for (const [rel, content] of Object.entries(spec.files ?? {})) {
    const p = join(dir, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

/** The numbering series of the shipped example workspace (`workspace.example/series.json`). */
export function exampleSeries() {
  return JSON.parse(readFileSync(new URL('../../workspace.example/series.json', import.meta.url), 'utf8'));
}

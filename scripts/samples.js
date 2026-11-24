#!/usr/bin/env node
// Generates one final (numbered, non-preview) document per built-in template from the fake fixtures in
// test/fixtures/inputs/<id>.json and writes its renditions to samples-out/<id>.{pdf,html,md}.
//
// Usage: npm run samples [-- --home <workspace>] [--out <dir>] [--template <id>]...
//
// The workspace (default: workspace.example) is copied into a fresh temporary folder first, without its data/
// folder, so a real workspace is only read, never written. Each template gets its own database there, so its number
// does not depend on which other templates were generated in the same run. Dates and the PDF creation date are
// pinned, so the same workspace and code give byte-identical files.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initWorkspace } from '../src/workspace/index.js';
import { EXAMPLE_WORKSPACE } from '../src/paths.js';
import { openContext } from '../src/context.js';
import { seedEntities, upsertEntity } from '../src/services/entities.js';
import { listTemplates } from '../src/services/templates.js';
import { generateDocument } from '../src/services/generator.js';
import { readBlob } from '../src/services/blobs.js';

const ROOT = resolve(import.meta.dirname, '..');
export const FIXTURES = join(ROOT, 'test', 'fixtures', 'inputs');
export const BUILTIN_TEMPLATES = join(ROOT, 'src', 'templates');
/** Pinned "today" and PDF creation date, so samples are reproducible. */
export const SAMPLE_TODAY = '2026-07-15';
export const SAMPLE_CREATION_DATE = '2026-07-15T00:00:00Z';
const SAMPLE_USER = 'samples';
/** File in the output folder recording which workspace the samples came from (read by scripts/visual.js). */
export const MANIFEST = 'samples.json';

/** Template ids that ship in src/templates and have a fixture input. */
export function sampleTemplateIds() {
  return readdirSync(BUILTIN_TEMPLATES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(FIXTURES, `${d.name}.json`)))
    .map((d) => d.name)
    .sort();
}

/** Number of pages in a PDF (counts page objects; pdfkit never compresses object dictionaries). */
export function pdfPageCount(buf) {
  return (buf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}

/**
 * Generate the samples.
 * @param {{ home?: string, out?: string, templates?: string[] }} [opts] home: workspace to copy (read only; default the
 *   shipped example); out: output folder (default samples-out); templates: ids (default every built-in with a fixture)
 * @returns {Promise<Array<{ template: string, ok: boolean, number?: string|null, pages?: number, bytes?: number,
 *   sha256?: string, files?: string[], warnings?: object[], error?: string }>>}
 */
export async function generateSamples({ home = EXAMPLE_WORKSPACE, out = join(ROOT, 'samples-out'), templates } = {}) {
  const all = sampleTemplateIds();
  const ids = templates?.length ? templates : all;
  for (const id of ids) if (!all.includes(id)) throw new Error(`unknown template "${id}" (built-ins with a fixture: ${all.join(', ')})`);
  home = resolve(home);
  if (!existsSync(join(home, 'workspace.json'))) throw new Error(`${home} is not a workspace (no workspace.json)`);
  // Example entities (clients, people, engagements, products) that the fixtures name.
  const exampleSeeds = JSON.parse(readFileSync(join(EXAMPLE_WORKSPACE, 'seeds', 'entities.json'), 'utf8'));
  const fixtureEntities = exampleSeeds.entities.filter((e) => ['client', 'person', 'engagement', 'product'].includes(e.kind));

  const tmp = mkdtempSync(join(tmpdir(), 'dossier-samples-'));
  const results = [];
  try {
    const ws = initWorkspace(join(tmp, 'ws'), { from: home });
    // The copy's users get a sample user cleared for everything, so Restricted templates can be generated too.
    const wsFile = join(ws, 'workspace.json');
    const wsJson = JSON.parse(readFileSync(wsFile, 'utf8'));
    wsJson.users = { ...(wsJson.users ?? {}), [SAMPLE_USER]: { clearance: 'Restricted' } };
    writeFileSync(wsFile, JSON.stringify(wsJson, null, 2));
    mkdirSync(out, { recursive: true });

    for (const id of ids) {
      const ctx = openContext({ home: ws, user: SAMPLE_USER, dbFile: join(tmp, `${id}.sqlite`), env: {} });
      try {
        seedEntities(ctx);
        for (const e of fixtureEntities) upsertEntity(ctx, e);
        await listTemplates(ctx);
        const input = JSON.parse(readFileSync(join(FIXTURES, `${id}.json`), 'utf8'));
        const r = await generateDocument(ctx, id, input, { today: SAMPLE_TODAY, creationDate: SAMPLE_CREATION_DATE });
        const files = [];
        let pdf = null;
        for (const rend of r.renditions) {
          const buf = readBlob(ctx, rend.sha256);
          const file = join(out, `${id}.${rend.kind}`);
          writeFileSync(file, buf);
          files.push(file);
          if (rend.kind === 'pdf') pdf = buf;
        }
        results.push({
          template: id,
          ok: true,
          number: r.number,
          pages: pdf ? pdfPageCount(pdf) : 0,
          bytes: pdf?.length ?? 0,
          sha256: pdf ? createHash('sha256').update(pdf).digest('hex') : '',
          files,
          warnings: r.warnings ?? [],
        });
      } catch (err) {
        results.push({ template: id, ok: false, error: err.message });
      } finally {
        ctx.close();
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  writeFileSync(join(out, MANIFEST), `${JSON.stringify({
    exampleWorkspace: home === resolve(EXAMPLE_WORKSPACE),
    today: SAMPLE_TODAY,
    templates: results.map((r) => ({ template: r.template, ok: r.ok, number: r.number ?? null, pages: r.pages ?? null, sha256: r.sha256 ?? null })),
  }, null, 2)}\n`);
  return results;
}

/** Format results as a fixed-width table. */
export function formatTable(results) {
  const rows = [['template', 'number', 'pages', 'pdf bytes', 'sha256', 'notes']];
  for (const r of results) {
    rows.push(r.ok
      ? [r.template, r.number ?? '-', String(r.pages), String(r.bytes), r.sha256.slice(0, 12),
        r.warnings.length ? `${r.warnings.length} warning(s): ${r.warnings.map((w) => w.name).join(', ')}` : '']
      : [r.template, '-', '-', '-', '-', `FAILED: ${r.error}`]);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  return rows.map((row) => row.map((c, i) => (i === row.length - 1 ? c : c.padEnd(widths[i]))).join('  ').trimEnd()).join('\n');
}

/** Parse `--home`, `--out`, `--template` (repeatable). */
export function parseArgs(argv) {
  const opts = { templates: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--home' || a === '--out' || a === '--template') {
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      i++;
      if (a === '--home') opts.home = resolve(v);
      else if (a === '--out') opts.out = resolve(v);
      else opts.templates.push(v);
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    } else {
      throw new Error(`unknown option ${a}`);
    }
  }
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\nusage: npm run samples [-- --home <workspace>] [--out <dir>] [--template <id>]...\n`);
    return 2;
  }
  if (opts.help) {
    process.stdout.write('usage: npm run samples [-- --home <workspace>] [--out <dir>] [--template <id>]...\n');
    return 0;
  }
  const results = await generateSamples(opts);
  process.stdout.write(`${formatTable(results)}\n`);
  const failed = results.filter((r) => !r.ok).length;
  process.stdout.write(`\n${results.length - failed} of ${results.length} generated into ${opts.out ?? join(ROOT, 'samples-out')}\n`);
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    process.stderr.write(`${err.stack ?? err}\n`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
// Visual regression check for the sample documents.
//
// Usage: npm run visual [-- --update] [--samples <dir>] [--baseline <dir>]
//
// Compare (default): renders every samples-out/<template>.pdf page with `pdftoppm -r 72 -png` and compares it with
// test/visual/baseline/<template>-p<N>.png using pixelmatch. Run `npm run samples` first. A page fails when more than
// MAX_DIFF_RATIO of its pixels differ by more than the pixelmatch colour threshold PIXEL_THRESHOLD (anti-aliased
// pixels are ignored), when its size differs, or when the page count differs from the baseline. Diff images of failing
// pages are written to <samples>/visual-diff/.
//
// --update: regenerates the samples from the shipped example workspace (workspace.example) into a temporary folder,
// whatever is in samples-out, and writes the baselines from those, so baselines never contain private workspace data.
//
// When pdftoppm (poppler) is not installed the check is skipped with a message and exit code 0. Set PDFTOPPM to use a
// binary that is not on PATH.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { generateSamples, MANIFEST } from './samples.js';

const ROOT = resolve(import.meta.dirname, '..');
export const BASELINE_DIR = join(ROOT, 'test', 'visual', 'baseline');
export const SAMPLES_DIR = join(ROOT, 'samples-out');
/** pixelmatch per-pixel colour threshold (0..1, smaller is stricter). */
export const PIXEL_THRESHOLD = 0.1;
/** Share of a page's pixels allowed to differ before the page fails (0.1 %). */
export const MAX_DIFF_RATIO = 0.001;
export const DPI = 72;

/** The pdftoppm binary, or null when it cannot be run. */
export function findPdftoppm(env = process.env) {
  const bin = env.PDFTOPPM || 'pdftoppm';
  const r = spawnSync(bin, ['-v'], { encoding: 'utf8' });
  return r.error ? null : bin;
}

/**
 * Render every page of a PDF to PNG buffers (page order).
 * @param {string} bin pdftoppm @param {string} pdf path
 * @returns {Buffer[]}
 */
export function renderPages(bin, pdf) {
  const dir = mkdtempSync(join(tmpdir(), 'dossier-visual-'));
  try {
    const r = spawnSync(bin, ['-r', String(DPI), '-png', pdf, join(dir, 'p')], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`pdftoppm failed on ${pdf}: ${r.stderr || r.error?.message}`);
    const files = readdirSync(dir).filter((f) => f.endsWith('.png'))
      .sort((a, b) => Number(a.match(/(\d+)\.png$/)[1]) - Number(b.match(/(\d+)\.png$/)[1]));
    return files.map((f) => readFileSync(join(dir, f)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Compare two PNG buffers.
 * @returns {{ ok: boolean, diffPixels: number, ratio: number, reason?: string, diff?: Buffer }}
 */
export function comparePng(actualBuf, expectedBuf) {
  const a = PNG.sync.read(actualBuf);
  const e = PNG.sync.read(expectedBuf);
  if (a.width !== e.width || a.height !== e.height) {
    return { ok: false, diffPixels: -1, ratio: 1, reason: `size ${a.width}x${a.height}, baseline ${e.width}x${e.height}` };
  }
  const out = new PNG({ width: a.width, height: a.height });
  const diffPixels = pixelmatch(a.data, e.data, out.data, a.width, a.height, { threshold: PIXEL_THRESHOLD });
  const ratio = diffPixels / (a.width * a.height);
  const ok = ratio <= MAX_DIFF_RATIO;
  return { ok, diffPixels, ratio, ...(ok ? {} : { reason: `${diffPixels} pixels differ (${(ratio * 100).toFixed(3)} %)`, diff: PNG.sync.write(out) }) };
}

const baselineName = (template, page) => `${template}-p${page}.png`;

/**
 * Write baselines for the PDFs in `samples` (removing stale pages of those templates).
 * @returns {Array<{ template: string, pages: number }>}
 */
export function writeBaselines(bin, samples, baseline = BASELINE_DIR) {
  mkdirSync(baseline, { recursive: true });
  const done = [];
  for (const pdf of readdirSync(samples).filter((f) => f.endsWith('.pdf')).sort()) {
    const template = basename(pdf, '.pdf');
    for (const old of readdirSync(baseline).filter((f) => f.startsWith(`${template}-p`) && /^\d+\.png$/.test(f.slice(template.length + 2)))) {
      unlinkSync(join(baseline, old));
    }
    const pages = renderPages(bin, join(samples, pdf));
    pages.forEach((png, i) => writeFileSync(join(baseline, baselineName(template, i + 1)), png));
    done.push({ template, pages: pages.length });
  }
  return done;
}

/**
 * Compare the PDFs in `samples` with the baselines.
 * @returns {Array<{ template: string, page: number|null, ok: boolean, reason?: string, ratio?: number }>}
 */
export function compareSamples(bin, samples = SAMPLES_DIR, baseline = BASELINE_DIR) {
  const results = [];
  const diffDir = join(samples, 'visual-diff');
  rmSync(diffDir, { recursive: true, force: true });
  for (const pdf of readdirSync(samples).filter((f) => f.endsWith('.pdf')).sort()) {
    const template = basename(pdf, '.pdf');
    const pages = renderPages(bin, join(samples, pdf));
    const expected = existsSync(baseline)
      ? readdirSync(baseline).filter((f) => f.startsWith(`${template}-p`) && /^\d+\.png$/.test(f.slice(template.length + 2))).length
      : 0;
    if (expected === 0) {
      results.push({ template, page: null, ok: false, reason: 'no baseline (run npm run visual -- --update)' });
      continue;
    }
    if (expected !== pages.length) results.push({ template, page: null, ok: false, reason: `${pages.length} pages, baseline has ${expected}` });
    pages.forEach((png, i) => {
      const file = join(baseline, baselineName(template, i + 1));
      if (!existsSync(file)) return;
      const r = comparePng(png, readFileSync(file));
      if (r.diff) {
        mkdirSync(diffDir, { recursive: true });
        writeFileSync(join(diffDir, baselineName(template, i + 1)), r.diff);
      }
      results.push({ template, page: i + 1, ok: r.ok, ratio: r.ratio, ...(r.reason ? { reason: r.reason } : {}) });
    });
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  let update = false;
  let samples = SAMPLES_DIR;
  let baseline = BASELINE_DIR;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--update') update = true;
    else if (args[i] === '--samples' && args[i + 1]) samples = resolve(args[++i]);
    else if (args[i] === '--baseline' && args[i + 1]) baseline = resolve(args[++i]);
    else {
      process.stderr.write(`unknown option ${args[i]}\nusage: npm run visual [-- --update] [--samples <dir>] [--baseline <dir>]\n`);
      return 2;
    }
  }
  const bin = findPdftoppm();
  if (!bin) {
    process.stdout.write('visual: pdftoppm not found (install poppler, or set PDFTOPPM); skipping the visual check.\n');
    return 0;
  }

  if (update) {
    const tmp = mkdtempSync(join(tmpdir(), 'dossier-visual-samples-'));
    try {
      const gen = await generateSamples({ out: tmp });
      const failed = gen.filter((r) => !r.ok);
      if (failed.length) {
        for (const f of failed) process.stderr.write(`${f.template}: ${f.error}\n`);
        return 1;
      }
      const done = writeBaselines(bin, tmp, baseline);
      for (const d of done) process.stdout.write(`${d.template}: ${d.pages} page(s)\n`);
      process.stdout.write(`baselines written to ${baseline} (from the example workspace)\n`);
      return 0;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  if (!existsSync(samples) || !readdirSync(samples).some((f) => f.endsWith('.pdf'))) {
    process.stderr.write(`visual: no PDFs in ${samples}; run npm run samples first.\n`);
    return 1;
  }
  const manifestFile = join(samples, MANIFEST);
  if (existsSync(manifestFile) && JSON.parse(readFileSync(manifestFile, 'utf8')).exampleWorkspace === false) {
    process.stdout.write('visual: these samples were generated from a custom workspace; the baselines come from the example workspace, so differences are expected.\n');
  }
  const results = compareSamples(bin, samples, baseline);
  for (const r of results) {
    const where = r.page ? `${r.template} p${r.page}` : r.template;
    process.stdout.write(`${r.ok ? 'ok  ' : 'FAIL'}  ${where}${r.reason ? `  ${r.reason}` : ''}\n`);
  }
  const failed = results.filter((r) => !r.ok).length;
  process.stdout.write(`\n${results.length - failed} of ${results.length} checks passed`
    + `${failed ? `; diff images in ${join(samples, 'visual-diff')}` : ''}\n`);
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    process.stderr.write(`${err.stack ?? err}\n`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
// Organisation-data guard: scans the shipped tree for values that look like real identifiers (Indian GSTIN, CIN, PAN,
// IFSC, bank account numbers, +91 phone numbers) and for the patterns of a private denylist.
//
// Usage: node scripts/org-data-guard.js            (exit 1 and a list of hits when anything is found)
//        DOSSIER_DENYLIST=/path/to/denylist.txt node scripts/org-data-guard.js
//
// The denylist file holds one regular expression per line (case-insensitive; blank lines and lines starting with
// `#` are ignored), for example the names of your organisation, clients and people. Keep it outside the repo.
// test/unit/no-org-data.test.js runs the same scan as part of `npm test`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * What is scanned. docs/DISCOVERY.md and docs/PLAN.md are left out on purpose: they describe the legacy system this
 * app replaces (redacted) and name legacy file and folder conventions.
 */
export const SCAN_PATHS = [
  'src', 'assets', 'workspace.example', 'test', 'scripts', 'README.md',
  'docs/WORKSPACE.md', 'docs/TEMPLATES.md', 'docs/MCP.md', 'docs/DECISIONS.md',
];

const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.ttf', '.otf', '.woff', '.woff2',
  '.sqlite', '.db', '.zip', '.gz', '.p12']);
const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']);
/** Directory names skipped at any depth. */
const SKIP_DIRS = new Set(['node_modules', '.git']);
/** Runtime data folders skipped only at these paths (relative to the scan root, `/`-separated). */
const SKIP_PATHS = new Set(['data', 'workspace.example/data']);

/**
 * The exact fake identifiers the repo uses on purpose (the example workspace and tests).
 * Identifier-shaped matches (GSTIN, CIN, PAN, IFSC) are allowed only when listed here.
 */
export const FAKE_VALUES = new Set([
  'U00000XX2000PTC000000', '00AAAAA0000A0Z0', 'AAAAA0000A', 'EXMP0000000', // example brand (workspace.example)
  '00BBBBB0000B0Z0', '00CCCCC0000C0Z0', // example group entity and client (workspace.example/seeds)
  'EXMP0000001', // second fake bank account (test/integration/settings.test.js)
]);

/** True only for a listed fake identifier. */
export const isFakeId = (m) => FAKE_VALUES.has(m);

/**
 * True for an obvious placeholder number (bank accounts, phones): digits that are all zero except at most one
 * (`000000000001`, `100000000000`, `+00 00000 00000`), or an ascending run `123456789…` padded with zeros
 * (amount-in-words tests).
 * @param {string} m
 */
export function isFakeValue(m) {
  const digits = m.replace(/\D/g, '');
  if (!digits) return false;
  if (digits.replace(/0/g, '').length <= 1) return true;
  const core = digits.replace(/^0+|0+$/g, '');
  return core.length >= 9 && '12345678901234567890'.startsWith(core);
}

/**
 * Built-in patterns (shapes of real Indian identifiers); a match is reported unless `isFakeValue` accepts it.
 * @type {Array<{ id: string, re: RegExp, fake: (m: string) => boolean }>}
 */
export const BUILTIN_PATTERNS = [
  { id: 'gstin', re: /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g, fake: isFakeId },
  { id: 'cin', re: /\b[LU]\d{5}[A-Z]{2}\d{4}(?:PLC|PTC|OPC|NPL|GOI|SGC|FLC|FTC|GAP|GAT|ULL|ULT)\d{6}\b/g, fake: isFakeId },
  { id: 'pan', re: /\b[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]\b/g, fake: isFakeId },
  { id: 'ifsc', re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, fake: isFakeId },
  // 11-18 digits on their own: not part of a decimal or grouped number (`595.28000000000001`), a hex string, an id
  // or a longer run. A `.`, `-` or `_` after a letter still counts as a separator (`A/c No.<digits>`, `acct-<digits>`).
  { id: 'bank-account', re: /(?<!\d[.,_-])(?<![\dA-Za-z/])\d{11,18}(?![\w]|[.,]\d)/g, fake: isFakeValue },
  { id: 'phone-in', re: /\+91[\s-]*\d(?:[\s-]*\d){9}/g, fake: isFakeValue },
];

/**
 * Read a denylist file: one regex per line, case-insensitive; `#` comments and blank lines ignored.
 * @param {string} file
 * @returns {Array<{ id: string, re: RegExp, fake: () => false }>}
 */
export function loadDenylist(file) {
  return readFileSync(file, 'utf8').split(/\r?\n/).map((l, i) => ({ l: l.trim(), line: i + 1 }))
    .filter(({ l }) => l && !l.startsWith('#'))
    .map(({ l, line }) => {
      try {
        return { id: `denylist:${line}`, re: new RegExp(l, 'gi'), fake: () => false };
      } catch (err) {
        throw new Error(`${file}: line ${line} is not a valid regular expression: ${err.message}`);
      }
    });
}

function isBinary(buf) {
  return buf.subarray(0, 8192).includes(0);
}

function* walk(abs, root) {
  const st = statSync(abs);
  if (st.isFile()) {
    yield abs;
    return;
  }
  if (!st.isDirectory() || SKIP_PATHS.has(relative(root, abs).split(sep).join('/'))) return;
  for (const d of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = join(abs, d.name);
    if (d.isDirectory() && (SKIP_DIRS.has(d.name) || SKIP_PATHS.has(relative(root, child).split(sep).join('/')))) continue;
    if (d.isSymbolicLink()) continue;
    yield* walk(child, root);
  }
}

/**
 * Scan files for the patterns.
 * @param {{ root?: string, paths?: string[], denylist?: string|null, patterns?: typeof BUILTIN_PATTERNS }} [opts]
 *   denylist: a denylist file path (default `DOSSIER_DENYLIST`); paths relative to root (default SCAN_PATHS)
 * @returns {{ files: number, hits: Array<{ file: string, line: number, pattern: string, match: string }> }}
 */
export function scanTree({ root = ROOT, paths = SCAN_PATHS, denylist = process.env.DOSSIER_DENYLIST || null, patterns = BUILTIN_PATTERNS } = {}) {
  const all = [...patterns, ...(denylist ? loadDenylist(denylist) : [])];
  const skipFile = denylist ? resolve(denylist) : null;
  const hits = [];
  let files = 0;
  for (const p of paths) {
    const abs = resolve(root, p);
    if (!existsSync(abs)) continue;
    for (const file of walk(abs, resolve(root))) {
      const name = file.split(sep).at(-1);
      if (file === skipFile || LOCKFILES.has(name) || BINARY_EXT.has(extname(name).toLowerCase())) continue;
      const buf = readFileSync(file);
      if (isBinary(buf)) continue;
      files++;
      const lines = buf.toString('utf8').split('\n');
      lines.forEach((text, i) => {
        for (const { id, re, fake } of all) {
          re.lastIndex = 0;
          for (const m of text.matchAll(re)) {
            if (!fake(m[0])) hits.push({ file: relative(root, file), line: i + 1, pattern: id, match: m[0] });
          }
        }
      });
    }
  }
  return { files, hits };
}

/** One line per hit. */
export const formatHits = (hits) => hits.map((h) => `${h.file}:${h.line}  ${h.pattern}  ${h.match}`).join('\n');

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { files, hits } = scanTree();
  if (hits.length) {
    process.stdout.write(`${formatHits(hits)}\n\n${hits.length} possible organisation data hit(s) in ${files} files\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`no organisation data found in ${files} files\n`);
  }
}

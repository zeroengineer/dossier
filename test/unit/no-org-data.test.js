// Organisation-data guard (scripts/org-data-guard.js): the shipped tree holds no real identifiers or names.
// Set DOSSIER_DENYLIST to a file of regular expressions (one per line, case-insensitive) to also check your own
// organisation's names; keep that file outside the repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatHits, isFakeValue, loadDenylist, scanTree, SCAN_PATHS } from '../../scripts/org-data-guard.js';
import { tmpDir } from '../helpers/tmp.js';

test('the repository holds no organisation data', () => {
  const { files, hits } = scanTree();
  assert.ok(files > 100, `scanned ${files} files`);
  assert.equal(hits.length, 0, `possible organisation data:\n${formatHits(hits)}`);
});

test('the scan covers the shipped code, example workspace, tests, scripts and user docs, not the legacy notes', () => {
  for (const p of ['src', 'assets', 'workspace.example', 'test', 'scripts', 'README.md', 'docs/TEMPLATES.md', 'docs/WORKSPACE.md', 'docs/MCP.md', 'docs/DECISIONS.md']) {
    assert.ok(SCAN_PATHS.includes(p), p);
  }
  assert.equal(SCAN_PATHS.includes('docs/DISCOVERY.md'), false);
  assert.equal(SCAN_PATHS.includes('docs/PLAN.md'), false);
});

// Real-looking values are assembled at run time so this file itself never matches.
const planted = {
  gstin: ['27', 'ABCDE', '5821', 'F1Z5'].join(''),
  cin: ['U7', '4999', 'MH', '2019', 'PTC', '123456'].join(''),
  pan: ['ABC', 'PE', '5821', 'F'].join(''),
  ifsc: ['ABCD', '0', '001234'].join(''),
  account: ['5010', '0234', '5678', '91'].join(''),
  phone: ['+9', '1 98765 43210'].join(''),
};

test('detects planted identifiers, a denylist name, and skips binaries, lockfiles and the fake values', () => {
  const { dir, cleanup } = tmpDir();
  try {
    mkdirSync(join(dir, 'src', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'src', 'deep', 'brand.json'), [
      `{ "gstin": "${planted.gstin}", "cin": "${planted.cin}",`,
      `  "pan": "${planted.pan}", "ifsc": "${planted.ifsc}",`,
      `  "account": "${planted.account}", "phone": "${planted.phone}" }`,
    ].join('\n'));
    writeFileSync(join(dir, 'src', 'fake.json'), JSON.stringify({
      gstin: '00AAAAA0000A0Z0', cin: 'U00000XX2000PTC000000', ifsc: 'EXMP0000000', account: '000000000000',
      phone: '+00 00000 00000', width: 595.2800000000001, sha: 'ab12345678901234cd', amount: 12345678900,
    }));
    writeFileSync(join(dir, 'README.md'), 'Built for Globex Corporation.\n');
    writeFileSync(join(dir, 'src', 'image.bin'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(planted.gstin)]));
    writeFileSync(join(dir, 'src', 'logo.png'), planted.gstin);
    writeFileSync(join(dir, 'src', 'package-lock.json'), planted.account);
    const denylist = join(dir, 'denylist.txt');
    writeFileSync(denylist, '# private names\n\nglobex\n');

    const { hits } = scanTree({ root: dir, paths: ['src', 'README.md'], denylist });
    const got = hits.map((h) => `${h.file}:${h.line} ${h.pattern} ${h.match}`).sort();
    assert.deepEqual(got, [
      `README.md:1 denylist:1 Globex`,
      `${join('src', 'deep', 'brand.json')}:1 cin ${planted.cin}`,
      `${join('src', 'deep', 'brand.json')}:1 gstin ${planted.gstin}`,
      `${join('src', 'deep', 'brand.json')}:2 ifsc ${planted.ifsc}`,
      `${join('src', 'deep', 'brand.json')}:2 pan ${planted.pan}`,
      `${join('src', 'deep', 'brand.json')}:3 bank-account ${planted.account}`,
      `${join('src', 'deep', 'brand.json')}:3 phone-in ${planted.phone}`,
    ].sort());
    // Without the denylist only the built-in patterns apply.
    assert.equal(scanTree({ root: dir, paths: ['README.md'], denylist: null }).hits.length, 0);
  } finally {
    cleanup();
  }
});

test('denylist lines are case-insensitive regular expressions; a bad line names its line number', () => {
  const { dir, cleanup } = tmpDir();
  try {
    const file = join(dir, 'deny.txt');
    writeFileSync(file, 'acme\\s+widgets\n# comment\n');
    const [p] = loadDenylist(file);
    assert.ok(p.re.test('ACME   Widgets'));
    writeFileSync(file, 'ok\n(unclosed\n');
    assert.throws(() => loadDenylist(file), /line 2 is not a valid regular expression/);
  } finally {
    cleanup();
  }
});

test('isFakeValue accepts only obvious placeholders', () => {
  for (const v of ['00AAAAA0000A0Z0', 'U00000XX2000PTC000000', '000000000001', '100000000000', '1234567890123']) assert.ok(isFakeValue(v), v);
  for (const v of Object.values(planted)) assert.equal(isFakeValue(v), false, v);
});

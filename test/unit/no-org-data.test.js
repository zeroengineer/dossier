// Organisation-data guard (scripts/org-data-guard.js): the shipped tree holds no real identifiers or names.
// Set DOSSIER_DENYLIST to a file of regular expressions (one per line, case-insensitive) to also check your own
// organisation's names; keep that file outside the repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EMAIL_DOMAIN_ALLOW, formatHits, isExampleEmail, isFakeId, isFakeValue, loadDenylist, scanTree, SCAN_PATHS } from '../../scripts/org-data-guard.js';
import { tmpDir } from '../helpers/tmp.js';

test('the repository holds no organisation data', () => {
  const { files, hits } = scanTree();
  assert.ok(files > 100, `scanned ${files} files`);
  assert.equal(hits.length, 0, `possible organisation data:\n${formatHits(hits)}`);
});

test('the scan covers the shipped code, example workspace, tests, scripts, bin, package.json and every doc', () => {
  for (const p of ['src', 'assets', 'workspace.example', 'test', 'scripts', 'bin', 'docs', 'README.md', 'package.json']) {
    assert.ok(SCAN_PATHS.includes(p), p);
  }
});

test('e-mail addresses are reported unless their domain is a reserved example domain', () => {
  const { dir, cleanup } = tmpDir();
  try {
    mkdirSync(join(dir, 'bin'), { recursive: true });
    const real = ['hr', 'globex.co.in'].join('@');
    writeFileSync(join(dir, 'bin', 'tool.js'), [
      `// contact ${real}`,
      '// ok: a@example.com, b.c@mail.example.org, d@example.net, "@fastify/static", user@localhost',
    ].join('\n'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ author: ['dev', 'globex.com'].join('@') }));
    const got = scanTree({ root: dir, paths: ['bin', 'package.json'], denylist: null }).hits
      .map((h) => `${h.file}:${h.line} ${h.pattern} ${h.match}`).sort();
    assert.deepEqual(got, [
      `${join('bin', 'tool.js')}:1 email ${real}`,
      `package.json:1 email ${['dev', 'globex.com'].join('@')}`,
    ]);
    for (const ok of ['a@example.com', 'x@sub.example.net', 'Y@EXAMPLE.ORG']) assert.ok(isExampleEmail(ok), ok);
    for (const bad of [['a', 'example.co'], ['a', 'notexample.com'], ['a', 'example.com.evil.in']].map((p) => p.join('@'))) assert.equal(isExampleEmail(bad), false, bad);
    assert.deepEqual(EMAIL_DOMAIN_ALLOW, ['example.com', 'example.org', 'example.net']);
  } finally {
    cleanup();
  }
});

// Real-looking values are assembled at run time so this file itself never matches.
const planted = {
  gstin: ['27', 'ABCDE', '5821', 'F1Z5'].join(''),
  cin: ['U7', '4999', 'MH', '2019', 'PTC', '123456'].join(''),
  pan: ['ABC', 'PE', '5821', 'F'].join(''),
  ifsc: ['ABCD', '0', '001234'].join(''),
  account: ['5010', '0234', '5678', '91'].join(''),
  accountNo: ['A/c No.', '5020', '0012', '3456', '78'].join(''),
  accountDash: ['acct-', '6020', '0012', '3456', '79'].join(''),
  accountUnderscore: ['acct_', '7020', '0012', '3456', '71'].join(''),
  nearZeroGstin: ['07', 'ABCDE', '0000', 'F0Z0'].join(''),
  phone: ['+9', '1 98765 43210'].join(''),
};

test('detects planted identifiers, a denylist name, and skips binaries, lockfiles and the fake values', () => {
  const { dir, cleanup } = tmpDir();
  try {
    mkdirSync(join(dir, 'src', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'src', 'deep', 'brand.json'), [
      `{ "gstin": "${planted.gstin}", "cin": "${planted.cin}",`,
      `  "pan": "${planted.pan}", "ifsc": "${planted.ifsc}",`,
      `  "account": "${planted.account}", "phone": "${planted.phone}",`,
      `  "notes": "${planted.accountNo}; ${planted.accountDash}; ${planted.accountUnderscore}",`,
      `  "gstin2": "${planted.nearZeroGstin}" }`,
    ].join('\n'));
    writeFileSync(join(dir, 'src', 'fake.json'), JSON.stringify({
      gstin: '00AAAAA0000A0Z0', cin: 'U00000XX2000PTC000000', ifsc: 'EXMP0000000', account: '000000000000',
      phone: '+00 00000 00000', width: 595.2800000000001, sha: 'ab12345678901234cd', amount: 12345678900,
    }));
    writeFileSync(join(dir, 'README.md'), 'Built for Globex Corporation.\n');
    writeFileSync(join(dir, 'src', 'image.bin'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(planted.gstin)]));
    writeFileSync(join(dir, 'src', 'logo.png'), planted.gstin);
    writeFileSync(join(dir, 'src', 'package-lock.json'), planted.account);
    // Runtime data is skipped only at the top level and in workspace.example/data; a nested "data" folder is scanned.
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'notes.txt'), planted.gstin);
    mkdirSync(join(dir, 'workspace.example', 'data'), { recursive: true });
    writeFileSync(join(dir, 'workspace.example', 'data', 'notes.txt'), planted.gstin);
    mkdirSync(join(dir, 'src', 'data'), { recursive: true });
    writeFileSync(join(dir, 'src', 'data', 'notes.txt'), planted.pan);
    const denylist = join(dir, 'denylist.txt');
    writeFileSync(denylist, '# private names\n\nglobex\n');

    const { hits } = scanTree({ root: dir, paths: ['src', 'README.md', 'data', 'workspace.example'], denylist });
    const got = hits.map((h) => `${h.file}:${h.line} ${h.pattern} ${h.match}`).sort();
    assert.deepEqual(got, [
      `README.md:1 denylist:3 Globex`,
      `${join('src', 'data', 'notes.txt')}:1 pan ${planted.pan}`,
      `${join('src', 'deep', 'brand.json')}:1 cin ${planted.cin}`,
      `${join('src', 'deep', 'brand.json')}:1 gstin ${planted.gstin}`,
      `${join('src', 'deep', 'brand.json')}:2 ifsc ${planted.ifsc}`,
      `${join('src', 'deep', 'brand.json')}:2 pan ${planted.pan}`,
      `${join('src', 'deep', 'brand.json')}:3 bank-account ${planted.account}`,
      `${join('src', 'deep', 'brand.json')}:3 phone-in ${planted.phone}`,
      `${join('src', 'deep', 'brand.json')}:4 bank-account ${planted.accountNo.slice(-14)}`,
      `${join('src', 'deep', 'brand.json')}:4 bank-account ${planted.accountDash.slice(-14)}`,
      `${join('src', 'deep', 'brand.json')}:4 bank-account ${planted.accountUnderscore.slice(-14)}`,
      `${join('src', 'deep', 'brand.json')}:5 gstin ${planted.nearZeroGstin}`,
    ].sort());
    // Without the denylist only the built-in patterns apply.
    assert.equal(scanTree({ root: dir, paths: ['README.md'], denylist: null }).hits.length, 0);
  } finally {
    cleanup();
  }
});

test('denylist lines are case-insensitive regular expressions named by their file line; a bad line names its line', () => {
  const { dir, cleanup } = tmpDir();
  try {
    const file = join(dir, 'deny.txt');
    writeFileSync(file, '# private names\n\nacme\\s+widgets\n# comment\n\nglobex\n');
    const [p, q] = loadDenylist(file);
    assert.ok(p.re.test('ACME   Widgets'));
    assert.deepEqual([p.id, q.id], ['denylist:3', 'denylist:6']);
    writeFileSync(file, '# comment\n\nok\n(unclosed\n');
    assert.throws(() => loadDenylist(file), /line 4 is not a valid regular expression/);
  } finally {
    cleanup();
  }
});

test('fake identifiers must be listed exactly; the near-zero heuristic is for numbers only', () => {
  for (const v of ['00AAAAA0000A0Z0', 'U00000XX2000PTC000000', 'AAAAA0000A', 'EXMP0000000']) assert.ok(isFakeId(v), v);
  assert.equal(isFakeId(planted.nearZeroGstin), false);
  for (const v of ['000000000001', '100000000000', '1234567890123', '+00 00000 00000']) assert.ok(isFakeValue(v), v);
  for (const v of [planted.account, planted.phone, planted.accountNo, planted.accountDash]) assert.equal(isFakeValue(v), false, v);
});

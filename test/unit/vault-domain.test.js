import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUSES, TRANSITIONS, assertTransition, canTransition } from '../../src/domain/status.js';
import { LEVELS, accessibleLevels, assertAccess, canAccess } from '../../src/domain/sensitivity.js';
import { displayFileName, slugSegment } from '../../src/domain/naming.js';
import { secretReason } from '../../src/domain/secrets.js';

const code = (c) => (err) => err?.name === 'DossierError' && err.code === c;

test('status transitions follow the lifecycle table', () => {
  const allowed = {
    Draft: ['Sent', 'Signed', 'Superseded'],
    Sent: ['Signed', 'Paid', 'Superseded'],
    Signed: ['Paid', 'Superseded'],
    Paid: ['Superseded'],
    Superseded: [],
  };
  assert.deepEqual(STATUSES, ['Draft', 'Sent', 'Signed', 'Paid', 'Superseded']);
  for (const from of STATUSES) {
    assert.deepEqual([...TRANSITIONS[from]], allowed[from]);
    for (const to of STATUSES) {
      const ok = allowed[from].includes(to);
      assert.equal(canTransition(from, to), ok, `${from} -> ${to}`);
      if (ok) assertTransition(from, to);
      else assert.throws(() => assertTransition(from, to), code('INVALID_STATUS_TRANSITION'), `${from} -> ${to}`);
    }
  }
  assert.throws(() => assertTransition('Draft', 'Archived'), code('INVALID_INPUT'));
  assert.throws(() => assertTransition('toString', 'Sent'), code('INVALID_INPUT'));
});

test('sensitivity levels are ordered and gate access', () => {
  assert.deepEqual(LEVELS, ['Public', 'Internal', 'Confidential', 'Restricted']);
  assert.equal(canAccess('Internal', 'Public'), true);
  assert.equal(canAccess('Internal', 'Internal'), true);
  assert.equal(canAccess('Internal', 'Confidential'), false);
  assert.equal(canAccess('Restricted', 'Restricted'), true);
  assert.equal(canAccess('Bogus', 'Public'), false);
  assert.equal(canAccess('Restricted', 'Bogus'), false);
  assert.deepEqual(accessibleLevels('Confidential'), ['Public', 'Internal', 'Confidential']);
  const ctx = { user: { id: 'tester', clearance: 'Internal' } };
  assertAccess(ctx, { id: 'DOC-000001', sensitivity: 'Internal' });
  assert.throws(() => assertAccess(ctx, { id: 'DOC-000002', sensitivity: 'Restricted' }), code('FORBIDDEN'));
});

test('displayFileName builds <date>_<party>_<Type>_<number>_v<version>.<ext> with safe segments', () => {
  assert.equal(
    displayFileName({ date: '2026-07-14', partyName: 'Demo Retail LLP', type: 'Invoice', number: 'ACME-2026-0133', version: 2, ext: 'pdf' }),
    '2026-07-14_DemoRetailLLP_Invoice_ACME-2026-0133_v2.pdf',
  );
  assert.equal(
    displayFileName({ date: '2026-01-02', partyName: 'Café Ünïcode & Co., Pvt. Ltd.', type: 'Debit Note', number: 'A/2026/01', version: 1, ext: '.PDF' }),
    '2026-01-02_CafeUnicodeCoPvtLtd_DebitNote_A-2026-01_v1.pdf',
  );
  assert.equal(displayFileName({ date: null, partyName: null, type: 'Letter', number: null, version: 1, ext: 'md' }), 'Letter_v1.md');
  assert.equal(displayFileName({ ext: 'html' }), 'document.html');
  assert.equal(slugSegment(' ../etc/passwd '), 'etc-passwd');
  assert.equal(slugSegment('a__b  c'), 'a-bc');
});

test('secretReason flags key files and key material, and passes ordinary files', () => {
  assert.match(secretReason({ filename: 'server.pem', buffer: Buffer.from('x') }), /\.pem/);
  assert.match(secretReason({ filename: 'id.KEY', buffer: Buffer.from('x') }), /\.key/);
  assert.match(secretReason({ filename: 'prod.env', buffer: Buffer.from('x') }), /\.env/);
  assert.match(secretReason({ filename: '.env', buffer: Buffer.from('A=1') }), /environment/);
  assert.match(secretReason({ filename: '.env.local', buffer: Buffer.from('A=1') }), /environment/);
  assert.match(secretReason({ filename: 'notes.txt', buffer: Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----') }), /BEGIN/);
  assert.match(secretReason({ filename: 'notes.txt', buffer: Buffer.from('ssh-rsa PRIVATE KEY') }), /PRIVATE KEY/);
  assert.match(secretReason({ filename: 'scan.pdf', buffer: Buffer.from('%PDF'), text: 'my PRIVATE KEY is' }), /PRIVATE KEY/);
  assert.equal(secretReason({ filename: 'invoice.pdf', buffer: Buffer.from('%PDF-1.7 hello') }), null);
  assert.equal(secretReason({ filename: 'keynote.md', buffer: Buffer.from('# Keynote') }), null);
});

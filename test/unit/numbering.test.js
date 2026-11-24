import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatNumber, parseNumber, patternToRegex, scopeKey, financialYear, sanitiseCode, patternTokens,
} from '../../src/domain/numbering.js';

const code = (c) => (err) => err?.name === 'DossierError' && err.code === c;
const series = (pattern, scope = 'brand+year', id = 's', counter = id) => ({ id, pattern, scope, start: 1, counter });

test('formatNumber fills date tokens from a date string', () => {
  const vars = { date: '2026-03-15', seq: 7 };
  assert.equal(formatNumber('{YYYY}|{YY}|{MM}|{FY}|{###}', vars), '2026|26|03|2025-26|007');
  assert.equal(formatNumber('{FY}/{#}', { date: '2026-04-01', seq: 1 }), '2026-27/1');
  assert.equal(formatNumber('{FY}/{#}', { date: '2026-03-31', seq: 1 }), '2025-26/1');
  assert.equal(formatNumber('{FY}/{#}', { date: '2099-12-01', seq: 1 }), '2099-00/1');
});

test('formatNumber accepts a Date and explicit year / fy / month vars', () => {
  assert.equal(formatNumber('{YYYY}-{MM}-{#}', { date: new Date(2027, 0, 5), seq: 3 }), '2027-01-3');
  assert.equal(formatNumber('{YYYY}/{FY}/{MM}/{##}', { year: 2030, fy: '2029-30', month: 2, seq: 4 }), '2030/2029-30/02/04');
});

test('formatNumber pads counters to the number of # and never truncates', () => {
  assert.equal(formatNumber('{#}', { seq: 5 }), '5');
  assert.equal(formatNumber('{##}', { seq: 5 }), '05');
  assert.equal(formatNumber('{####}', { seq: 42 }), '0042');
  assert.equal(formatNumber('{###}', { seq: 12345 }), '12345');
  assert.equal(formatNumber('X{###}', { seq: 0 }), 'X000');
});

test('formatNumber uppercases and sanitises CLIENT, CODE and BRAND', () => {
  const vars = { date: '2026-05-01', seq: 1, client: 'demo retail_llp', code: 'ab.c/d', brand: 'acme' };
  assert.equal(formatNumber('{BRAND}/{CLIENT}/{CODE}/{#}', vars), 'ACME/DEMO-RETAIL-LLP/ABCD/1');
  assert.equal(sanitiseCode('  --x  y--  '), 'X-Y');
  assert.equal(sanitiseCode('é!'), '');
});

test('formatNumber keeps literal text and rejects unknown tokens and bad patterns', () => {
  assert.equal(formatNumber('ACM/HR/{YYYY}/EXP-{###}', { date: '2026-01-01', seq: 9 }), 'ACM/HR/2026/EXP-009');
  assert.throws(() => formatNumber('X-{PREFIX}-{#}', { seq: 1 }), code('SERIES_PATTERN_INVALID'));
  assert.throws(() => formatNumber('X-{YYYY}', { date: '2026-01-01', seq: 1 }), code('SERIES_PATTERN_INVALID'));
  assert.throws(() => formatNumber('{#}-{##}', { seq: 1 }), code('SERIES_PATTERN_INVALID'));
});

test('formatNumber reports missing vars as NUMBER_VAR_MISSING', () => {
  assert.throws(() => formatNumber('{CLIENT}-{#}', { seq: 1 }), code('NUMBER_VAR_MISSING'));
  assert.throws(() => formatNumber('{CODE}-{#}', { seq: 1, code: '***' }), code('NUMBER_VAR_MISSING'));
  assert.throws(() => formatNumber('{YYYY}-{#}', { seq: 1 }), code('NUMBER_VAR_MISSING'));
  assert.throws(() => formatNumber('{#}', {}), code('NUMBER_VAR_MISSING'));
  assert.throws(() => formatNumber('{YYYY}-{#}', { seq: 1, date: 'nope' }), code('INVALID_INPUT'));
});

test('patternTokens lists tokens in order', () => {
  assert.deepEqual(patternTokens('A-{YYYY}-{CODE}-{##}').filter((t) => t.token).map((t) => t.token), ['YYYY', 'CODE', '#']);
});

test('financialYear is April to March', () => {
  assert.equal(financialYear(2026, 4), '2026-27');
  assert.equal(financialYear(2026, 3), '2025-26');
});

test('patternToRegex escapes literals and anchors the match', () => {
  const re = patternToRegex('ACM.{YYYY}+{##}');
  assert.ok(re.test('ACM.2026+01'));
  assert.ok(!re.test('ACMx2026+01'));
  assert.ok(!re.test('xACM.2026+01'));
});

test('parseNumber round-trips every token', () => {
  const cases = [
    ['ACM-{YYYY}-{####}', { date: '2026-06-01', seq: 12 }],
    ['ACM-Q-{CODE}-{YYYY}-{##}', { date: '2026-06-01', seq: 3, code: 'AB-CD' }],
    ['FSS/{CLIENT}/{YYYY}/{###}', { date: '2026-06-01', seq: 120, client: 'DRL' }],
    ['{BRAND}/{FY}/{MM}/{YY}-{#}', { date: '2026-02-01', seq: 1, brand: 'ACME' }],
  ];
  for (const [pattern, vars] of cases) {
    const number = formatNumber(pattern, vars);
    const parsed = parseNumber(pattern, number);
    assert.ok(parsed, `${pattern} parses ${number}`);
    assert.equal(parsed.seq, vars.seq);
    assert.equal(formatNumber(pattern, parsed), number);
  }
  assert.deepEqual(parseNumber('FSS/{CLIENT}/{YYYY}/{###}', 'FSS/DRL/2026/120'), { client: 'DRL', year: 2026, seq: 120 });
  assert.deepEqual(parseNumber('{FY}-{##}', '2025-26-07'), { fy: '2025-26', seq: 7 });
  assert.deepEqual(parseNumber('{YY}-{##}', '26-07'), { year: 2026, seq: 7 });
  assert.equal(parseNumber('ACM-{###}', 'ACM-12345').seq, 12345);
});

test('parseNumber returns null for numbers that do not match', () => {
  assert.equal(parseNumber('ACM-{YYYY}-{####}', 'ACM-2026-12'), null);
  assert.equal(parseNumber('ACM-{YYYY}-{####}', 'ACM-DN-2026-0001'), null);
  assert.equal(parseNumber('{FY}-{#}', '2025-27-1'), null);
  assert.equal(parseNumber('{MM}-{#}', '13-1'), null);
  assert.equal(parseNumber('{YYYY}-{YY}-{#}', '2026-27-1'), null);
  assert.equal(parseNumber('{#}', 42), null);
});

test('scopeKey follows scope and shared counter id', () => {
  const vars = { date: '2026-05-01', brand: 'acme', client: 'Demo Retail' };
  assert.equal(scopeKey(series('{#}', 'global'), vars), 'num:s');
  assert.equal(scopeKey(series('{#}', 'brand'), vars), 'num:s:ACME');
  assert.equal(scopeKey(series('{YYYY}-{#}'), vars), 'num:s:ACME:2026');
  assert.equal(scopeKey(series('{YYYY}-{#}', 'brand+year+client'), vars), 'num:s:ACME:2026:DEMO-RETAIL');
  assert.equal(scopeKey(series('{CODE}-{YYYY}-{#}', 'brand+year+code'), { ...vars, code: 'exc 26' }), 'num:s:ACME:2026:C=EXC-26');
  assert.throws(() => scopeKey(series('{#}', 'brand+year+code'), { brand: 'acme', year: 2026 }), code('NUMBER_VAR_MISSING'));
  assert.throws(() => scopeKey(series('{#}', 'brand+day'), vars), code('INVALID_INPUT'));
  assert.equal(scopeKey(series('DN-{YYYY}-{#}', 'brand+year', 'dn', 'inv'), vars), 'num:inv:ACME:2026');
});

test('scopeKey year: YYYY, else FY, else calendar year of the date', () => {
  const vars = { date: '2026-02-01', brand: 'acme' };
  assert.equal(scopeKey(series('{YYYY}/{FY}-{#}'), vars), 'num:s:ACME:2026');
  assert.equal(scopeKey(series('{FY}-{#}'), vars), 'num:s:ACME:FY2025-26');
  assert.equal(scopeKey(series('X-{#}'), vars), 'num:s:ACME:2026');
  assert.equal(scopeKey(series('{FY}-{#}'), { fy: '2025-26', brand: 'acme' }), 'num:s:ACME:FY2025-26');
  assert.equal(scopeKey(series('{YY}-{#}'), { year: 2026, brand: 'acme' }), 'num:s:ACME:2026');
});

test('scopeKey requires the vars its scope uses', () => {
  assert.throws(() => scopeKey(series('{#}', 'brand'), {}), code('NUMBER_VAR_MISSING'));
  assert.throws(() => scopeKey(series('{#}'), { brand: 'acme' }), code('NUMBER_VAR_MISSING'));
  assert.throws(() => scopeKey(series('{#}', 'brand+year+client'), { brand: 'acme', year: 2026 }), code('NUMBER_VAR_MISSING'));
  assert.equal(scopeKey(series('{#}', 'global'), {}), 'num:s');
});

test('dates with impossible days are INVALID_INPUT', () => {
  for (const date of ['2026-02-31', '2026-04-31', '2026-01-00', '2025-02-29']) {
    assert.throws(() => formatNumber('{YYYY}-{#}', { date, seq: 1 }), code('INVALID_INPUT'), date);
  }
  assert.equal(formatNumber('{YYYY}-{#}', { date: '2024-02-29', seq: 1 }), '2024-1');
  assert.equal(formatNumber('{YYYY}-{#}', { date: '2026-12-31', seq: 1 }), '2026-1');
});

test('an explicit fy must look like 2026-27 with consecutive years', () => {
  const fySeries = series('{FY}-{#}');
  for (const fy of ['2026-28', '2026', '26-27', '2026-2027', 2026]) {
    assert.throws(() => scopeKey(fySeries, { fy, brand: 'acme' }), code('INVALID_INPUT'), String(fy));
    assert.throws(() => formatNumber('{FY}-{#}', { fy, seq: 1 }), code('INVALID_INPUT'), String(fy));
  }
  assert.equal(scopeKey(fySeries, { fy: '2099-00', brand: 'acme' }), 'num:s:ACME:FY2099-00');
});

test('parseNumber: adjacent hyphenated code tokens resolve greedily', () => {
  assert.deepEqual(parseNumber('{CLIENT}-{CODE}-{#}', 'A-B-C-1'), { client: 'A-B', code: 'C', seq: 1 });
});

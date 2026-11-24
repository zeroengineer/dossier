import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillMarkdown } from '../../src/render/md/fill.js';

test('{{path}} fills dotted paths, numbers and booleans; no HTML escaping', () => {
  const r = fillMarkdown('To {{client.name}} <{{client.email}}>, amount {{amount}} ({{ok}}) & {{tags}}', {
    client: { name: 'A & B <Co>', email: 'x@example.com' }, amount: 1200, ok: true, tags: ['a', 'b'],
  });
  assert.equal(r.text, 'To A & B <Co> <x@example.com>, amount 1200 (true) & a, b');
  assert.deepEqual(r.missing, []);
});

test('missing paths render empty and are reported once each', () => {
  const r = fillMarkdown('{{a}}-{{b.c}}-{{a}}-{{d}}', { d: null });
  assert.equal(r.text, '---');
  assert.deepEqual(r.missing, ['a', 'b.c', 'd']);
});

test('{{#each}} with this, this.x, @index and @index1; standalone tags drop their line', () => {
  const body = '# Items\n{{#each items}}\n{{@index1}}. {{this.name}} x{{qty}} [{{@index}}]\n{{/each}}\n{{#each tags}}- {{this}}\n{{/each}}end\n';
  const r = fillMarkdown(body, { qty: 9, items: [{ name: 'Tea', qty: 2 }, { name: 'Cake' }], tags: ['red', 'blue'] });
  assert.equal(r.text, '# Items\n1. Tea x2 [0]\n2. Cake x9 [1]\n- red\n- blue\nend\n');
  assert.deepEqual(r.missing, []);
});

test('missing item fields report the indexed path; a missing list is reported', () => {
  const r = fillMarkdown('{{#each items}}{{this.name}};{{/each}}{{#each nope}}x{{/each}}', { items: [{ name: 'a' }, {}] });
  assert.equal(r.text, 'a;;');
  assert.deepEqual(r.missing, ['items.1.name', 'nope']);
});

test('{{#if}} / {{else}}: empty strings, zero, empty lists and objects are false; ifs nest with each', () => {
  const body = '{{#if a}}A{{else}}not A{{/if}}|{{#if list}}{{#each list}}{{this}}{{/each}}{{else}}none{{/if}}|{{#if obj}}O{{/if}}|{{#if zero}}Z{{else}}0{{/if}}';
  assert.equal(fillMarkdown(body, { a: '', list: [], obj: {}, zero: 0 }).text, 'not A|none||0');
  assert.equal(fillMarkdown(body, { a: 'y', list: [1, 2], obj: { k: 1 }, zero: 5 }).text, 'A|12|O|Z');
  assert.deepEqual(fillMarkdown('{{#if missing}}x{{/if}}', {}).missing, [], 'conditions are not reported');
});

test('nested each resolves names against the innermost item first, then outer scopes', () => {
  const body = '{{#each groups}}{{name}}:{{#each members}}{{name}}@{{org}},{{/each}};{{/each}}';
  const r = fillMarkdown(body, { org: 'acme', groups: [{ name: 'G1', members: [{ name: 'm1' }, { name: 'm2', org: 'other' }] }] });
  assert.equal(r.text, 'G1:m1@acme,m2@other,;');
});

test('syntax errors throw TEMPLATE_SYNTAX with the line number', () => {
  const syntax = (re) => (e) => e.code === 'TEMPLATE_SYNTAX' && re.test(e.message);
  assert.throws(() => fillMarkdown('a\n{{#each items}}\nx'), syntax(/line 2: \{\{#each\}\} is never closed/));
  assert.throws(() => fillMarkdown('{{/if}}'), syntax(/without a matching/));
  assert.throws(() => fillMarkdown('{{#each a}}{{/if}}'), syntax(/without a matching/));
  assert.throws(() => fillMarkdown('{{else}}'), syntax(/outside/));
  assert.throws(() => fillMarkdown('{{> partial}}'), syntax(/unsupported tag/));
});

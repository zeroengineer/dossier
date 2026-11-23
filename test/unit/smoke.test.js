import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

test('node:sqlite with FTS5 is available', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE VIRTUAL TABLE t USING fts5(body)");
  db.prepare('INSERT INTO t(body) VALUES (?)').run('hello dossier');
  const row = db.prepare("SELECT body FROM t WHERE t MATCH 'dossier'").get();
  assert.equal(row.body, 'hello dossier');
  db.close();
});

test('pdfkit and sharp load', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  assert.equal(typeof require('pdfkit'), 'function');
  const sharp = (await import('sharp')).default;
  assert.equal(typeof sharp, 'function');
});

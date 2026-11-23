import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig } from '../../src/config.js';

test('loadConfig defaults: <cwd>/workspace, OS user, port 4400', () => {
  const cfg = loadConfig({}, '/srv/app');
  assert.equal(cfg.home, resolve('/srv/app/workspace'));
  assert.equal(cfg.dataDir, join(resolve('/srv/app/workspace'), 'data'));
  assert.equal(cfg.user, userInfo().username);
  assert.equal(cfg.port, 4400);
});

test('loadConfig reads DOSSIER_HOME (relative to cwd), DOSSIER_USER and PORT', () => {
  const cfg = loadConfig({ DOSSIER_HOME: 'ws/acme', DOSSIER_USER: 'demo', PORT: '5100' }, '/srv/app');
  assert.equal(cfg.home, resolve('/srv/app/ws/acme'));
  assert.equal(cfg.dataDir, resolve('/srv/app/ws/acme/data'));
  assert.equal(cfg.user, 'demo');
  assert.equal(cfg.port, 5100);
});

test('loadConfig keeps an absolute DOSSIER_HOME and ignores a bad PORT', () => {
  const cfg = loadConfig({ DOSSIER_HOME: '/data/dossier', PORT: 'abc' }, '/srv/app');
  assert.equal(cfg.home, resolve('/data/dossier'));
  assert.equal(cfg.port, 4400);
});

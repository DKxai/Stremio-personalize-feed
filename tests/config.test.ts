import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../apps/api/config.js';

test('Botkeep assigned SERVER_PORT takes precedence over a local PORT setting', () => {
  assert.equal(loadConfig({ SERVER_PORT: '18342', PORT: '7000' }).port, 18342);
});

test('PORT and the local default remain available outside Botkeep', () => {
  assert.equal(loadConfig({ PORT: '8080' }).port, 8080);
  assert.equal(loadConfig({ SERVER_PORT: '', PORT: '8080' }).port, 8080);
  assert.equal(loadConfig({}).port, 7000);
});

test('an invalid assigned port fails instead of silently using another port', () => {
  for (const SERVER_PORT of ['0', '65536', '-1', 'abc']) {
    assert.throws(() => loadConfig({ SERVER_PORT, PORT: '7000' }), /Invalid SERVER_PORT/);
  }
});

// Config seam tests: resolution order + absence. No real secrets touched;
// temp files stand in for the volume mount.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSecret, resolveMapsKey } from './config.js';

describe('resolveSecret', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    env = {};
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('prefers the env var over the file', () => {
    const file = join(dir, 'key');
    writeFileSync(file, 'file-key');
    assert.equal(resolveSecret('K', file, { ...env, K: '  env-key  ' }), 'env-key');
  });

  it('falls back to the file, trimmed', () => {
    const file = join(dir, 'key');
    writeFileSync(file, 'file-key\n');
    assert.equal(resolveSecret('K', file, env), 'file-key');
  });

  it('blank env falls through to the file', () => {
    const file = join(dir, 'key');
    writeFileSync(file, 'file-key');
    assert.equal(resolveSecret('K', file, { ...env, K: '   ' }), 'file-key');
  });

  it('missing file resolves undefined, never throws', () => {
    assert.equal(resolveSecret('K', join(dir, 'absent'), env), undefined);
  });

  it('empty file resolves undefined', () => {
    const file = join(dir, 'key');
    writeFileSync(file, '\n');
    assert.equal(resolveSecret('K', file, env), undefined);
  });

  it('named resolvers read their own env vars', () => {
    assert.equal(resolveMapsKey({ MAPS_API_KEY: 'm' }), 'm');
    assert.equal(resolveMapsKey({}), undefined);
  });
});

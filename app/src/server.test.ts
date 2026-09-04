// Server boundary test: boots on an ephemeral port, answers the probe,
// hides the framework header. External behavior only.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from './server.js';

describe('server', () => {
  let server: Server | undefined;
  after(() => {
    server?.close();
  });

  it('answers /healthz 200 with service identity and no x-powered-by', async () => {
    await new Promise<void>((resolve) => {
      server = createApp().listen(0, '127.0.0.1', resolve);
    });
    const address = server?.address();
    assert.ok(address !== null && typeof address === 'object');
    const res = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok', service: 'grounded-journal' });
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  it('unknown routes 404', async () => {
    const address = server?.address();
    assert.ok(address !== null && typeof address === 'object');
    const res = await fetch(`http://127.0.0.1:${address.port}/nope`);
    assert.equal(res.status, 404);
  });
});

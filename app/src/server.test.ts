// Server boundary test: boots on an ephemeral port, answers the probe,
// hides the framework header. External behavior only.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from './server.js';

describe('server', () => {
  let server: Server | undefined;
  after(async () => {
    if (server !== undefined) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  it('answers /api/health 200 with service identity and no x-powered-by', async () => {
    await new Promise<void>((resolve) => {
      server = createApp().listen(0, '127.0.0.1', resolve);
    });
    const address = server?.address();
    assert.ok(address !== null && typeof address === 'object');
    const res = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok', service: 'grounded-journal' });
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  it('serves the static frontend at /', async () => {
    const address = server?.address();
    assert.ok(address !== null && typeof address === 'object');
    const res = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(res.status, 200);
    assert.ok((res.headers.get('content-type') ?? '').includes('text/html'));
    const html = await res.text();
    assert.ok(html.includes('Grounded Journal'));
    assert.ok(html.includes('/app.js'));
    assert.ok(html.includes('Sign in with Google'));
  });

  it('serves frontend assets', async () => {
    const address = server?.address();
    assert.ok(address !== null && typeof address === 'object');
    const js = await fetch(`http://127.0.0.1:${address.port}/app.js`);
    assert.equal(js.status, 200);
    assert.ok((js.headers.get('content-type') ?? '').includes('javascript'));
    const css = await fetch(`http://127.0.0.1:${address.port}/styles.css`);
    assert.equal(css.status, 200);
  });

  it('unknown routes 404', async () => {
    const address = server?.address();
    assert.ok(address !== null && typeof address === 'object');
    const res = await fetch(`http://127.0.0.1:${address.port}/nope`);
    assert.equal(res.status, 404);
  });
});

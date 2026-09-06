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
    assert.ok(html.includes('<div id="root"'));
    // NOTE: "Sign in with Google" renders client-side; the shell only mounts
    // #root. Runtime text is verified in the browser inspection pass.
  });

  it('serves frontend assets', async () => {
    const address = server?.address();
    assert.ok(address !== null && typeof address === 'object');
    // The React+Vite build emits hashed asset names; resolve them from the
    // served shell instead of pinning filenames.
    const shell = await (await fetch(`http://127.0.0.1:${address.port}/`)).text();
    const jsSrc = shell.match(/<script[^>]*\ssrc="([^"]+)"/)?.[1];
    const cssHref = shell.match(/<link[^>]*\shref="([^"]+\.css)"/)?.[1];
    assert.ok(jsSrc !== undefined && jsSrc !== '');
    assert.ok(cssHref !== undefined && cssHref !== '');
    const js = await fetch(`http://127.0.0.1:${address.port}${jsSrc}`);
    assert.equal(js.status, 200);
    assert.ok((js.headers.get('content-type') ?? '').includes('javascript'));
    const css = await fetch(`http://127.0.0.1:${address.port}${cssHref}`);
    assert.equal(css.status, 200);
  });

  it('unknown routes 404', async () => {
    const address = server?.address();
    assert.ok(address !== null && typeof address === 'object');
    const res = await fetch(`http://127.0.0.1:${address.port}/nope`);
    assert.equal(res.status, 404);
  });

  it('serves runtime Firebase web config for the browser', async () => {
    process.env.FIREBASE_WEB_API_KEY = 'test-api-key';
    process.env.FIREBASE_WEB_AUTH_DOMAIN = 'test.firebaseapp.com';
    process.env.FIREBASE_WEB_PROJECT_ID = 'test-project';
    process.env.FIREBASE_WEB_APP_ID = 'test-app-id';
    try {
      const address = server?.address();
      assert.ok(address !== null && typeof address === 'object');
      const res = await fetch(`http://127.0.0.1:${address.port}/firebase-config.js`);
      assert.equal(res.status, 200);
      assert.ok((res.headers.get('content-type') ?? '').includes('javascript'));
      const body = await res.text();
      assert.ok(body.includes('window.__FIREBASE_CONFIG__='));
      assert.ok(body.includes('test-api-key'));
      assert.ok(body.includes('test-app-id'));
    } finally {
      delete process.env.FIREBASE_WEB_API_KEY;
      delete process.env.FIREBASE_WEB_AUTH_DOMAIN;
      delete process.env.FIREBASE_WEB_PROJECT_ID;
      delete process.env.FIREBASE_WEB_APP_ID;
    }
  });

  it('serves null web config fields when env is absent (client fail-fasts)', async () => {
    const address = server?.address();
    assert.ok(address !== null && typeof address === 'object');
    const res = await fetch(`http://127.0.0.1:${address.port}/firebase-config.js`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes('"apiKey":null'));
  });

  it('serves the browser Maps key for the map view, null when unset', async () => {
    process.env.MAPS_BROWSER_KEY = 'test-browser-key';
    try {
      const address = server?.address();
      assert.ok(address !== null && typeof address === 'object');
      const res = await fetch(`http://127.0.0.1:${address.port}/maps-config.js`);
      assert.equal(res.status, 200);
      assert.ok((res.headers.get('content-type') ?? '').includes('javascript'));
      const body = await res.text();
      assert.ok(body.includes('window.__MAPS_CONFIG__='));
      assert.ok(body.includes('test-browser-key'));
    } finally {
      delete process.env.MAPS_BROWSER_KEY;
    }
    const address = server?.address();
    assert.ok(address !== null && typeof address === 'object');
    const res = await fetch(`http://127.0.0.1:${address.port}/maps-config.js`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes('"browserKey":null'));
  });
});

// Places router tests: validation + proxy behavior with a fake upstream.
// No network, no keys, no quota.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express, { type Express } from 'express';
import type { Server } from 'node:http';
import { createPlacesRouter } from './places.js';
import type { TokenVerifier } from '../auth.js';

function fakeUpstream(body: unknown, status = 200) {
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

const SUGGESTIONS = {
  suggestions: [
    { placePrediction: { placeId: 'ChIJX', text: { text: 'Rizal Park, Manila' } } },
    { placePrediction: { placeId: 'ChIJY', text: { text: 'Rizal Avenue' } } },
    { placePrediction: {} },
  ],
};

let server: Server | undefined;
async function shutdown(): Promise<void> {
  if (server !== undefined) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
}
async function serve(app: Express): Promise<string> {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('no address');
  }
  return `http://127.0.0.1:${address.port}`;
}
function build(fetchImpl?: typeof fetch): Express {
  const verify: TokenVerifier = async (token: string): Promise<string> => {
    if (token === 'good-token') {
      return 'alice';
    }
    throw new Error('bad token');
  };
  const app = express();
  app.use(express.json());
  app.use('/api/places', createPlacesRouter({ apiKey: 'k', fetchImpl, verify }));
  return app;
}
async function post(url: string, body: unknown, auth = 'Bearer good-token') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth !== '') {
    headers.Authorization = auth;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('places router', () => {
  afterEach(shutdown);

  it('returns predictions for a query', async () => {
    const { fetchImpl } = fakeUpstream(SUGGESTIONS);
    const url = await serve(build(fetchImpl));
    const r = await post(`${url}/api/places/autocomplete`, { query: 'rizal' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.predictions, [
      { placeId: 'ChIJX', text: 'Rizal Park, Manila' },
      { placeId: 'ChIJY', text: 'Rizal Avenue' },
    ]);
  });

  it('forwards the session token and field mask upstream', async () => {
    const { fetchImpl, seen } = fakeUpstream(SUGGESTIONS);
    const url = await serve(build(fetchImpl));
    const r = await post(`${url}/api/places/autocomplete`, { query: 'rizal', sessionToken: 'tok-1' });
    assert.equal(r.status, 200);
    assert.ok(seen[0]?.url.endsWith('/places:autocomplete'));
    const headers = seen[0]?.init?.headers as Record<string, string>;
    assert.equal(headers['X-Goog-Api-Key'], 'k');
    const sentMask = headers['X-Goog-FieldMask'];
    if (typeof sentMask !== 'string') {
      throw new Error('expected mask header');
    }
    assert.ok(sentMask.includes('placePrediction'));
    const rawBody = seen[0]?.init?.body;
    if (typeof rawBody !== 'string') {
      throw new Error('expected string request body');
    }
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    assert.equal(body.input, 'rizal');
    assert.equal(body.sessionToken, 'tok-1');
  });

  it('rejects bad input', async () => {
    const { fetchImpl, seen } = fakeUpstream(SUGGESTIONS);
    const url = await serve(build(fetchImpl));
    for (const body of [
      { query: '' },
      { query: 'x'.repeat(201) },
      {},
      { query: 'rizal', sessionToken: '' },
      { query: 'rizal', sessionToken: 'x'.repeat(129) },
    ]) {
      const r = await post(`${url}/api/places/autocomplete`, body);
      assert.equal(r.status, 400);
    }
    assert.equal(seen.length, 0);
  });

  it('maps upstream failure to 502 without leaking', async () => {
    const { fetchImpl } = fakeUpstream({ error: 'x' }, 500);
    const url = await serve(build(fetchImpl));
    const r = await post(`${url}/api/places/autocomplete`, { query: 'rizal' });
    assert.equal(r.status, 502);
    assert.deepEqual(r.json, { error: 'place lookup failed' });
  });

  it('rejects unauthenticated callers', async () => {
    const { fetchImpl, seen } = fakeUpstream(SUGGESTIONS);
    const url = await serve(build(fetchImpl));
    assert.equal((await post(`${url}/api/places/autocomplete`, { query: 'rizal' }, '')).status, 401);
    assert.equal((await post(`${url}/api/places/autocomplete`, { query: 'rizal' }, 'Bearer bad')).status, 401);
    assert.equal(seen.length, 0);
  });
});

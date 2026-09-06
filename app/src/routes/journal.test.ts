// Journal route tests: HTTP behavior with fakes at every seam (in-memory
// store, stub place fetch, stub Gemini). No emulator, no network, no quota.
// External behavior only: statuses, shapes, and cross-endpoint rules.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express, { type Express } from 'express';
import type { Server } from 'node:http';
import { createJournalRouter, type JournalDeps } from './journal.js';
import type { TokenVerifier } from '../auth.js';
import { QuotaDepletedError, TransientGeminiError, FatalGeminiError, type IGeminiClient } from '../gemini/client.js';
import type {
  EntryRecord,
  FetchedPlace,
  GroundingSnapshot,
  JournalStore,
  PlaceCacheRecord,
} from '../store/repository.js';

const iso = (ms: number): string => new Date(ms).toISOString();
const T0 = Date.parse('2026-09-04T00:00:00.000Z');

class FakeStore implements JournalStore {
  vaults = new Map<string, string>();
  entries = new Map<string, EntryRecord>();
  cache = new Map<string, PlaceCacheRecord>();
  seq = 0;

  async saveEntry(vaultId: string, entry: EntryRecord): Promise<string> {
    const owner = this.vaults.get(vaultId);
    if (owner !== undefined && owner !== entry.ownerUid) {
      throw new Error('owner mismatch: vault belongs to another owner');
    }
    this.vaults.set(vaultId, entry.ownerUid);
    const id = `e${++this.seq}`;
    this.entries.set(`${vaultId}/${id}`, { ...entry });
    return id;
  }

  async listEntries(vaultId: string, ownerUid: string, limit: number) {
    return [...this.entries]
      .filter(([k, e]) => k.startsWith(`${vaultId}/`) && e.ownerUid === ownerUid)
      .sort((a, b) => (a[1].createdAt < b[1].createdAt ? 1 : -1))
      .slice(0, limit)
      .map(([k, entry]) => ({ id: k.split('/')[1] as string, entry }));
  }

  async getEntry(vaultId: string, entryId: string, ownerUid: string) {
    const e = this.entries.get(`${vaultId}/${entryId}`);
    if (e === undefined || e.ownerUid !== ownerUid) {
      return null;
    }
    return e;
  }

  async appendGrounding(vaultId: string, entryId: string, ownerUid: string, snapshot: GroundingSnapshot) {
    const e = await this.getEntry(vaultId, entryId, ownerUid);
    if (e === null) {
      throw new Error(`entry not found: vaults/${vaultId}/entries/${entryId}`);
    }
    if (e.placeIds.includes(snapshot.placeId)) {
      return;
    }
    this.entries.set(`${vaultId}/${entryId}`, {
      ...e,
      placeIds: [...e.placeIds, snapshot.placeId],
      groundingSnapshots: [...e.groundingSnapshots, snapshot],
    });
  }

  async getPlace(
    vaultId: string,
    placeId: string,
    fetch: (placeId: string) => Promise<FetchedPlace>,
  ): Promise<PlaceCacheRecord> {
    const hit = this.cache.get(`${vaultId}/${placeId}`);
    if (hit !== undefined) {
      return hit;
    }
    const f = await fetch(placeId);
    const record: PlaceCacheRecord = {
      placeJson: f.placeJson,
      fetchedAt: iso(f.fetchedAtMs),
      expiresAt: iso(f.fetchedAtMs + 7 * 864e5),
    };
    this.cache.set(`${vaultId}/${placeId}`, record);
    return record;
  }

  async getCachedPlace(vaultId: string, placeId: string): Promise<PlaceCacheRecord | null> {
    return this.cache.get(`${vaultId}/${placeId}`) ?? null;
  }

  async removeGrounding(vaultId: string, entryId: string, ownerUid: string, placeId: string): Promise<void> {
    const e = await this.getEntry(vaultId, entryId, ownerUid);
    if (e === null) {
      throw new Error(`entry not found: vaults/${vaultId}/entries/${entryId}`);
    }
    if (e.turns.some((t) => t.by === 'model')) {
      throw new Error('REFUSED: Grounding is frozen — a Reflection already exists.');
    }
    this.entries.set(`${vaultId}/${entryId}`, {
      ...e,
      placeIds: e.placeIds.filter((id) => id !== placeId),
      groundingSnapshots: e.groundingSnapshots.filter((s) => s.placeId !== placeId),
    });
  }

  async appendTurns(
    vaultId: string,
    entryId: string,
    ownerUid: string,
    turns: Array<{ by: 'user' | 'model'; text: string; placeIds: readonly string[] }>,
  ): Promise<void> {
    const e = await this.getEntry(vaultId, entryId, ownerUid);
    if (e === null) {
      throw new Error(`entry not found: vaults/${vaultId}/entries/${entryId}`);
    }
    this.entries.set(`${vaultId}/${entryId}`, { ...e, turns: [...e.turns, ...turns] });
  }
}

const PLACE_JSON = {
  placeId: 'ChIJX',
  name: 'Rizal Park',
  address: 'Manila, Philippines',
  attributions: 'Powered by Google',
};

function fetchOk(): (placeId: string) => Promise<FetchedPlace> {
  return async (placeId: string) => ({ placeJson: { ...PLACE_JSON, placeId }, fetchedAtMs: T0 });
}

/** Fake ID tokens: `tok-<uid>` verifies as <uid>, anything else rejects. */
const fakeVerify: TokenVerifier = async (token: string): Promise<string> => {
  const match = /^tok-(.+)$/.exec(token);
  if (match?.[1] === undefined || match[1] === '') {
    throw new Error('bad token');
  }
  return match[1];
};

function geminiOk(reply = 'grounded words'): IGeminiClient {
  return { generate: async () => reply };
}

interface Ctx {
  app: Express;
  store: FakeStore;
  gemini: { reply: string; failWith: (new (m: string) => Error) | null };
}

function setup(): Ctx {
  const store = new FakeStore();
  const state = { reply: 'grounded words', failWith: null as (new (m: string) => Error) | null };
  const gemini: IGeminiClient = {
    generate: async () => {
      if (state.failWith !== null) {
        throw new state.failWith('boom');
      }
      return state.reply;
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/vaults', createJournalRouter({ store, fetchPlace: fetchOk(), gemini, verify: fakeVerify }));
  return { app, store, gemini: state };
}

let server: Server | undefined;
async function shutdown(): Promise<void> {
  if (server !== undefined) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
}
async function base(app: Express): Promise<string> {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('no address');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function post(
  url: string,
  body: unknown,
  auth = 'Bearer tok-v1',
): Promise<{ status: number; json: Record<string, unknown> }> {
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

async function get(url: string, auth = 'Bearer tok-v1'): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (auth !== '') {
    headers.Authorization = auth;
  }
  const res = await fetch(url, { headers });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('journal routes', () => {
  let ctx: Ctx;
  let url: string;
  beforeEach(async () => {
    ctx = setup();
    url = await base(ctx.app);
  });
  afterEach(shutdown);

  it('creates an entry and lists it with its id', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { text: 'hello' });
    assert.equal(created.status, 201);
    assert.ok(typeof created.json.id === 'string');
    const listed = await get(`${url}/api/vaults/v1/entries`);
    assert.equal(listed.status, 200);
    const body = listed.json as unknown as { entries: Array<{ id: string; entry: { text: string } }> };
    assert.equal(body.entries.length, 1);
    assert.equal(body.entries[0]?.id, created.json.id);
    assert.equal(body.entries[0]?.entry.text, 'hello');
  });

  it('rejects unauthenticated and mis-addressed calls', async () => {
    // No token, malformed scheme, unknown token → 401 without touching logic.
    for (const auth of ['', 'Basic xyz', 'Bearer nope']) {
      const r = await post(`${url}/api/vaults/v1/entries`, { text: 'hello' }, auth);
      assert.equal(r.status, 401);
    }
    const g = await get(`${url}/api/vaults/v1/entries`, '');
    assert.equal(g.status, 401);
    // Authenticated as someone else: vault guard rejects (400), never 404/403 oracle.
    const mismatch = await post(`${url}/api/vaults/v1/entries`, { text: 'hello' }, 'Bearer tok-intruder');
    assert.equal(mismatch.status, 400);
  });

  it('rejects bad entry input', async () => {
    for (const body of [{ text: '' }, { text: 'x'.repeat(5001) }, {}]) {
      const r = await post(`${url}/api/vaults/v1/entries`, body);
      assert.equal(r.status, 400);
    }
  });

  it('rejects bad list queries', async () => {
    for (const q of ['?limit=0', '?limit=101', '?limit=abc']) {
      const res = await get(`${url}/api/vaults/v1/entries${q}`);
      assert.equal(res.status, 400);
    }
  });

  it('grounds an entry, idempotently', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { text: 'here' });
    const id = created.json.id as string;
    const g1 = await post(`${url}/api/vaults/v1/entries/${id}/groundings`, { placeId: 'ChIJX' });
    assert.equal(g1.status, 201);
    assert.equal((g1.json.grounding as { name: string }).name, 'Rizal Park');
    const g2 = await post(`${url}/api/vaults/v1/entries/${id}/groundings`, { placeId: 'ChIJX' });
    assert.equal(g2.status, 201);
    const listed = await get(`${url}/api/vaults/v1/entries`);
    const body = listed.json as unknown as { entries: Array<{ entry: { placeIds: string[] } }> };
    assert.deepEqual(body.entries[0]?.entry.placeIds, ['ChIJX']);
  });

  it('rejects bad grounding input and missing entries', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { text: 'here' });
    const id = created.json.id as string;
    for (const body of [
      { placeId: '' },
      {},
      { placeId: 'ChIJX', sessionToken: '' },
      { placeId: 'ChIJX', sessionToken: 'x'.repeat(129) },
    ]) {
      const r = await post(`${url}/api/vaults/v1/entries/${id}/groundings`, body);
      assert.equal(r.status, 400);
    }
    const missing = await post(`${url}/api/vaults/v1/entries/nope/groundings`, { placeId: 'ChIJX' });
    assert.equal(missing.status, 404);
    const unauth = await post(`${url}/api/vaults/v1/entries/${id}/groundings`, { placeId: 'ChIJX' }, '');
    assert.equal(unauth.status, 401);
  });

  it('foreign callers cannot address another vault', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { text: 'mine' });
    const id = created.json.id as string;
    const r = await post(`${url}/api/vaults/v1/entries/${id}/reflections`, { history: [] });
    assert.equal(r.status, 201);
    // Authenticated as someone else: vault guard rejects (400) — and with
    // vaultId === uid there is no cross-vault addressability at all.
    const mismatch = await post(
      `${url}/api/vaults/v1/entries/${id}/groundings`,
      { placeId: 'ChIJX' },
      'Bearer tok-intruder',
    );
    assert.equal(mismatch.status, 400);
  });

  it('reflects then freezes groundings', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { text: 'here' });
    const id = created.json.id as string;
    await post(`${url}/api/vaults/v1/entries/${id}/groundings`, { placeId: 'ChIJX' });
    const r = await post(`${url}/api/vaults/v1/entries/${id}/reflections`, {});
    assert.equal(r.status, 201);
    assert.equal(r.json.reflection, 'grounded words');
    const frozen = await post(`${url}/api/vaults/v1/entries/${id}/groundings`, {
      placeId: 'ChIJY',
    });
    assert.equal(frozen.status, 409);
  });

  it('repeat reflects extend the Session', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { text: 'here' });
    const id = created.json.id as string;
    await post(`${url}/api/vaults/v1/entries/${id}/reflections`, {});
    ctx.gemini.reply = 'second words';
    const r2 = await post(`${url}/api/vaults/v1/entries/${id}/reflections`, {});
    assert.equal(r2.status, 201);
    assert.equal(r2.json.reflection, 'second words');
    const listed = await get(`${url}/api/vaults/v1/entries`);
    const body = listed.json as unknown as { entries: Array<{ entry: { turns: Array<{ by: string; text: string }> } }> };
    assert.deepEqual(
      body.entries[0]?.entry.turns,
      [
        { by: 'model', text: 'grounded words', placeIds: [] },
        { by: 'model', text: 'second words', placeIds: [] },
      ],
    );
  });

  it('persists user follow-up turns with the entry placeIds', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { text: 'here' });
    const id = created.json.id as string;
    await post(`${url}/api/vaults/v1/entries/${id}/groundings`, { placeId: 'ChIJX' });
    const r = await post(`${url}/api/vaults/v1/entries/${id}/reflections`, {
      history: [{ by: 'user', text: 'what about the lake there?' }],
    });
    assert.equal(r.status, 201);
    const listed = await get(`${url}/api/vaults/v1/entries`);
    const body = listed.json as unknown as { entries: Array<{ entry: { turns: Array<{ by: string; text: string; placeIds: string[] }> } }> };
    assert.deepEqual(body.entries[0]?.entry.turns, [
      { by: 'user', text: 'what about the lake there?', placeIds: ['ChIJX'] },
      { by: 'model', text: 'grounded words', placeIds: ['ChIJX'] },
    ]);
  });

  it('removes a grounding before any reflection', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { text: 'here' });
    const id = created.json.id as string;
    await post(`${url}/api/vaults/v1/entries/${id}/groundings`, { placeId: 'ChIJX' });
    const del = await fetch(`${url}/api/vaults/v1/entries/${id}/groundings/ChIJX`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer tok-v1' },
    });
    assert.equal(del.status, 200);
    assert.deepEqual(await del.json(), { removed: true });
    const listed = await get(`${url}/api/vaults/v1/entries`);
    const body = listed.json as unknown as { entries: Array<{ entry: { placeIds: string[] } }> };
    assert.deepEqual(body.entries[0]?.entry.placeIds, []);
  });

  it('refuses grounding removal after reflection, and 404s unknown entries', async () => {    const created = await post(`${url}/api/vaults/v1/entries`, { text: 'here' });
    const id = created.json.id as string;
    await post(`${url}/api/vaults/v1/entries/${id}/groundings`, { placeId: 'ChIJX' });
    await post(`${url}/api/vaults/v1/entries/${id}/reflections`, {});
    const frozen = await fetch(`${url}/api/vaults/v1/entries/${id}/groundings/ChIJX`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer tok-v1' },
    });
    assert.equal(frozen.status, 409);
    const missing = await fetch(`${url}/api/vaults/v1/entries/nope/groundings/ChIJX`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer tok-v1' },
    });
    assert.equal(missing.status, 404);
    const unauth = await fetch(`${url}/api/vaults/v1/entries/${id}/groundings/ChIJX`, { method: 'DELETE' });
    assert.equal(unauth.status, 401);
  });

  it('removing a never-grounded place 404s instead of silently succeeding', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { text: 'here' });
    const id = created.json.id as string;
    const r = await fetch(`${url}/api/vaults/v1/entries/${id}/groundings/ChIJNOPE`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer tok-v1' },
    });
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { error: 'place not grounded' });
  });

  it('reads a single entry with its turns', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { text: 'here' });
    const id = created.json.id as string;
    await post(`${url}/api/vaults/v1/entries/${id}/groundings`, { placeId: 'ChIJX' });
    await post(`${url}/api/vaults/v1/entries/${id}/reflections`, {
      history: [{ by: 'user', text: 'more?' }],
    });
    const got = await get(`${url}/api/vaults/v1/entries/${id}`);
    assert.equal(got.status, 200);
    const body = got.json as unknown as {
      id: string;
      entry: { text: string; turns: Array<{ by: string; text: string; placeIds: string[] }> };
    };
    assert.equal(body.id, id);
    assert.deepEqual(body.entry.turns, [
      { by: 'user', text: 'more?', placeIds: ['ChIJX'] },
      { by: 'model', text: 'grounded words', placeIds: ['ChIJX'] },
    ]);
    const missing = await get(`${url}/api/vaults/v1/entries/nope`);
    assert.equal(missing.status, 404);
    const unauth = await get(`${url}/api/vaults/v1/entries/${id}`, '');
    assert.equal(unauth.status, 401);
  });

  it('serves cached place details without fetching', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { text: 'here' });
    const id = created.json.id as string;
    await post(`${url}/api/vaults/v1/entries/${id}/groundings`, { placeId: 'ChIJX' });
    const hit = await get(`${url}/api/vaults/v1/places/ChIJX`);
    assert.equal(hit.status, 200);
    const details = hit.json.details as Record<string, unknown>;
    assert.equal(details.name, 'Rizal Park');
    assert.equal(details.address, 'Manila, Philippines');
    assert.equal(details.attributions, 'Powered by Google');
    const miss = await get(`${url}/api/vaults/v1/places/ChIJNOPE`);
    assert.equal(miss.status, 404);
  });

  it('serves cached coordinates for map pins once a location-bearing fetch lands', async () => {
    const store = new FakeStore();
    const locatedApp = express();
    locatedApp.use(express.json());
    locatedApp.use(
      '/api/vaults',
      createJournalRouter({
        store,
        fetchPlace: (async (placeId: string) => ({
          placeJson: {
            ...PLACE_JSON,
            placeId,
            location: { latitude: 14.5826, longitude: 120.9783 },
          },
          fetchedAtMs: T0,
        })) as JournalDeps['fetchPlace'],
        gemini: geminiOk(),
        verify: fakeVerify,
      }),
    );
    // A second server alongside the shared one: the shared base stays up for
    // the pre-location assertion at the end.
    let extra: Server | undefined;
    const base2 = await new Promise<string>((resolve, reject) => {
      extra = locatedApp.listen(0, '127.0.0.1', () => {
        const a = extra?.address();
        if (a === null || a === undefined || typeof a === 'string') {
          reject(new Error('no address'));
          return;
        }
        resolve(`http://127.0.0.1:${a.port}`);
      });
    });
    try {
      const created = await post(`${base2}/api/vaults/v3/entries`, { text: 'here' }, 'Bearer tok-v3');
      const eid = created.json.id as string;
      await post(`${base2}/api/vaults/v3/entries/${eid}/groundings`, { placeId: 'ChIJX' }, 'Bearer tok-v3');
      const hit = await get(`${base2}/api/vaults/v3/places/ChIJX`, 'Bearer tok-v3');
      assert.equal(hit.status, 200);
      assert.deepEqual((hit.json.details as Record<string, unknown>).location, {
        latitude: 14.5826,
        longitude: 120.9783,
      });
    } finally {
      extra?.closeAllConnections();
      await new Promise<void>((resolve) => extra?.close(() => resolve()));
    }
    // Pre-location cache records stay pin-less, never crash: the shared base
    // caches the location-free PLACE_JSON fixture.
    const legacyCreated = await post(`${url}/api/vaults/v1/entries`, { text: 'here' });
    const legacyId = legacyCreated.json.id as string;
    await post(`${url}/api/vaults/v1/entries/${legacyId}/groundings`, { placeId: 'ChIJX' });
    const legacy = await get(`${url}/api/vaults/v1/places/ChIJX`);
    assert.equal(legacy.status, 200);
    assert.equal((legacy.json.details as Record<string, unknown>).location, undefined);
  });

  it('maps model failures to 429/502/500', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { text: 'here' });
    const id = created.json.id as string;
    const cases: Array<[new (m: string) => Error, number]> = [
      [QuotaDepletedError, 429],
      [TransientGeminiError, 502],
      [FatalGeminiError, 500],
    ];
    for (const [ctor, status] of cases) {
      ctx.gemini.failWith = ctor;
      const r = await post(`${url}/api/vaults/v1/entries/${id}/reflections`, {});
      assert.equal(r.status, status);
    }
    ctx.gemini.failWith = null;
  });

  it('rejects bad history and missing entries on reflect', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { text: 'here' });
    const id = created.json.id as string;
    const badHist = await post(`${url}/api/vaults/v1/entries/${id}/reflections`, {
      history: [{ by: 'alien', text: 'x' }],
    });
    assert.equal(badHist.status, 400);
    const missing = await post(`${url}/api/vaults/v1/entries/nope/reflections`, {});
    assert.equal(missing.status, 404);
  });

  it('passes the autocomplete session token to the fetcher', async () => {
    const seen: Array<{ placeId: string; token?: string }> = [];
    const app = express();
    app.use(express.json());
    app.use(
      '/api/vaults',
      createJournalRouter({
        store: new FakeStore(),
        fetchPlace: (async (placeId: string, sessionToken?: string) => {
          seen.push({ placeId, token: sessionToken });
          return { placeJson: { name: 'P' }, fetchedAtMs: T0 };
        }) as JournalDeps['fetchPlace'],
        gemini: geminiOk(),
        verify: fakeVerify,
      }),
    );
    await shutdown();
    const base2 = await base(app);
    const created = await post(`${base2}/api/vaults/v9/entries`, { text: 'here' }, 'Bearer tok-v9');
    const id = created.json.id as string;
    const g = await post(
      `${base2}/api/vaults/v9/entries/${id}/groundings`,
      {
        placeId: 'ChIJX',
        sessionToken: 'tok-1',
      },
      'Bearer tok-v9',
    );
    assert.equal(g.status, 201);
    assert.deepEqual(seen, [{ placeId: 'ChIJX', token: 'tok-1' }]);
  });

  it('opaque cached payloads degrade to id + defaults, never crash', async () => {
    const store = new FakeStore();
    const opaqueApp = express();
    opaqueApp.use(express.json());
    opaqueApp.use(
      '/api/vaults',
      createJournalRouter({
        store,
        fetchPlace: async () => ({ placeJson: 'opaque-blob', fetchedAtMs: T0 }),
        gemini: geminiOk(),
        verify: fakeVerify,
      }),
    );
    await shutdown();
    const address = await new Promise<import('node:net').AddressInfo>((resolve, reject) => {
      server = opaqueApp.listen(0, '127.0.0.1', () => {
        const a = server?.address();
        if (a === null || a === undefined || typeof a === 'string') {
          reject(new Error('no address'));
          return;
        }
        resolve(a);
      });
    });
    const base2 = `http://127.0.0.1:${address.port}`;
    const created = await post(`${base2}/api/vaults/v2/entries`, { text: 'here' }, 'Bearer tok-v2');
    const eid = created.json.id as string;
    const g = await post(`${base2}/api/vaults/v2/entries/${eid}/groundings`, { placeId: 'ChIJX' }, 'Bearer tok-v2');
    assert.equal(g.status, 201);
    assert.equal((g.json.grounding as { name: string }).name, 'ChIJX');
    assert.equal((g.json.grounding as { attributions: string }).attributions, 'Powered by Google');
  });
});

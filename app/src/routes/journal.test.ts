// Journal route tests: HTTP behavior with fakes at every seam (in-memory
// store, stub place fetch, stub Gemini). No emulator, no network, no quota.
// External behavior only: statuses, shapes, and cross-endpoint rules.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express, { type Express } from 'express';
import type { Server } from 'node:http';
import { createJournalRouter } from './journal.js';
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

  async saveReflection(vaultId: string, entryId: string, ownerUid: string, text: string) {
    const e = await this.getEntry(vaultId, entryId, ownerUid);
    if (e === null) {
      throw new Error(`entry not found: vaults/${vaultId}/entries/${entryId}`);
    }
    this.entries.set(`${vaultId}/${entryId}`, { ...e, reflections: [...e.reflections, text] });
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
  app.use('/api/vaults', createJournalRouter({ store, fetchPlace: fetchOk(), gemini }));
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

async function post(url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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
    const created = await post(`${url}/api/vaults/v1/entries`, { ownerUid: 'v1', text: 'hello' });
    assert.equal(created.status, 201);
    assert.ok(typeof created.json.id === 'string');
    const res = await fetch(`${url}/api/vaults/v1/entries?ownerUid=v1`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { entries: Array<{ id: string; entry: { text: string } }> };
    assert.equal(body.entries.length, 1);
    assert.equal(body.entries[0]?.id, created.json.id);
    assert.equal(body.entries[0]?.entry.text, 'hello');
  });

  it('rejects bad entry input', async () => {
    for (const body of [
      { ownerUid: 'v1', text: '' },
      { ownerUid: 'v1', text: 'x'.repeat(5001) },
      { text: 'hello' },
      { ownerUid: 'someone-else', text: 'hello' },
    ]) {
      const r = await post(`${url}/api/vaults/v1/entries`, body);
      assert.equal(r.status, 400);
    }
  });

  it('rejects bad list queries', async () => {
    for (const q of ['?ownerUid=v1&limit=0', '?ownerUid=v1&limit=101', '?ownerUid=v1&limit=abc', '?ownerUid=nope']) {
      const res = await fetch(`${url}/api/vaults/v1/entries${q}`);
      assert.equal(res.status, 400);
    }
  });

  it('grounds an entry, idempotently', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { ownerUid: 'v1', text: 'here' });
    const id = created.json.id as string;
    const g1 = await post(`${url}/api/vaults/v1/entries/${id}/groundings`, { ownerUid: 'v1', placeId: 'ChIJX' });
    assert.equal(g1.status, 201);
    assert.equal((g1.json.grounding as { name: string }).name, 'Rizal Park');
    const g2 = await post(`${url}/api/vaults/v1/entries/${id}/groundings`, { ownerUid: 'v1', placeId: 'ChIJX' });
    assert.equal(g2.status, 201);
    const res = await fetch(`${url}/api/vaults/v1/entries?ownerUid=v1`);
    const body = (await res.json()) as { entries: Array<{ entry: { placeIds: string[] } }> };
    assert.deepEqual(body.entries[0]?.entry.placeIds, ['ChIJX']);
  });

  it('rejects bad grounding input and missing entries', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { ownerUid: 'v1', text: 'here' });
    const id = created.json.id as string;
    for (const body of [{ ownerUid: 'v1', placeId: '' }, { ownerUid: 'v1' }, { ownerUid: 'x', placeId: 'ChIJX' }]) {
      const r = await post(`${url}/api/vaults/v1/entries/${id}/groundings`, body);
      assert.equal(r.status, 400);
    }
    const missing = await post(`${url}/api/vaults/v1/entries/nope/groundings`, { ownerUid: 'v1', placeId: 'ChIJX' });
    assert.equal(missing.status, 404);
    const foreign = await post(`${url}/api/vaults/v1/entries/${id}/groundings`, { ownerUid: 'v1', placeId: 'ChIJX' });
    assert.equal(foreign.status, 201);
  });

  it('foreign owners see 404, not 403 (no oracle)', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { ownerUid: 'v1', text: 'mine' });
    const id = created.json.id as string;
    const r = await post(`${url}/api/vaults/v1/entries/${id}/reflections`, { ownerUid: 'v1', history: [] });
    assert.equal(r.status, 201);
    // Same vault id, different claimed owner: vault guard rejects first.
    const mismatch = await post(`${url}/api/vaults/v1/entries/${id}/groundings`, {
      ownerUid: 'intruder',
      placeId: 'ChIJX',
    });
    assert.equal(mismatch.status, 400);
  });

  it('reflects then freezes groundings', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { ownerUid: 'v1', text: 'here' });
    const id = created.json.id as string;
    await post(`${url}/api/vaults/v1/entries/${id}/groundings`, { ownerUid: 'v1', placeId: 'ChIJX' });
    const r = await post(`${url}/api/vaults/v1/entries/${id}/reflections`, { ownerUid: 'v1' });
    assert.equal(r.status, 201);
    assert.equal(r.json.reflection, 'grounded words');
    const frozen = await post(`${url}/api/vaults/v1/entries/${id}/groundings`, {
      ownerUid: 'v1',
      placeId: 'ChIJY',
    });
    assert.equal(frozen.status, 409);
  });

  it('repeat reflects extend the thread', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { ownerUid: 'v1', text: 'here' });
    const id = created.json.id as string;
    await post(`${url}/api/vaults/v1/entries/${id}/reflections`, { ownerUid: 'v1' });
    ctx.gemini.reply = 'second words';
    const r2 = await post(`${url}/api/vaults/v1/entries/${id}/reflections`, { ownerUid: 'v1' });
    assert.equal(r2.status, 201);
    assert.equal(r2.json.reflection, 'second words');
    const res = await fetch(`${url}/api/vaults/v1/entries?ownerUid=v1`);
    const body = (await res.json()) as { entries: Array<{ entry: { reflections: string[] } }> };
    assert.deepEqual(body.entries[0]?.entry.reflections, ['grounded words', 'second words']);
  });

  it('maps model failures to 429/502/500', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { ownerUid: 'v1', text: 'here' });
    const id = created.json.id as string;
    const cases: Array<[new (m: string) => Error, number]> = [
      [QuotaDepletedError, 429],
      [TransientGeminiError, 502],
      [FatalGeminiError, 500],
    ];
    for (const [ctor, status] of cases) {
      ctx.gemini.failWith = ctor;
      const r = await post(`${url}/api/vaults/v1/entries/${id}/reflections`, { ownerUid: 'v1' });
      assert.equal(r.status, status);
    }
    ctx.gemini.failWith = null;
  });

  it('rejects bad history and missing entries on reflect', async () => {
    const created = await post(`${url}/api/vaults/v1/entries`, { ownerUid: 'v1', text: 'here' });
    const id = created.json.id as string;
    const badHist = await post(`${url}/api/vaults/v1/entries/${id}/reflections`, {
      ownerUid: 'v1',
      history: [{ by: 'alien', text: 'x' }],
    });
    assert.equal(badHist.status, 400);
    const missing = await post(`${url}/api/vaults/v1/entries/nope/reflections`, { ownerUid: 'v1' });
    assert.equal(missing.status, 404);
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
    const created = await post(`${base2}/api/vaults/v2/entries`, { ownerUid: 'v2', text: 'here' });
    const eid = created.json.id as string;
    const g = await post(`${base2}/api/vaults/v2/entries/${eid}/groundings`, { ownerUid: 'v2', placeId: 'ChIJX' });
    assert.equal(g.status, 201);
    assert.equal((g.json.grounding as { name: string }).name, 'ChIJX');
    assert.equal((g.json.grounding as { attributions: string }).attributions, 'Powered by Google');
  });
});

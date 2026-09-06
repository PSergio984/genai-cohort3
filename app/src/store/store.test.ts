// Store tests: JournalStore contract against the Firestore emulator.
// Admin SDK bypasses rules by design — isolation ENFORCEMENT is covered by
// tests/firestore (rules suite); here we verify query shape, ordering,
// read-through caching, and backend-computed expiry.
// Run under the emulator (host/port mirror firebase.json):
//   firebase emulators:exec --only firestore --project=demo-grounded-journal \
//     "npm test --prefix app"   (or the app suite, which includes this file)
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  createFirestoreStore,
  type FirestoreDeps,
} from './firestore.js';
import {
  computeExpiresAt,
  isStale,
  CORE_TTL_MS,
  VOLATILE_TTL_MS,
  MS_PER_DAY,
  type EntryRecord,
  type JournalStore,
} from './repository.js';

const iso = (ms: number): string => new Date(ms).toISOString();
const T0 = Date.parse('2026-09-04T00:00:00.000Z');

let store: JournalStore;
let vaultSeq = 0;
const freshVault = (): string => `vault-test-${++vaultSeq}`;

function entry(over: Partial<EntryRecord> = {}): EntryRecord {
  return {
    ownerUid: 'alice',
    text: 'seed entry',
    placeIds: [],
    groundingSnapshots: [],
    turns: [],
    createdAt: iso(T0),
    ...over,
  };
}

before(() => {
  if (getApps().length === 0) {
    initializeApp({ projectId: 'demo-grounded-journal' });
  }
  const deps: FirestoreDeps = { db: getFirestore() };
  store = createFirestoreStore(deps);
});

describe('pure policy helpers', () => {
  it('core expiry is fetchedAt + 7d, volatile + 24h', () => {
    assert.equal(computeExpiresAt(T0), T0 + 7 * MS_PER_DAY);
    assert.equal(computeExpiresAt(T0, 'volatile'), T0 + 1 * MS_PER_DAY);
    assert.equal(CORE_TTL_MS, 7 * MS_PER_DAY);
    assert.equal(VOLATILE_TTL_MS, MS_PER_DAY);
  });

  it('computed expiry never breaches the 30-day ceiling', () => {
    assert.ok(computeExpiresAt(T0) <= T0 + 30 * MS_PER_DAY);
    assert.ok(computeExpiresAt(T0, 'volatile') <= T0 + 30 * MS_PER_DAY);
  });

  it('stale is strict: expiresAt == now refetches', () => {
    assert.equal(isStale(T0 - 1, T0), true);
    assert.equal(isStale(T0, T0), true);
    assert.equal(isStale(T0 + 1, T0), false);
  });
});

describe('saveEntry / listEntries', () => {
  it('roundtrips an entry and returns its id', async () => {
    const v = freshVault();
    const id = await store.saveEntry(v, entry({ text: 'hello' }));
    assert.ok(typeof id === 'string' && id.length > 0);
    const listed = await store.listEntries(v, 'alice', 10);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, id);
    assert.equal(listed[0]?.entry.text, 'hello');
  });

  it('lists newest-first', async () => {
    const v = freshVault();
    await store.saveEntry(v, entry({ text: 'old', createdAt: iso(T0) }));
    await store.saveEntry(v, entry({ text: 'new', createdAt: iso(T0 + 1000) }));
    const listed = await store.listEntries(v, 'alice', 10);
    assert.deepEqual(
      listed.map((e) => e.entry.text),
      ['new', 'old'],
    );
  });

  it('filters by ownerUid', async () => {
    const v = freshVault();
    await store.saveEntry(v, entry({ ownerUid: 'alice', text: 'a' }));
    const listed = await store.listEntries(v, 'bob', 10);
    assert.equal(listed.length, 0);
  });

  it('saveEntry into another owner vault rejects', async () => {
    const v = freshVault();
    await store.saveEntry(v, entry({ ownerUid: 'alice', text: 'a' }));
    await assert.rejects(store.saveEntry(v, entry({ ownerUid: 'bob', text: 'b' })), /owner mismatch/);
  });

  it('saveEntry preserves existing Vault fields (no clobber)', async () => {
    const v = freshVault();
    await store.saveEntry(v, entry({ ownerUid: 'alice', text: 'a' }));
    await store.saveEntry(v, entry({ ownerUid: 'alice', text: 'b' }));
    const db = getFirestore();
    const snap = await db.doc(`vaults/${v}`).get();
    assert.equal((snap.data() as { ownerUid: string }).ownerUid, 'alice');
  });

  it('appendGrounding stores snapshot + placeId', async () => {
    const v = freshVault();
    const id = await store.saveEntry(v, entry());
    await store.appendGrounding(v, id, 'alice', {
      placeId: 'ChIJX',
      name: 'Rizal Park',
      address: 'Manila',
      attributions: 'Powered by Google',
      fetchedAt: iso(T0),
    });
    const listed = await store.listEntries(v, 'alice', 10);
    assert.deepEqual(listed[0]?.entry.placeIds, ['ChIJX']);
    assert.equal(listed[0]?.entry.groundingSnapshots.length, 1);
    assert.equal(listed[0]?.entry.groundingSnapshots[0]?.name, 'Rizal Park');
  });

  it('appendGrounding is idempotent on placeId', async () => {
    const v = freshVault();
    const id = await store.saveEntry(v, entry());
    const snap = {
      placeId: 'ChIJX',
      name: 'Rizal Park',
      address: 'Manila',
      attributions: 'Powered by Google',
      fetchedAt: iso(T0),
    };
    await store.appendGrounding(v, id, 'alice', snap);
    await store.appendGrounding(v, id, 'alice', snap);
    const listed = await store.listEntries(v, 'alice', 10);
    assert.deepEqual(listed[0]?.entry.placeIds, ['ChIJX']);
    assert.equal(listed[0]?.entry.groundingSnapshots.length, 1);
  });

  it('appendGrounding by another owner rejects', async () => {
    const v = freshVault();
    const id = await store.saveEntry(v, entry());
    await assert.rejects(
      store.appendGrounding(v, id, 'bob', {
        placeId: 'ChIJX',
        name: 'X',
        address: '',
        attributions: '',
        fetchedAt: iso(T0),
      }),
      /owner mismatch/,
    );
  });

  it('appendGrounding on a missing entry rejects', async () => {
    const v = freshVault();
    await store.saveEntry(v, entry());
    await assert.rejects(
      store.appendGrounding(v, 'nope', 'alice', {
        placeId: 'ChIJX',
        name: 'X',
        address: '',
        attributions: '',
        fetchedAt: iso(T0),
      }),
      /not found/,
    );
  });

  it('respects limit', async () => {
    const v = freshVault();
    await store.saveEntry(v, entry({ text: 'one', createdAt: iso(T0) }));
    await store.saveEntry(v, entry({ text: 'two', createdAt: iso(T0 + 1000) }));
    const listed = await store.listEntries(v, 'alice', 1);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.entry.text, 'two');
  });

  it('saveEntry creates the parent Vault doc (reads need it)', async () => {
    const v = freshVault();
    await store.saveEntry(v, entry());
    const db = getFirestore();
    const snap = await db.doc(`vaults/${v}`).get();
    assert.equal(snap.exists, true);
    assert.equal((snap.data() as { ownerUid: string }).ownerUid, 'alice');
  });

  it('getEntry returns the record for the owner', async () => {
    const v = freshVault();
    const id = await store.saveEntry(v, entry({ text: 'mine' }));
    const got = await store.getEntry(v, id, 'alice');
    assert.equal(got?.text, 'mine');
  });

  it('getEntry is null for missing ids and foreign owners alike', async () => {
    const v = freshVault();
    const id = await store.saveEntry(v, entry());
    assert.equal(await store.getEntry(v, 'nope', 'alice'), null);
    assert.equal(await store.getEntry(v, id, 'bob'), null);
  });

  it('appendTurns stores user and model turns with audit placeIds', async () => {
    const v = freshVault();
    const id = await store.saveEntry(v, entry());
    await store.appendTurns(v, id, 'alice', [
      { by: 'user', text: 'follow-up?', placeIds: [] },
      { by: 'model', text: 'grounded words', placeIds: ['ChIJX'] },
    ]);
    const listed = await store.listEntries(v, 'alice', 10);
    assert.deepEqual(listed[0]?.entry.turns, [
      { by: 'user', text: 'follow-up?', placeIds: [] },
      { by: 'model', text: 'grounded words', placeIds: ['ChIJX'] },
    ]);
  });

  it('repeat identical turns are all recorded', async () => {
    const v = freshVault();
    const id = await store.saveEntry(v, entry());
    await store.appendTurns(v, id, 'alice', [{ by: 'model', text: 'same words', placeIds: [] }]);
    await store.appendTurns(v, id, 'alice', [{ by: 'model', text: 'same words', placeIds: [] }]);
    const listed = await store.listEntries(v, 'alice', 10);
    assert.deepEqual(
      listed[0]?.entry.turns.map((t) => t.text),
      ['same words', 'same words'],
    );
  });

  it('appendTurns with an empty batch is a no-op', async () => {
    const v = freshVault();
    const id = await store.saveEntry(v, entry());
    await store.appendTurns(v, id, 'alice', []);
    const listed = await store.listEntries(v, 'alice', 10);
    assert.deepEqual(listed[0]?.entry.turns, []);
  });

  it('appendTurns by another owner rejects', async () => {
    const v = freshVault();
    const id = await store.saveEntry(v, entry());
    await assert.rejects(
      store.appendTurns(v, id, 'bob', [{ by: 'user', text: 'hijack', placeIds: [] }]),
      /owner mismatch/,
    );
  });

  it('appendTurns on a missing entry rejects', async () => {
    const v = freshVault();
    await assert.rejects(
      store.appendTurns(v, 'nope', 'alice', [{ by: 'user', text: 'x', placeIds: [] }]),
      /not found/,
    );
  });

  it('removeGrounding drops one place before any model turn', async () => {
    const v = freshVault();
    const id = await store.saveEntry(v, entry());
    const snap = {
      placeId: 'ChIJX',
      name: 'Rizal Park',
      address: 'Manila',
      attributions: 'Powered by Google',
      fetchedAt: iso(T0),
    };
    await store.appendGrounding(v, id, 'alice', snap);
    await store.appendGrounding(v, id, 'alice', { ...snap, placeId: 'ChIJY', name: 'Cafe' });
    await store.removeGrounding(v, id, 'alice', 'ChIJX');
    const listed = await store.listEntries(v, 'alice', 10);
    assert.deepEqual(listed[0]?.entry.placeIds, ['ChIJY']);
    assert.equal(listed[0]?.entry.groundingSnapshots.length, 1);
  });

  it('removeGrounding an unattached place is a no-op', async () => {
    const v = freshVault();
    const id = await store.saveEntry(v, entry());
    await store.removeGrounding(v, id, 'alice', 'ChIJNOPE');
    const listed = await store.listEntries(v, 'alice', 10);
    assert.deepEqual(listed[0]?.entry.placeIds, []);
  });

  it('removeGrounding after a model turn refuses (frozen)', async () => {
    const v = freshVault();
    const id = await store.saveEntry(v, entry());
    await store.appendGrounding(v, id, 'alice', {
      placeId: 'ChIJX',
      name: 'Rizal Park',
      address: 'Manila',
      attributions: 'Powered by Google',
      fetchedAt: iso(T0),
    });
    await store.appendTurns(v, id, 'alice', [{ by: 'model', text: 'r1', placeIds: ['ChIJX'] }]);
    await assert.rejects(store.removeGrounding(v, id, 'alice', 'ChIJX'), /frozen/);
  });

  it('removeGrounding by another owner rejects', async () => {
    const v = freshVault();
    const id = await store.saveEntry(v, entry());
    await assert.rejects(store.removeGrounding(v, id, 'bob', 'ChIJX'), /owner mismatch/);
  });

  it('removeGrounding on a missing entry rejects', async () => {
    const v = freshVault();
    await assert.rejects(store.removeGrounding(v, 'nope', 'alice', 'ChIJX'), /not found/);
  });
});

describe('getPlace read-through cache', () => {
  const place = { placeJson: { name: 'Rizal Park' }, fetchedAtMs: T0 };

  it('missing entry fetches once and persists backend-computed expiry', async () => {
    const v = freshVault();
    let calls = 0;
    const got = await store.getPlace(v, 'p1', async () => {
      calls++;
      return place;
    }, T0);
    assert.equal(calls, 1);
    assert.equal(got.fetchedAt, iso(T0));
    assert.equal(got.expiresAt, iso(T0 + CORE_TTL_MS));
  });

  it('fresh hit never calls the fetcher', async () => {
    const v = freshVault();
    await store.getPlace(v, 'p1', async () => place, T0);
    let calls = 0;
    const got = await store.getPlace(
      v,
      'p1',
      async () => {
        calls++;
        return place;
      },
      T0 + 1000,
    );
    assert.equal(calls, 0);
    assert.deepEqual(got.placeJson, { name: 'Rizal Park' });
  });

  it('stale entry refetches and persists the new snapshot', async () => {
    const v = freshVault();
    await store.getPlace(v, 'p1', async () => place, T0);
    const updated = { placeJson: { name: 'Rizal Park (revised)' }, fetchedAtMs: T0 + 8 * MS_PER_DAY };
    const got = await store.getPlace(v, 'p1', async () => updated, T0 + 8 * MS_PER_DAY);
    assert.deepEqual(got.placeJson, { name: 'Rizal Park (revised)' });
    assert.equal(got.expiresAt, iso(T0 + 8 * MS_PER_DAY + CORE_TTL_MS));
  });

  it('expiry exactly now counts as stale (strict boundary)', async () => {
    const v = freshVault();
    await store.getPlace(v, 'p1', async () => place, T0);
    let calls = 0;
    await store.getPlace(
      v,
      'p1',
      async () => {
        calls++;
        return place;
      },
      T0 + CORE_TTL_MS,
    );
    assert.equal(calls, 1);
  });

  it('fetcher errors propagate so callers degrade to ungrounded', async () => {
    const v = freshVault();
    await assert.rejects(
      store.getPlace(v, 'p9', async () => {
        throw new Error('maps down');
      }),
      /maps down/,
    );
  });

  it('getCachedPlace returns the stored record without fetching', async () => {
    const v = freshVault();
    let calls = 0;
    await store.getPlace(
      v,
      'p1',
      async () => {
        calls++;
        return { placeJson: { name: 'Cached' }, fetchedAtMs: T0 };
      },
      T0,
    );
    const got = await store.getCachedPlace(v, 'p1');
    assert.deepEqual((got?.placeJson as { name: string }).name, 'Cached');
    assert.equal(calls, 1);
  });

  it('getCachedPlace is null on a miss', async () => {
    assert.equal(await store.getCachedPlace(freshVault(), 'nope'), null);
  });
});

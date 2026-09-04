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
    geminiReflection: null,
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
    assert.equal(listed[0]?.text, 'hello');
  });

  it('lists newest-first', async () => {
    const v = freshVault();
    await store.saveEntry(v, entry({ text: 'old', createdAt: iso(T0) }));
    await store.saveEntry(v, entry({ text: 'new', createdAt: iso(T0 + 1000) }));
    const listed = await store.listEntries(v, 'alice', 10);
    assert.deepEqual(
      listed.map((e) => e.text),
      ['new', 'old'],
    );
  });

  it('filters by ownerUid', async () => {
    const v = freshVault();
    await store.saveEntry(v, entry({ ownerUid: 'alice', text: 'a' }));
    await store.saveEntry(v, entry({ ownerUid: 'bob', text: 'b' }));
    const listed = await store.listEntries(v, 'alice', 10);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.text, 'a');
  });

  it('respects limit', async () => {
    const v = freshVault();
    await store.saveEntry(v, entry({ text: 'one', createdAt: iso(T0) }));
    await store.saveEntry(v, entry({ text: 'two', createdAt: iso(T0 + 1000) }));
    const listed = await store.listEntries(v, 'alice', 1);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.text, 'two');
  });

  it('saveEntry creates the parent Vault doc (reads need it)', async () => {
    const v = freshVault();
    await store.saveEntry(v, entry());
    const db = getFirestore();
    const snap = await db.doc(`vaults/${v}`).get();
    assert.equal(snap.exists, true);
    assert.equal((snap.data() as { ownerUid: string }).ownerUid, 'alice');
  });

  it('saveReflection stores text on the entry', async () => {
    const v = freshVault();
    const id = await store.saveEntry(v, entry());
    await store.saveReflection(v, id, 'alice', 'grounded words');
    const listed = await store.listEntries(v, 'alice', 10);
    assert.equal(listed[0]?.geminiReflection, 'grounded words');
  });

  it('saveReflection by another owner rejects', async () => {
    const v = freshVault();
    const id = await store.saveEntry(v, entry());
    await assert.rejects(store.saveReflection(v, id, 'bob', 'hijack'), /owner mismatch/);
  });

  it('saveReflection on a missing entry rejects', async () => {
    const v = freshVault();
    await assert.rejects(store.saveReflection(v, 'nope', 'alice', 'x'), /not found/);
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
});

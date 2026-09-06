// Firestore implementation of JournalStore (ADR-0001 schema).
// Single responsibility — Firestore mechanics only; policy lives in
// repository.ts, transition rules in domain/journal.ts. Uses the
// `grounded-journal` database; Vault isolation is enforced by
// firestore.rules, mirrored here by always scoping under the Vault.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import {
  computeExpiresAt,
  isStale,
  type EntryRecord,
  type EntryRef,
  type FetchedPlace,
  type GroundingSnapshot,
  type JournalStore,
  type PlaceCacheRecord,
} from './repository.js';

export const DATABASE_ID = 'grounded-journal';

export interface FirestoreDeps {
  readonly db: Firestore;
}

export function createDeps(projectId: string): FirestoreDeps {
  const app = initializeApp({ projectId });
  return { db: getFirestore(app, DATABASE_ID) };
}

function vaultDoc(db: Firestore, vaultId: string) {
  return db.doc(`vaults/${vaultId}`);
}

/**
 * Load an entry inside a transaction, verifying ownership. Single home for
 * the read + owner-mismatch guard the transactional writers share (defense
 * in depth — the Admin SDK bypasses firestore.rules).
 */
async function requireOwnedEntry(
  tx: Transaction,
  db: Firestore,
  vaultId: string,
  entryId: string,
  ownerUid: string,
): Promise<EntryRecord> {
  const snap = await tx.get(entriesCol(db, vaultId).doc(entryId));
  const data = snap.data() as EntryRecord | undefined;
  if (data === undefined) {
    throw new Error(`entry not found: vaults/${vaultId}/entries/${entryId}`);
  }
  if (data.ownerUid !== ownerUid) {
    throw new Error(`owner mismatch: entry belongs to another Vault owner`);
  }
  return data;
}

function entriesCol(db: Firestore, vaultId: string) {
  return db.collection(`vaults/${vaultId}/entries`);
}

function placeDoc(db: Firestore, vaultId: string, placeId: string) {
  return db.doc(`vaults/${vaultId}/placeCache/${placeId}`);
}

export function createFirestoreStore({ db }: FirestoreDeps): JournalStore {
  return {
    async saveEntry(vaultId, entry): Promise<string> {
      // Parent Vault must exist and agree on ownership: the rules' owner
      // check reads it, so an entry without a parent would be unreadable
      // through client SDKs — and a hostile caller must not re-home a Vault.
      const parent = await vaultDoc(db, vaultId).get();
      if (parent.exists) {
        const owner = (parent.data() as { ownerUid?: unknown }).ownerUid;
        if (owner !== entry.ownerUid) {
          throw new Error(`owner mismatch: vault belongs to another owner`);
        }
      } else {
        await vaultDoc(db, vaultId).set({ ownerUid: entry.ownerUid });
      }
      const ref = await entriesCol(db, vaultId).add({ ...entry });
      return ref.id;
    },

    async listEntries(vaultId, ownerUid, limit): Promise<EntryRef[]> {
      // Matches the composite index: ownerUid ASC + createdAt DESC.
      const snap = await entriesCol(db, vaultId)
        .where('ownerUid', '==', ownerUid)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map((d) => ({ id: d.id, entry: d.data() as EntryRecord }));
    },

    async getEntry(vaultId, entryId, ownerUid): Promise<EntryRecord | null> {
      const snap = await entriesCol(db, vaultId).doc(entryId).get();
      const data = snap.data() as EntryRecord | undefined;
      // Missing or foreign: identical null, so existence is not oracle-able.
      if (data === undefined || data.ownerUid !== ownerUid) {
        return null;
      }
      return data;
    },

    async appendTurns(vaultId, entryId, ownerUid, turns): Promise<void> {
      // Defense in depth: the Admin SDK bypasses firestore.rules, so the
      // store verifies ownership itself instead of trusting the caller.
      // Transactional read-modify-write (not arrayUnion): identical repeat
      // texts are distinct turns and must all be recorded.
      if (turns.length === 0) {
        return;
      }
      const ref = entriesCol(db, vaultId).doc(entryId);
      await db.runTransaction(async (tx) => {
        const data = await requireOwnedEntry(tx, db, vaultId, entryId, ownerUid);
        tx.update(ref, { turns: [...(data.turns ?? []), ...turns] });
      });
    },

    async removeGrounding(vaultId, entryId, ownerUid, placeId): Promise<void> {
      const ref = entriesCol(db, vaultId).doc(entryId);
      await db.runTransaction(async (tx) => {
        const data = await requireOwnedEntry(tx, db, vaultId, entryId, ownerUid);
        // Domain freeze rule, enforced server-side too: the first model
        // turn seals the Groundings (the route checks first for a clean 409).
        if (data.turns.some((t) => t.by === 'model')) {
          throw new Error(`REFUSED: Grounding is frozen — a Reflection already exists.`);
        }
        tx.update(ref, {
          placeIds: data.placeIds.filter((id) => id !== placeId),
          groundingSnapshots: data.groundingSnapshots.filter((s) => s.placeId !== placeId),
        });
      });
    },

    async appendGrounding(vaultId, entryId, ownerUid, snapshot: GroundingSnapshot): Promise<void> {
      const ref = entriesCol(db, vaultId).doc(entryId);
      // Transaction: the duplicate check and the write are atomic, so two
      // concurrent attaches of the same place cannot double-append.
      await db.runTransaction(async (tx) => {
        const data = await requireOwnedEntry(tx, db, vaultId, entryId, ownerUid);
        // Idempotent on placeId: duplicate attaches are refused upstream, and
        // a retry must not double-append.
        if (data.placeIds.includes(snapshot.placeId)) {
          return;
        }
        tx.update(ref, {
          placeIds: FieldValue.arrayUnion(snapshot.placeId),
          groundingSnapshots: FieldValue.arrayUnion({ ...snapshot }),
        });
      });
    },

    async getCachedPlace(vaultId, placeId): Promise<PlaceCacheRecord | null> {
      const snap = await placeDoc(db, vaultId, placeId).get();
      if (!snap.exists) {
        return null;
      }
      return snap.data() as PlaceCacheRecord;
    },

    async getPlace(vaultId, placeId, fetch, nowMs = Date.now()): Promise<PlaceCacheRecord> {
      const ref = placeDoc(db, vaultId, placeId);
      const existing = await ref.get();
      if (existing.exists) {
        const data = existing.data() as PlaceCacheRecord;
        const expiresMs = Date.parse(data.expiresAt);
        if (!isStale(expiresMs, nowMs)) {
          return data;
        }
      }
      const fetched: FetchedPlace = await fetch(placeId);
      const record = buildRecord(fetched);
      await ref.set(record);
      return record;
    },

    // Record clock comes from the fetch itself, backend-computed like getPlace.
    async refreshPlace(vaultId, placeId, fetch): Promise<PlaceCacheRecord | null> {
      const ref = placeDoc(db, vaultId, placeId);
      if (!(await ref.get()).exists) {
        return null;
      }
      const fetched: FetchedPlace = await fetch(placeId);
      const record = buildRecord(fetched);
      await ref.set(record);
      return record;
    },
  };
}

/** Shape a fetch into the persisted record: backend-computed clocks, one shape. */
function buildRecord(fetched: FetchedPlace): PlaceCacheRecord {
  return {
    placeJson: fetched.placeJson,
    fetchedAt: new Date(fetched.fetchedAtMs).toISOString(),
    expiresAt: new Date(computeExpiresAt(fetched.fetchedAtMs)).toISOString(),
  };
}

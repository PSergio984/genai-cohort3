// Firestore implementation of JournalStore (ADR-0001 schema).
// Single responsibility — Firestore mechanics only; policy lives in
// repository.ts, transition rules in domain/journal.ts. Uses the
// `grounded-journal` database; Vault isolation is enforced by
// firestore.rules, mirrored here by always scoping under the Vault.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  computeExpiresAt,
  isStale,
  type EntryRecord,
  type FetchedPlace,
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

function entriesCol(db: Firestore, vaultId: string) {
  return db.collection(`vaults/${vaultId}/entries`);
}

function placeDoc(db: Firestore, vaultId: string, placeId: string) {
  return db.doc(`vaults/${vaultId}/placeCache/${placeId}`);
}

export function createFirestoreStore({ db }: FirestoreDeps): JournalStore {
  return {
    async saveEntry(vaultId, entry): Promise<string> {
      // Parent Vault must exist: the rules' owner check reads it, so an
      // entry without a parent would be unreadable through client SDKs.
      // Merge-write is idempotent and never clobbers existing Vault fields.
      await vaultDoc(db, vaultId).set({ ownerUid: entry.ownerUid }, { merge: true });
      const ref = await entriesCol(db, vaultId).add({ ...entry });
      return ref.id;
    },

    async listEntries(vaultId, ownerUid, limit): Promise<EntryRecord[]> {
      // Matches the composite index: ownerUid ASC + createdAt DESC.
      const snap = await entriesCol(db, vaultId)
        .where('ownerUid', '==', ownerUid)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map((d) => d.data() as EntryRecord);
    },

    async saveReflection(vaultId, entryId, ownerUid, text): Promise<void> {
      // Defense in depth: the Admin SDK bypasses firestore.rules, so the
      // store verifies ownership itself instead of trusting the caller.
      // (Owner identity is enforced by the rules on the merged document
      // for client paths; this guard covers server paths.)
      const snap = await entriesCol(db, vaultId).doc(entryId).get();
      const data = snap.data() as EntryRecord | undefined;
      if (data === undefined) {
        throw new Error(`entry not found: vaults/${vaultId}/entries/${entryId}`);
      }
      if (data.ownerUid !== ownerUid) {
        throw new Error(`owner mismatch: entry belongs to another Vault owner`);
      }
      // Owner identity is enforced by the rules on the merged document
      // (ownerUid untouched); only the reflection text is written.
      await entriesCol(db, vaultId).doc(entryId).update({ geminiReflection: text });
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
      const record: PlaceCacheRecord = {
        placeJson: fetched.placeJson,
        fetchedAt: new Date(fetched.fetchedAtMs).toISOString(),
        expiresAt: new Date(computeExpiresAt(fetched.fetchedAtMs)).toISOString(),
      };
      await ref.set(record);
      return record;
    },
  };
}

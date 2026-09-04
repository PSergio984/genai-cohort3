// Persistence seam: contracts for Vault-scoped storage (ADR-0001).
// Single responsibility — shapes and policy live here; the Firestore
// mechanics live in firestore.ts; callers depend only on these interfaces
// (dependency inversion: domain and routes never import firebase-admin).

export const MS_PER_DAY = 864e5;
/** Core place facts target (ADR-0001): 7 days. Volatile fields: 1 day. */
export const CORE_TTL_MS = 7 * MS_PER_DAY;
export const VOLATILE_TTL_MS = 1 * MS_PER_DAY;

/** Backend-computed expiry (R2Q2 decision): clients never propose it. */
export function computeExpiresAt(fetchedAtMs: number, kind: 'core' | 'volatile' = 'core'): number {
  return fetchedAtMs + (kind === 'core' ? CORE_TTL_MS : VOLATILE_TTL_MS);
}

/** Stale when expired: mirrors the rules' `expiresAt > request.time` strictly. */
export function isStale(expiresAtMs: number, nowMs: number): boolean {
  return expiresAtMs <= nowMs;
}

export interface GroundingSnapshot {
  readonly placeId: string;
  readonly name: string;
  readonly address: string;
  readonly attributions: string;
  readonly fetchedAt: string;
}

export interface EntryRecord {
  readonly ownerUid: string;
  readonly text: string;
  readonly placeIds: readonly string[];
  readonly groundingSnapshots: readonly GroundingSnapshot[];
  readonly geminiReflection: string | null;
  readonly createdAt: string;
}

export interface PlaceCacheRecord {
  readonly placeJson: unknown;
  readonly fetchedAt: string;
  readonly expiresAt: string;
}

/** Minimal place shape the store needs back from a fetch (Maps seam provides it). */
export interface FetchedPlace {
  readonly placeJson: unknown;
  readonly fetchedAtMs: number;
}

export interface JournalStore {
  /** Persist an Entry; returns the new entry id. */
  saveEntry(vaultId: string, entry: EntryRecord): Promise<string>;
  /** Newest-first history for one Vault (single indexed query). */
  listEntries(vaultId: string, ownerUid: string, limit: number): Promise<EntryRecord[]>;
  /** Append a Reflection text to an Entry. */
  saveReflection(vaultId: string, entryId: string, ownerUid: string, text: string): Promise<void>;
  /**
   * Read-through place cache: fresh hit returns stored data without calling
   * `fetch`; stale or missing entries fetch, persist with backend-computed
   * expiry, then return. Never throws on a cache problem — fetch errors
   * propagate so callers can degrade to ungrounded.
   */
  getPlace(
    vaultId: string,
    placeId: string,
    fetch: (placeId: string) => Promise<FetchedPlace>,
    nowMs?: number,
  ): Promise<PlaceCacheRecord>;
}

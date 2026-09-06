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

/**
 * One message in a Session's thread. Model turns freeze the placeIds they
 * saw at reflect time — the per-reflection audit trail (spec: "see the exact
 * place snapshot a Reflection was based on"). User turns carry the entry's
 * placeIds likewise (what the conversation could see).
 */
export interface TurnRecord {
  readonly by: 'user' | 'model';
  readonly text: string;
  readonly placeIds: readonly string[];
}

export interface EntryRecord {
  readonly ownerUid: string;
  readonly text: string;
  readonly placeIds: readonly string[];
  readonly groundingSnapshots: readonly GroundingSnapshot[];
  /** Append-only thread: every turn recorded, never overwritten. */
  readonly turns: readonly TurnRecord[];
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

export interface EntryRef {
  readonly id: string;
  readonly entry: EntryRecord;
}

export interface JournalStore {
  /** Persist an Entry; returns the new entry id. Creates the parent Vault on first use, rejects on owner mismatch. */
  saveEntry(vaultId: string, entry: EntryRecord): Promise<string>;
  /** Newest-first history for one Vault (single indexed query), with ids for pins and follow-up calls. */
  listEntries(vaultId: string, ownerUid: string, limit: number): Promise<EntryRef[]>;
  /** Read one Entry; null when missing OR owned by someone else (no oracle). */
  getEntry(vaultId: string, entryId: string, ownerUid: string): Promise<EntryRecord | null>;
  /**
   * Append Turns to an Entry's thread (user follow-ups and/or the model
   * reply). Verifies ownership first. Transactional: identical repeat texts
   * are distinct turns and must all be recorded.
   */
  appendTurns(vaultId: string, entryId: string, ownerUid: string, turns: TurnRecord[]): Promise<void>;
  /**
   * Remove one Grounding by place id (fixes a wrong pick). Refuses once any
   * model turn exists — the first Reflection seals the Groundings.
   * Idempotent on unknown placeIds.
   */
  removeGrounding(vaultId: string, entryId: string, ownerUid: string, placeId: string): Promise<void>;
  /**
   * Append a frozen Grounding snapshot to an Entry (idempotent on placeId).
   * Verifies entry ownership first — the Admin SDK bypasses firestore.rules.
   */
  appendGrounding(
    vaultId: string,
    entryId: string,
    ownerUid: string,
    snapshot: GroundingSnapshot,
  ): Promise<void>;
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
  /**
   * Cache read for display (history, inline cards): returns the stored
   * record or null. Never fetches — display reads cost zero API quota.
   */
  getCachedPlace(vaultId: string, placeId: string): Promise<PlaceCacheRecord | null>;
}

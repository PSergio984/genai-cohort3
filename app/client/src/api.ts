// HTTP client for our own API only. Same paths and payloads the vanilla
// frontend used; the browser never holds a Maps or Gemini key. The Firebase
// ID token rides every call as a Bearer token and the server derives the
// Vault from it (one Vault per user).
import type {
  EntryRecord,
  GroundingSnapshot,
  HistoryRow,
  PlaceDetails,
  Prediction,
  Turn,
} from './types.js';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ApiClient {
  saveEntry(text: string): Promise<string>;
  listEntries(limit: number): Promise<HistoryRow[]>;
  getEntry(entryId: string): Promise<{ id: string; entry: EntryRecord }>;
  groundPlace(entryId: string, placeId: string, sessionToken: string): Promise<GroundingSnapshot>;
  reflect(entryId: string, history?: Turn[]): Promise<string>;
  removeGrounding(entryId: string, placeId: string): Promise<void>;
  getPlaceDetails(placeId: string): Promise<PlaceDetails>;
  /** Explicit one-place refresh (one Places fetch): upgrades records cached
   *  before a schema gain so legacy groundings can pin. Throws on 404. */
  refreshPlace(placeId: string): Promise<PlaceDetails>;
  autocomplete(query: string, sessionToken: string): Promise<Prediction[]>;
}

export function createApiClient(
  vaultId: string,
  getToken: (forceRefresh: boolean) => Promise<string>,
): ApiClient {
  const base = `/api/vaults/${encodeURIComponent(vaultId)}`;

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const doFetch = async (token: string): Promise<Response> =>
      fetch(path, {
        ...init,
        headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
      });
    let res = await doFetch(await getToken(false));
    if (res.status === 401) {
      // Token may have expired mid-session: force-refresh once and retry.
      res = await doFetch(await getToken(true));
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
    }
    return body as T;
  }

  const postJson = <T>(path: string, payload: unknown): Promise<T> =>
    call<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

  return {
    async saveEntry(text: string): Promise<string> {
      const out = await postJson<{ id: string }>(`${base}/entries`, { text });
      return out.id;
    },
    async listEntries(limit: number): Promise<HistoryRow[]> {
      const out = await call<{ entries: HistoryRow[] }>(`${base}/entries?limit=${limit}`);
      return (out.entries ?? []).map((row) => ({ id: row.id, entry: normalizeEntry(row.entry) }));
    },
    async getEntry(entryId: string): Promise<{ id: string; entry: EntryRecord }> {
      const out = await call<{ id: string; entry: EntryRecord }>(
        `${base}/entries/${encodeURIComponent(entryId)}`,
      );
      return { id: out.id, entry: normalizeEntry(out.entry) };
    },
    async groundPlace(
      entryId: string,
      placeId: string,
      sessionToken: string,
    ): Promise<GroundingSnapshot> {
      const out = await postJson<{ grounding: GroundingSnapshot }>(
        `${base}/entries/${encodeURIComponent(entryId)}/groundings`,
        { placeId, sessionToken },
      );
      return out.grounding;
    },
    async reflect(entryId: string, history?: Turn[]): Promise<string> {
      const out = await postJson<{ reflection: string }>(
        `${base}/entries/${encodeURIComponent(entryId)}/reflections`,
        history === undefined ? {} : { history },
      );
      return out.reflection;
    },
    async removeGrounding(entryId: string, placeId: string): Promise<void> {
      await call<{ removed: boolean }>(
        `${base}/entries/${encodeURIComponent(entryId)}/groundings/${encodeURIComponent(placeId)}`,
        { method: 'DELETE' },
      );
    },
    async getPlaceDetails(placeId: string): Promise<PlaceDetails> {
      // Cache-only display read: zero quota by design, explicit expand only.
      const out = await call<{ details: PlaceDetails }>(
        `${base}/places/${encodeURIComponent(placeId)}`,
      );
      return out.details;
    },
    async refreshPlace(placeId: string): Promise<PlaceDetails> {
      const out = await call<{ details: PlaceDetails }>(
        `${base}/places/${encodeURIComponent(placeId)}/refresh`,
        { method: 'POST' },
      );
      return out.details;
    },
    async autocomplete(query: string, sessionToken: string): Promise<Prediction[]> {
      const out = await postJson<{ predictions: Prediction[] }>('/api/places/autocomplete', {
        query,
        sessionToken,
      });
      return out.predictions ?? [];
    },
  };
}

export function newSessionToken(): string {
  return `sess-${Math.random().toString(36).slice(2, 12)}`;
}

// Older vault entries predate newer fields (e.g. turns). Normalize at the
// seam so rendering never meets undefined where it maps or measures.
export function normalizeEntry(entry: EntryRecord): EntryRecord {
  return {
    text: typeof entry.text === 'string' ? entry.text : '',
    placeIds: Array.isArray(entry.placeIds) ? entry.placeIds : [],
    groundingSnapshots: Array.isArray(entry.groundingSnapshots) ? entry.groundingSnapshots : [],
    turns: Array.isArray(entry.turns) ? entry.turns : [],
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
  };
}

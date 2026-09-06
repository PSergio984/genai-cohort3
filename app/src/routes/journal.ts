// HTTP boundary: journal routes (entries, groundings, reflections).
// Single responsibility — HTTP translation only: validation, status mapping,
// and seam orchestration. Transition rules live in domain/journal.ts,
// persistence in the store, prompts in gemini/. Depends on seam interfaces,
// never on firebase-admin, the Places wire, or the Gen AI SDK directly.
//
// Auth: every route sits behind requireAuth (Firebase ID token → uid).
// Callers address only their own Vault (vaultId === uid); the store
// re-verifies ownership on every write (defense in depth — the Admin SDK
// bypasses firestore.rules).
import { Router, type Request, type Response } from 'express';
import { requireAuth, type TokenVerifier } from '../auth.js';
import type { IGeminiClient } from '../gemini/client.js';
import { QuotaDepletedError, TransientGeminiError } from '../gemini/client.js';
import { reflect } from '../gemini/reflector.js';
import type { Turn } from '../domain/journal.js';
import type { PlaceDetails } from '../places/places.js';
import type {
  FetchedPlace,
  GroundingSnapshot,
  JournalStore,
  PlaceCacheRecord,
  TurnRecord,
} from '../store/repository.js';

export interface JournalDeps {
  readonly store: JournalStore;
  /** Place resolution honoring the store cache (production: store.getPlace + CORE fetch). */
  readonly fetchPlace: (placeId: string, sessionToken?: string) => Promise<FetchedPlace>;
  readonly gemini: IGeminiClient;
  readonly verify: TokenVerifier;
}

const MAX_TEXT = 5000;
const MAX_HISTORY = 20;

function sendError(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

/** Path params are strings by route contract; reject loudly otherwise. */
function pathParam(res: Response, value: unknown, name: string): string | undefined {
  if (typeof value !== 'string' || value === '') {
    sendError(res, 400, `${name} is required`);
    return undefined;
  }
  return value;
}

/** One Vault per user: the path vault must be the authenticated caller's. */
function checkVault(res: Response, vaultId: string, req: Request): req is Request & { ownerUid: string } {
  if (req.ownerUid === undefined || req.ownerUid !== vaultId) {
    sendError(res, 400, 'vault/owner mismatch (one Vault per user)');
    return false;
  }
  return true;
}

function checkText(text: unknown, res: Response): text is string {
  if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_TEXT) {
    sendError(res, 400, `text must be 1..${MAX_TEXT} chars`);
    return false;
  }
  return true;
}

function checkHistory(value: unknown, res: Response): value is Turn[] {
  if (value === undefined) {
    return true;
  }
  if (
    !Array.isArray(value) ||
    value.length > MAX_HISTORY ||
    value.some(
      (t) =>
        typeof t !== 'object' ||
        t === null ||
        (t.by !== 'user' && t.by !== 'model') ||
        typeof t.text !== 'string' ||
        t.text === '' ||
        t.text.length > MAX_TEXT,
    )
  ) {
    sendError(res, 400, `history must be <=${MAX_HISTORY} turns of {by: user|model, text: 1..${MAX_TEXT}}`);
    return false;
  }
  return true;
}

/** Map store ownership/absence errors to HTTP without oracling existence. */
function storeError(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (/owner mismatch/.test(message)) {
    sendError(res, 403, 'forbidden');
    return;
  }
  if (/not found/.test(message)) {
    sendError(res, 404, 'entry not found');
    return;
  }
  sendError(res, 500, 'internal error');
}

/** Display view over a cached record: snapshot fields plus inline card
 *  facts when the cached payload carries them. Never fetches (zero quota):
 *  records cached before location-bearing fetches stay pin-less (their
 *  coordinates arrive only when a fresh grounding re-caches the place). */
export function detailsFromCache(placeId: string, record: PlaceCacheRecord): PlaceDetails {
  const snap = snapshotFromCache(placeId, record);
  const obj = parsePlaceJson(record.placeJson);
  const location = parseLocation(obj.location);
  return {
    ...snap,
    ...(typeof obj.rating === 'number' ? { rating: obj.rating } : {}),
    ...(Array.isArray(obj.hours) && obj.hours.every((h): h is string => typeof h === 'string')
      ? { hours: obj.hours }
      : {}),
    ...(location !== undefined ? { location } : {}),
  };
}

/** Coordinates survive only as a complete latitude/longitude pair. */
function parseLocation(value: unknown): PlaceDetails['location'] {
  if (typeof value !== 'object' || value === null) return undefined;
  const { latitude, longitude } = value as { latitude?: unknown; longitude?: unknown };
  return typeof latitude === 'number' && typeof longitude === 'number'
    ? { latitude, longitude }
    : undefined;
}

/** Parse the cached payload once; unknown shapes degrade to blanks. */
function parsePlaceJson(placeJson: unknown): Partial<PlaceDetails> {
  return typeof placeJson === 'object' && placeJson !== null
    ? (placeJson as Partial<PlaceDetails>)
    : {};
}

/** Build the frozen snapshot from a cached place record; never crashes on shape. */
export function snapshotFromCache(placeId: string, record: PlaceCacheRecord): GroundingSnapshot {
  const obj = parsePlaceJson(record.placeJson);
  return {
    placeId,
    name: obj.name !== undefined && obj.name !== '' ? obj.name : placeId,
    address: typeof obj.address === 'string' ? obj.address : '',
    attributions:
      typeof obj.attributions === 'string' && obj.attributions !== ''
        ? obj.attributions
        : 'Powered by Google',
    fetchedAt: record.fetchedAt,
  };
}

export function createJournalRouter(deps: JournalDeps): Router {
  const router = Router();
  router.use(requireAuth(deps.verify));

  router.post('/:vaultId/entries', async (req: Request, res: Response) => {
    const vaultId = pathParam(res, req.params.vaultId, 'vaultId');
    if (vaultId === undefined || !checkVault(res, vaultId, req)) {
      return;
    }
    const { text } = req.body as { text?: unknown };
    if (!checkText(text, res)) {
      return;
    }
    try {
      const id = await deps.store.saveEntry(vaultId, {
        ownerUid: req.ownerUid,
        text,
        placeIds: [],
        groundingSnapshots: [],
        turns: [],
        createdAt: new Date().toISOString(),
      });
      res.status(201).json({ id });
    } catch (err) {
      storeError(res, err);
    }
  });

  router.get('/:vaultId/entries', async (req: Request, res: Response) => {
    const vaultId = pathParam(res, req.params.vaultId, 'vaultId');
    if (vaultId === undefined || !checkVault(res, vaultId, req)) {
      return;
    }
    const rawLimit = req.query.limit;
    const limit = rawLimit === undefined ? 20 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      sendError(res, 400, 'limit must be an integer 1..100');
      return;
    }
    try {
      const entries = await deps.store.listEntries(vaultId, req.ownerUid, limit);
      res.status(200).json({ entries });
    } catch (err) {
      storeError(res, err);
    }
  });

  router.get('/:vaultId/entries/:entryId', async (req: Request, res: Response) => {
    const vaultId = pathParam(res, req.params.vaultId, 'vaultId');
    const entryId = pathParam(res, req.params.entryId, 'entryId');
    if (vaultId === undefined || entryId === undefined || !checkVault(res, vaultId, req)) {
      return;
    }
    try {
      const entry = await deps.store.getEntry(vaultId, entryId, req.ownerUid);
      if (entry === null) {
        sendError(res, 404, 'entry not found');
        return;
      }
      res.status(200).json({ id: entryId, entry });
    } catch (err) {
      storeError(res, err);
    }
  });

  router.post('/:vaultId/entries/:entryId/groundings', async (req: Request, res: Response) => {
    const vaultId = pathParam(res, req.params.vaultId, 'vaultId');
    const entryId = pathParam(res, req.params.entryId, 'entryId');
    if (vaultId === undefined || entryId === undefined || !checkVault(res, vaultId, req)) {
      return;
    }
    const { placeId, sessionToken } = req.body as {
      placeId?: unknown;
      sessionToken?: unknown;
    };
    if (typeof placeId !== 'string' || placeId === '' || placeId.length > 256) {
      sendError(res, 400, 'placeId must be 1..256 chars');
      return;
    }
    // Autocomplete session token closes server-side on this grounding fetch.
    // Random per picker session, never a secret — validated as opaque string.
    const token =
      typeof sessionToken === 'string' && sessionToken !== '' && sessionToken.length <= 128
        ? sessionToken
        : undefined;
    if (sessionToken !== undefined && token === undefined) {
      sendError(res, 400, 'sessionToken must be a string <=128 chars');
      return;
    }
    try {
      const ownerUid = req.ownerUid;
      const entry = await deps.store.getEntry(vaultId, entryId, ownerUid);
      if (entry === null) {
        sendError(res, 404, 'entry not found');
        return;
      }
      // Domain freeze rule: the first model turn seals the Groundings.
      if (entry.turns.some((t) => t.by === 'model')) {
        sendError(res, 409, 'REFUSED: Grounding is frozen — a Reflection already exists.');
        return;
      }
      let record: PlaceCacheRecord;
      try {
        record = await deps.store.getPlace(vaultId, placeId, (id) => deps.fetchPlace(id, token));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/HTTP 404/.test(message)) {
          sendError(res, 404, 'place not found');
          return;
        }
        sendError(res, 502, 'place lookup failed');
        return;
      }
      const snapshot = snapshotFromCache(placeId, record);
      await deps.store.appendGrounding(vaultId, entryId, req.ownerUid, snapshot);
      res.status(201).json({ grounding: snapshot });
    } catch (err) {
      storeError(res, err);
    }
  });

  router.post('/:vaultId/entries/:entryId/reflections', async (req: Request, res: Response) => {
    const vaultId = pathParam(res, req.params.vaultId, 'vaultId');
    const entryId = pathParam(res, req.params.entryId, 'entryId');
    if (vaultId === undefined || entryId === undefined || !checkVault(res, vaultId, req)) {
      return;
    }
    const { history } = req.body as { history?: unknown };
    if (!checkHistory(history, res)) {
      return;
    }
    try {
      const ownerUid = req.ownerUid;
      const entry = await deps.store.getEntry(vaultId, entryId, ownerUid);
      if (entry === null) {
        sendError(res, 404, 'entry not found');
        return;
      }
      // New user turns from this call persist with the entry's placeIds
      // (what the Session can see); history is per-call deltas only.
      const newUserTurns: TurnRecord[] = (history ?? []).map((t) => ({ ...t, placeIds: [...entry.placeIds] }));
      let reflection: string;
      try {
        reflection = await reflect(
          entry.text,
          entry.groundingSnapshots,
          deps.gemini,
          [...entry.turns, ...newUserTurns],
        );
      } catch (err) {
        if (err instanceof QuotaDepletedError) {
          sendError(res, 429, 'model quota depleted — try again later');
          return;
        }
        if (err instanceof TransientGeminiError) {
          sendError(res, 502, 'model temporarily unavailable — try again');
          return;
        }
        sendError(res, 500, 'reflection failed');
        return;
      }
      // The model reply is recorded with the placeIds it saw (audit trail).
      await deps.store.appendTurns(vaultId, entryId, ownerUid, [
        ...newUserTurns,
        { by: 'model', text: reflection, placeIds: [...entry.placeIds] },
      ]);
      res.status(201).json({ reflection });
    } catch (err) {
      storeError(res, err);
    }
  });

  router.delete('/:vaultId/entries/:entryId/groundings/:placeId', async (req: Request, res: Response) => {
    const vaultId = pathParam(res, req.params.vaultId, 'vaultId');
    const entryId = pathParam(res, req.params.entryId, 'entryId');
    const placeId = pathParam(res, req.params.placeId, 'placeId');
    if (vaultId === undefined || entryId === undefined || placeId === undefined) {
      return;
    }
    if (!checkVault(res, vaultId, req)) {
      return;
    }
    try {
      // Honest 404 for places that were never grounded: silent no-ops mask
      // caller bugs, while the store stays idempotent for safe retries.
      const entry = await deps.store.getEntry(vaultId, entryId, req.ownerUid);
      if (entry === null) {
        sendError(res, 404, 'entry not found');
        return;
      }
      if (!entry.placeIds.includes(placeId)) {
        sendError(res, 404, 'place not grounded');
        return;
      }
      await deps.store.removeGrounding(vaultId, entryId, req.ownerUid, placeId);
      res.status(200).json({ removed: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Domain freeze surfaces as 409 here (the store is the enforcer).
      if (/frozen/.test(message)) {
        sendError(res, 409, 'REFUSED: Grounding is frozen — a Reflection already exists.');
        return;
      }
      storeError(res, err);
    }
  });

  router.get('/:vaultId/places/:placeId', async (req: Request, res: Response) => {
    const vaultId = pathParam(res, req.params.vaultId, 'vaultId');
    const placeId = pathParam(res, req.params.placeId, 'placeId');
    if (vaultId === undefined || placeId === undefined) {
      return;
    }
    if (!checkVault(res, vaultId, req)) {
      return;
    }
    try {
      const record = await deps.store.getCachedPlace(vaultId, placeId);
      if (record === null) {
        sendError(res, 404, 'place not cached');
        return;
      }
      res.status(200).json({ details: detailsFromCache(placeId, record) });
    } catch (err) {
      storeError(res, err);
    }
  });

  return router;
}

// HTTP boundary: journal routes (entries, groundings, reflections).
// Single responsibility — HTTP translation only: validation, status mapping,
// and seam orchestration. Transition rules live in domain/journal.ts,
// persistence in the store, prompts in gemini/. Depends on seam interfaces,
// never on firebase-admin, the Places wire, or the Gen AI SDK directly.
//
// Auth note: callers prove ownership with `ownerUid`, which must equal the
// Vault id (one Vault per user, CONTEXT.md). Firebase ID-token verification
// is the next slice; until then the store re-verifies ownership on every
// write (defense in depth — the Admin SDK bypasses firestore.rules).
import { Router, type Request, type Response } from 'express';
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
} from '../store/repository.js';

export interface JournalDeps {
  readonly store: JournalStore;
  /** Place resolution honoring the store cache (production: store.getPlace + CORE fetch). */
  readonly fetchPlace: (placeId: string) => Promise<FetchedPlace>;
  readonly gemini: IGeminiClient;
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

/** One Vault per user: the path vault and the claimed owner must agree. */
function checkVaultOwner(vaultId: string, ownerUid: unknown, res: Response): ownerUid is string {
  if (typeof ownerUid !== 'string' || ownerUid === '' || ownerUid !== vaultId) {
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

/** Build the frozen snapshot from a cached place record; never crashes on shape. */
export function snapshotFromCache(placeId: string, record: PlaceCacheRecord): GroundingSnapshot {
  const raw: unknown = record.placeJson;
  const obj: Partial<PlaceDetails> =
    typeof raw === 'object' && raw !== null ? (raw as Partial<PlaceDetails>) : {};
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

  router.post('/:vaultId/entries', async (req: Request, res: Response) => {
    const vaultId = pathParam(res, req.params.vaultId, 'vaultId');
    if (vaultId === undefined) {
      return;
    }
    const { ownerUid, text } = req.body as { ownerUid?: unknown; text?: unknown };
    if (!checkVaultOwner(vaultId, ownerUid, res) || !checkText(text, res)) {
      return;
    }
    try {
      const id = await deps.store.saveEntry(vaultId, {
        ownerUid,
        text,
        placeIds: [],
        groundingSnapshots: [],
        reflections: [],
        createdAt: new Date().toISOString(),
      });
      res.status(201).json({ id });
    } catch (err) {
      storeError(res, err);
    }
  });

  router.get('/:vaultId/entries', async (req: Request, res: Response) => {
    const vaultId = pathParam(res, req.params.vaultId, 'vaultId');
    if (vaultId === undefined) {
      return;
    }
    const ownerUid = req.query.ownerUid;
    const rawLimit = req.query.limit;
    const limit = rawLimit === undefined ? 20 : Number(rawLimit);
    if (!checkVaultOwner(vaultId, ownerUid, res)) {
      return;
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      sendError(res, 400, 'limit must be an integer 1..100');
      return;
    }
    try {
      const entries = await deps.store.listEntries(vaultId, ownerUid, limit);
      res.status(200).json({ entries });
    } catch (err) {
      storeError(res, err);
    }
  });

  router.post('/:vaultId/entries/:entryId/groundings', async (req: Request, res: Response) => {
    const vaultId = pathParam(res, req.params.vaultId, 'vaultId');
    const entryId = pathParam(res, req.params.entryId, 'entryId');
    if (vaultId === undefined || entryId === undefined) {
      return;
    }
    const { ownerUid, placeId } = req.body as { ownerUid?: unknown; placeId?: unknown };
    if (!checkVaultOwner(vaultId, ownerUid, res)) {
      return;
    }
    if (typeof placeId !== 'string' || placeId === '' || placeId.length > 256) {
      sendError(res, 400, 'placeId must be 1..256 chars');
      return;
    }
    try {
      const entry = await deps.store.getEntry(vaultId, entryId, ownerUid);
      if (entry === null) {
        sendError(res, 404, 'entry not found');
        return;
      }
      // Domain freeze rule: the first Reflection seals the Groundings.
      if (entry.reflections.length > 0) {
        sendError(res, 409, 'REFUSED: Grounding is frozen — a Reflection already exists.');
        return;
      }
      let record: PlaceCacheRecord;
      try {
        record = await deps.store.getPlace(vaultId, placeId, deps.fetchPlace);
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
      await deps.store.appendGrounding(vaultId, entryId, ownerUid, snapshot);
      res.status(201).json({ grounding: snapshot });
    } catch (err) {
      storeError(res, err);
    }
  });

  router.post('/:vaultId/entries/:entryId/reflections', async (req: Request, res: Response) => {
    const vaultId = pathParam(res, req.params.vaultId, 'vaultId');
    const entryId = pathParam(res, req.params.entryId, 'entryId');
    if (vaultId === undefined || entryId === undefined) {
      return;
    }
    const { ownerUid, history } = req.body as { ownerUid?: unknown; history?: unknown };
    if (!checkVaultOwner(vaultId, ownerUid, res) || !checkHistory(history, res)) {
      return;
    }
    try {
      const entry = await deps.store.getEntry(vaultId, entryId, ownerUid);
      if (entry === null) {
        sendError(res, 404, 'entry not found');
        return;
      }
      let reflection: string;
      try {
        reflection = await reflect(entry.text, entry.groundingSnapshots, deps.gemini, history ?? []);
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
      await deps.store.saveReflection(vaultId, entryId, ownerUid, reflection);
      res.status(201).json({ reflection });
    } catch (err) {
      storeError(res, err);
    }
  });

  return router;
}

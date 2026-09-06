// HTTP boundary: server-proxied Places autocomplete.
// Single responsibility — HTTP translation only. The browser never holds a
// Maps key: the picker talks here, this talks to Places with the server key.
// Mounted only when a key is configured (see server.ts); otherwise 404.
import { Router, type Request, type Response } from 'express';
import { requireAuth, type TokenVerifier } from '../auth.js';
import { autocompletePlaces } from '../places/places.js';

export interface PlacesDeps {
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly verify: TokenVerifier;
}

export function createPlacesRouter(deps: PlacesDeps): Router {
  const router = Router();
  router.use(requireAuth(deps.verify));
  router.post('/autocomplete', async (req: Request, res: Response) => {
    const { query, sessionToken } = req.body as { query?: unknown; sessionToken?: unknown };
    if (typeof query !== 'string' || query.trim() === '' || query.length > 200) {
      res.status(400).json({ error: 'query must be 1..200 chars' });
      return;
    }
    if (
      sessionToken !== undefined &&
      (typeof sessionToken !== 'string' || sessionToken === '' || sessionToken.length > 128)
    ) {
      res.status(400).json({ error: 'sessionToken must be a string <=128 chars' });
      return;
    }
    try {
      const predictions = await autocompletePlaces(query, {
        apiKey: deps.apiKey,
        fetchImpl: deps.fetchImpl,
        sessionToken,
      });
      res.status(200).json({ predictions });
    } catch (err) {
      // Upstream status rides the server log (never the client) so key and
      // quota failures stay diagnosable after deploy.
      console.error(`places autocomplete failed upstream: ${err instanceof Error ? err.message : err}`);
      res.status(502).json({ error: 'place lookup failed' });
    }
  });
  return router;
}

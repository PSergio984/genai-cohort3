// HTTP boundary: Express app factory (composition detail) + health probe.
// Listens on 0.0.0.0 and $PORT (Cloud Run contract) — see main.ts.
import express, { type Express, type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createJournalRouter, type JournalDeps } from './routes/journal.js';
import { createPlacesRouter } from './routes/places.js';
import type { TokenVerifier } from './auth.js';

export interface AppDeps {
  readonly journal?: Omit<JournalDeps, 'verify'>;
  /** Server Maps key for proxied autocomplete; absent mounts nothing. */
  readonly placesApiKey?: string;
  readonly placesFetchImpl?: typeof fetch;
  /** Required when any API mounts: Firebase ID-token verifier. */
  readonly verify?: TokenVerifier;
}

export function createApp(deps?: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  // NOTE: exact `/healthz` is intercepted upstream of the revision on
  // run.app URLs (never reaches the container; verified 2026-09-04), so the
  // probe lives here instead. Same contract, unreserved path.
  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'grounded-journal' });
  });
  // Journal API mounts only when fully wired (store + fetch + model + auth);
  // otherwise those paths 404 and health still answers (graceful degradation,
  // e.g. keys not yet staged).
  if (deps?.journal !== undefined && deps.verify !== undefined) {
    app.use('/api/vaults', createJournalRouter({ ...deps.journal, verify: deps.verify }));
  }
  if (deps?.placesApiKey !== undefined && deps.verify !== undefined) {
    app.use(
      '/api/places',
      createPlacesRouter({ apiKey: deps.placesApiKey, fetchImpl: deps.placesFetchImpl, verify: deps.verify }),
    );
  }
  // Runtime Firebase web config for the browser (public identifiers, not
  // secrets — but secret-scanner hostile, so they ride server env, never
  // source or build output). Values come from FIREBASE_WEB_* env, set via
  // --set-env-vars at deploy time (see cmd.md section 4). Served as JS so
  // the static shell needs no per-environment rebuild. Nulls when unset;
  // the client fail-fasts with an actionable message in that case.
  app.get('/firebase-config.js', (_req: Request, res: Response) => {
    res.type('application/javascript').send(
      `window.__FIREBASE_CONFIG__=${JSON.stringify({
        apiKey: process.env.FIREBASE_WEB_API_KEY ?? null,
        authDomain: process.env.FIREBASE_WEB_AUTH_DOMAIN ?? null,
        projectId: process.env.FIREBASE_WEB_PROJECT_ID ?? null,
        appId: process.env.FIREBASE_WEB_APP_ID ?? null,
      })};`,
    );
  });
  // Static frontend (Vite build output): index + assets.
  const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
  app.use(express.static(publicDir));
  return app;
}

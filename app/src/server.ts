// HTTP boundary: Express app factory (composition detail) + health probe.
// Listens on 0.0.0.0 and $PORT (Cloud Run contract) — see main.ts.
import express, { type Express, type Request, type Response } from 'express';
import { createJournalRouter, type JournalDeps } from './routes/journal.js';

export function createApp(deps?: JournalDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  // NOTE: exact `/healthz` is intercepted upstream of the revision on
  // run.app URLs (never reaches the container; verified 2026-09-04), so the
  // probe lives here instead. Same contract, unreserved path.
  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'grounded-journal' });
  });
  // Journal API mounts only when fully wired; otherwise those paths 404 and
  // health still answers (graceful degradation, e.g. keys not yet staged).
  if (deps !== undefined) {
    app.use('/api/vaults', createJournalRouter(deps));
  }
  return app;
}

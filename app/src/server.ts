// HTTP boundary: Express app factory (composition detail) + health probe.
// Listens on 0.0.0.0 and $PORT (Cloud Run contract) — see main.ts.
import express, { type Express, type Request, type Response } from 'express';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  // NOTE: exact `/healthz` is intercepted upstream of the revision on
  // run.app URLs (never reaches the container; verified 2026-09-04), so the
  // probe lives here instead. Same contract, unreserved path.
  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'grounded-journal' });
  });
  return app;
}

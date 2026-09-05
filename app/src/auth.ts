// Auth seam: Firebase ID-token verification for the journal + places APIs.
// Single responsibility — token → uid only. The verifier is injected
// (dependency inversion): production uses the Admin SDK, tests use fakes.
// Never logs tokens; rejects with 401, never 403-vs-404 oracle games —
// callers can only ever address their own Vault (vaultId === uid).
import { getAuth } from 'firebase-admin/auth';
import type { NextFunction, Request, Response } from 'express';

export interface TokenVerifier {
  (idToken: string): Promise<string>;
}

/** Production verifier: Firebase Admin SDK (ADC on Cloud Run). */
export function createAdminVerifier(): TokenVerifier {
  return async (idToken: string): Promise<string> => (await getAuth().verifyIdToken(idToken)).uid;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ownerUid?: string;
    }
  }
}

/** Express middleware: Bearer ID token → req.ownerUid, else 401. */
export function requireAuth(verify: TokenVerifier) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer (.+)$/.exec(header) : null;
    const token = match?.[1];
    if (token === undefined || token === '') {
      res.status(401).json({ error: 'missing bearer token' });
      return;
    }
    try {
      req.ownerUid = await verify(token);
      next();
    } catch {
      res.status(401).json({ error: 'invalid token' });
    }
  };
}

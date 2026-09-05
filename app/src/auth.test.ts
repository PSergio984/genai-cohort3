// Auth seam tests: header parsing + verifier outcomes. No network, no SDK.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { requireAuth, type TokenVerifier } from './auth.js';

function reqWith(auth?: string): Request {
  return { headers: auth === undefined ? {} : { authorization: auth } } as Request;
}

function resCapture(): { res: Response; status?: number; body?: unknown } {
  const cap: { res: Response; status?: number; body?: unknown } = {
    res: {
      status(code: number) {
        cap.status = code;
        return cap.res;
      },
      json(payload: unknown) {
        cap.body = payload;
        return cap.res;
      },
    } as unknown as Response,
  };
  return cap;
}

const okVerifier: TokenVerifier = async (token: string): Promise<string> => {
  if (token === 'good-token') {
    return 'alice';
  }
  throw new Error('bad token');
};
const next: NextFunction = () => {};

describe('requireAuth', () => {
  it('sets ownerUid and calls next on a valid token', async () => {
    const req = reqWith('Bearer good-token');
    const cap = resCapture();
    let called = false;
    await requireAuth(okVerifier)(req, cap.res, () => {
      called = true;
    });
    assert.equal(called, true);
    assert.equal(req.ownerUid, 'alice');
  });

  it('401s on a missing header', async () => {
    const req = reqWith();
    const cap = resCapture();
    let called = false;
    await requireAuth(okVerifier)(req, cap.res, () => {
      called = true;
    });
    assert.equal(called, false);
    assert.equal(cap.status, 401);
    assert.deepEqual(cap.body, { error: 'missing bearer token' });
  });

  it('401s on malformed and invalid tokens alike', async () => {
    for (const header of ['Basic xyz', 'Bearer ', 'Bearer bad-token']) {
      const req = reqWith(header);
      const cap = resCapture();
      let called = false;
      await requireAuth(okVerifier)(req, cap.res, () => {
        called = true;
      });
      assert.equal(called, false);
      assert.equal(cap.status, 401);
    }
  });
});

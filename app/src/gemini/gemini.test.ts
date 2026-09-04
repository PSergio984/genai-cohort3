// Prompting seam tests: shape contracts + error taxonomy. No network, no
// keys, no quota — fakes stand in for the model at every boundary.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSystemInstruction,
  buildUserMessage,
  GEMINI_MODEL,
  REFLECT_TEMPERATURE,
  REFLECT_MAX_TOKENS,
} from './prompts.js';
import {
  classifyStatus,
  QuotaDepletedError,
  TransientGeminiError,
  FatalGeminiError,
  type IGeminiClient,
} from './client.js';
import { reflect } from './reflector.js';
import type { GroundingSnapshot } from '../store/repository.js';

const SNAP: GroundingSnapshot = {
  placeId: 'ChIJRIZALPARK',
  name: 'Rizal Park',
  address: 'Manila, Philippines',
  attributions: 'Powered by Google',
  fetchedAt: '2026-09-04T00:00:00.000Z',
};
const SNAP2: GroundingSnapshot = {
  ...SNAP,
  placeId: 'ChIJESCOLTACAFE',
  name: 'Escolta Cafe',
  address: 'Escolta St, Manila',
};

describe('constants', () => {
  it('pins the live-verified model and research sampling contract', () => {
    assert.equal(GEMINI_MODEL, 'gemini-3.6-flash');
    assert.equal(REFLECT_TEMPERATURE, 0.8);
    assert.equal(REFLECT_MAX_TOKENS, 1024);
  });
});

describe('buildSystemInstruction', () => {
  it('binds grounding, honesty, citation, and Vault privacy', () => {
    const s = buildSystemInstruction();
    for (const phrase of ['ONLY the provided Place context', 'say unknown', 'Cite', 'supportive', 'Vault is private']) {
      assert.ok(s.includes(phrase), `missing: ${phrase}`);
    }
  });
});

describe('buildUserMessage', () => {
  it('grounds with place fields + task when snapshots exist', () => {
    const m = buildUserMessage('I walked here stuck.', [SNAP]);
    assert.ok(m.includes('Rizal Park'));
    assert.ok(m.includes('Manila, Philippines'));
    assert.ok(m.includes('I walked here stuck.'));
    assert.ok(m.includes('place-aware'));
  });

  it('lists every place for multi-place entries', () => {
    const m = buildUserMessage('Which cafe?', [SNAP, SNAP2]);
    assert.ok(m.includes('Rizal Park'));
    assert.ok(m.includes('Escolta Cafe'));
  });

  it('ungrounded variant carries no place claims and says so', () => {
    const m = buildUserMessage('Grey day.', []);
    assert.ok(m.includes('No place context attached'));
    assert.ok(m.includes('Make no place-specific claims'));
    assert.ok(!m.includes('Rizal Park'));
  });
});

describe('classifyStatus', () => {
  it('maps 429/5xx/4xx to quota/transient/fatal', () => {
    assert.equal(classifyStatus(429), 'quota');
    assert.equal(classifyStatus(500), 'transient');
    assert.equal(classifyStatus(503), 'transient');
    assert.equal(classifyStatus(400), 'fatal');
    assert.equal(classifyStatus(401), 'fatal');
    assert.equal(classifyStatus(403), 'fatal');
    assert.equal(classifyStatus(404), 'fatal');
  });

  it('error kinds carry their names', () => {
    assert.equal(new QuotaDepletedError('x').kind, 'quota-depleted');
    assert.equal(new TransientGeminiError('x').kind, 'transient');
    assert.equal(new FatalGeminiError('x').kind, 'fatal');
  });
});

describe('reflect', () => {
  function fakeClient(reply: string, seen: { system?: string; user?: string }): IGeminiClient {
    return {
      async generate(system: string, user: string): Promise<string> {
        seen.system = system;
        seen.user = user;
        return reply;
      },
    };
  }

  it('sends system + grounded user message, returns the text', async () => {
    const seen: { system?: string; user?: string } = {};
    const out = await reflect('Entry text.', [SNAP], fakeClient('deep words', seen));
    assert.equal(out, 'deep words');
    assert.ok(seen.system?.includes('ONLY the provided Place context'));
    assert.ok(seen.user?.includes('Rizal Park'));
    assert.ok(seen.user?.includes('Entry text.'));
  });

  it('propagates typed errors for the route layer to degrade', async () => {
    const failing: IGeminiClient = {
      async generate(): Promise<string> {
        throw new QuotaDepletedError('empty');
      },
    };
    await assert.rejects(reflect('x', [], failing), QuotaDepletedError);
  });
});

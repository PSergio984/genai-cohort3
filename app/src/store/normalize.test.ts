// Pure unit tests for normalizeEntryRecord: legacy vault documents predate
// newer array fields, and every route maps/measures/spreads them. No emulator,
// no network — runs everywhere node --test runs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEntryRecord } from './repository.js';
import type { EntryRecord } from './repository.js';

const FULL: EntryRecord = {
  ownerUid: 'u1',
  text: 'here',
  placeIds: ['p1'],
  groundingSnapshots: [
    {
      placeId: 'p1',
      name: 'Rizal Park',
      address: 'Manila',
      attributions: 'Powered by Google',
      fetchedAt: '2026-09-06T00:00:00.000Z',
    },
  ],
  turns: [{ by: 'user', text: 'hi', placeIds: [] }],
  createdAt: '2026-09-06T00:00:00.000Z',
};

describe('normalizeEntryRecord', () => {
  it('passes a complete record through with copies, not aliases', () => {
    const out = normalizeEntryRecord(FULL);
    assert.deepEqual(out, FULL);
    assert.notEqual(out.placeIds, FULL.placeIds);
    assert.notEqual(out.turns, FULL.turns);
  });

  it('defaults every missing array so callers can map and measure', () => {
    const legacy = { ownerUid: 'u1', text: 'old' } as unknown as EntryRecord;
    const out = normalizeEntryRecord(legacy);
    // The exact expressions that 500d on legacy docs (checked before the
    // deepEqual narrows below):
    assert.equal(out.placeIds.includes('p1'), false);
    assert.equal(out.turns.length, 0);
    assert.equal(
      out.turns.some((t) => t.by === 'model'),
      false,
    );
    assert.deepEqual(
      out.groundingSnapshots.filter((s) => s.placeId === 'p1'),
      [],
    );
    assert.deepEqual(out.placeIds, []);
    assert.deepEqual(out.groundingSnapshots, []);
    assert.deepEqual(out.turns, []);
  });

  it('rejects non-array junk the way it rejects absence', () => {
    const dirty = {
      ownerUid: 'u1',
      text: 42,
      placeIds: 'p1',
      groundingSnapshots: null,
      turns: {},
      createdAt: null,
    } as unknown as EntryRecord;
    const out = normalizeEntryRecord(dirty);
    assert.equal(out.text, '');
    assert.deepEqual(out.placeIds, []);
    assert.deepEqual(out.turns, []);
    assert.equal(out.createdAt, '');
  });
});

// Unit tests for the domain core: transition matrix + edge cases.
// External behavior only (outcomes + resulting state), never internals.
// Mirrors the node-verified prototype checks that validated this contract.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession,
  attachPlace,
  removeLastGrounding,
  removeGrounding,
  recordReflection,
  recordTurn,
  reflectionCount,
  type PlaceSnapshot,
  type SessionState,
} from './journal.js';

const RIZAL: PlaceSnapshot = {
  placeId: 'ChIJRIZALPARK',
  name: 'Rizal Park',
  address: 'Manila, Philippines',
  attributions: 'Powered by Google',
};
const CAFE: PlaceSnapshot = {
  placeId: 'ChIJESCOLTACAFE',
  name: 'Escolta Cafe',
  address: 'Escolta St, Manila',
  attributions: 'Powered by Google',
};
const T0 = '2026-09-04T00:00:00.000Z';

function fresh(text = 'I walked here today feeling stuck.'): SessionState {
  return createSession('vault-user-1', text);
}

describe('createSession', () => {
  it('starts ungrounded, unfrozen, turnless', () => {
    const s = fresh();
    assert.equal(s.groundings.length, 0);
    assert.equal(s.turns.length, 0);
    assert.equal(s.frozen, false);
    assert.equal(s.entryText, 'I walked here today feeling stuck.');
  });
});

describe('attachPlace', () => {
  it('attaches with the given timestamp', () => {
    const r = attachPlace(fresh(), RIZAL, T0);
    assert.equal(r.ok, true);
    assert.equal(r.state.groundings.length, 1);
    assert.equal(r.state.groundings[0]?.fetchedAt, T0);
    assert.equal(r.state.frozen, false);
  });

  it('null place keeps the entry ungrounded as a successful no-op', () => {
    const s = fresh();
    const r = attachPlace(s, null, T0);
    assert.equal(r.ok, true);
    assert.equal(r.state.groundings.length, 0);
    assert.equal(r.state.frozen, false);
  });

  it('duplicate attach is refused', () => {
    const s = attachPlace(fresh(), RIZAL, T0).state;
    const r = attachPlace(s, RIZAL, T0);
    assert.equal(r.ok, false);
    assert.equal(r.state.groundings.length, 1);
  });

  it('several places may ground one entry', () => {
    let s = attachPlace(fresh(), RIZAL, T0).state;
    s = attachPlace(s, CAFE, T0).state;
    assert.equal(s.groundings.length, 2);
  });

  it('attach after freeze is refused', () => {
    const s = recordReflection(attachPlace(fresh(), RIZAL, T0).state, 'r1').state;
    const r = attachPlace(s, CAFE, T0);
    assert.equal(r.ok, false);
    assert.equal(r.state.groundings.length, 1);
  });

  it('does not mutate the input state', () => {
    const s = Object.freeze(fresh());
    assert.doesNotThrow(() => attachPlace(s, RIZAL, T0));
    assert.equal(s.groundings.length, 0);
  });
});

describe('removeLastGrounding', () => {
  it('removes before freeze', () => {
    const s = attachPlace(fresh(), RIZAL, T0).state;
    const r = removeLastGrounding(s);
    assert.equal(r.ok, true);
    assert.equal(r.state.groundings.length, 0);
  });

  it('empty removal is a no-op with a message', () => {
    const r = removeLastGrounding(fresh());
    assert.equal(r.ok, false);
    assert.equal(r.state.groundings.length, 0);
  });

  it('removal after freeze is refused', () => {
    const s = recordReflection(attachPlace(fresh(), RIZAL, T0).state, 'r1').state;
    const r = removeLastGrounding(s);
    assert.equal(r.ok, false);
    assert.equal(r.state.groundings.length, 1);
  });

  it('removing an unknown place id removes nothing', () => {
    const s = attachPlace(fresh(), RIZAL, T0).state;
    const r = removeGrounding(s, 'ChIJNOPE');
    assert.equal(r.ok, false);
    assert.equal(r.state.groundings.length, 1);
  });

  it('removing one of two places by id keeps the other', () => {
    let s = attachPlace(fresh(), RIZAL, T0).state;
    s = attachPlace(s, CAFE, T0).state;
    const r = removeGrounding(s, RIZAL.placeId);
    assert.equal(r.ok, true);
    assert.equal(r.state.groundings.length, 1);
    assert.equal(r.state.groundings[0]?.placeId, CAFE.placeId);
  });

  it('id-targeted removal after freeze is refused', () => {
    const s = recordReflection(attachPlace(fresh(), RIZAL, T0).state, 'r1').state;
    const r = removeGrounding(s, RIZAL.placeId);
    assert.equal(r.ok, false);
    assert.equal(r.state.groundings.length, 1);
  });

  it('re-attaching after removal works (editability cycle)', () => {
    let s = attachPlace(fresh(), RIZAL, T0).state;
    s = removeLastGrounding(s).state;
    const r = attachPlace(s, CAFE, T0);
    assert.equal(r.ok, true);
    assert.equal(r.state.groundings.length, 1);
    assert.equal(r.state.groundings[0]?.placeId, CAFE.placeId);
  });
});

describe('recordReflection', () => {
  it('records and freezes, even ungrounded', () => {
    const r = recordReflection(fresh(), 'general words');
    assert.equal(r.ok, true);
    assert.equal(reflectionCount(r.state), 1);
    assert.equal(r.state.frozen, true);
  });

  it('follow-up turns earn further reflections on the same entry', () => {
    let s = recordReflection(attachPlace(fresh(), RIZAL, T0).state, 'r1').state;
    s = recordTurn(s, 'what about the lake there?').state;
    s = recordReflection(s, 'r2').state;
    assert.equal(reflectionCount(s), 2);
    assert.equal(s.turns.length, 3);
    assert.deepEqual(s.turns[1], { by: 'user', text: 'what about the lake there?' });
  });
});

describe('recordTurn', () => {
  it('appends a user turn without touching groundings', () => {
    const s0 = attachPlace(fresh(), RIZAL, T0).state;
    const r = recordTurn(s0, 'and the light was gold');
    assert.equal(r.ok, true);
    assert.equal(r.state.turns.length, 1);
    assert.equal(r.state.groundings.length, 1);
    assert.equal(r.state.frozen, false);
  });
});

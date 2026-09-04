// Domain core: Entry → Grounding → Reflection lifecycle (CONTEXT.md vocabulary).
// Lifted from the validated throwaway prototype (prototype/place-flow branch):
// same transition rules, rewritten pure and immutable. Single responsibility —
// transition rules live here and nowhere else. UI and backend call into this
// module; it performs no I/O, reads no clock (timestamps are parameters).

export interface PlaceSnapshot {
  readonly placeId: string;
  readonly name: string;
  readonly address: string;
  readonly attributions: string;
}

export interface Grounding extends PlaceSnapshot {
  readonly fetchedAt: string;
}

export interface Turn {
  readonly by: 'user' | 'model';
  readonly text: string;
}

export interface SessionState {
  readonly vault: string;
  readonly entryText: string;
  readonly groundings: readonly Grounding[];
  readonly turns: readonly Turn[];
  /** Once true, Groundings are frozen (audit trail); Reflections may continue. */
  readonly frozen: boolean;
}

export type Outcome =
  | { readonly ok: true; readonly state: SessionState; readonly message: string }
  | { readonly ok: false; readonly state: SessionState; readonly message: string };

export function createSession(vault: string, entryText: string): SessionState {
  return { vault, entryText, groundings: [], turns: [], frozen: false };
}

/**
 * Attach a Place resolved by the picker (Maps seam). `place: null` means the
 * picker found nothing — a successful no-op: the Entry stays ungrounded,
 * which the spec defines as never an error state.
 */
export function attachPlace(
  state: SessionState,
  place: PlaceSnapshot | null,
  fetchedAt: string,
): Outcome {
  if (place === null) {
    return { ok: true, state, message: 'No such place — picker found nothing. Entry stays ungrounded.' };
  }
  if (state.frozen) {
    return { ok: false, state, message: 'REFUSED: Grounding is frozen — a Reflection already exists.' };
  }
  if (state.groundings.some((g) => g.placeId === place.placeId)) {
    return { ok: false, state, message: `${place.name} is already attached.` };
  }
  const grounding: Grounding = { ...place, fetchedAt };
  return {
    ok: true,
    state: { ...state, groundings: [...state.groundings, grounding] },
    message: `Grounding created for ${place.name} (editable until first Reflection).`,
  };
}

export function removeLastGrounding(state: SessionState): Outcome {
  if (state.frozen) {
    return { ok: false, state, message: 'REFUSED: Grounding is frozen — a Reflection already exists.' };
  }
  const last = state.groundings[state.groundings.length - 1];
  if (last === undefined) {
    return { ok: false, state, message: 'Nothing attached — Entry is (still) ungrounded.' };
  }
  return removeGrounding(state, last.placeId);
}

/** Remove one Grounding by place id (fixes a wrong pick among several). */
export function removeGrounding(state: SessionState, placeId: string): Outcome {
  if (state.frozen) {
    return { ok: false, state, message: 'REFUSED: Grounding is frozen — a Reflection already exists.' };
  }
  const target = state.groundings.find((g) => g.placeId === placeId);
  if (target === undefined) {
    return { ok: false, state, message: 'That Place is not attached — nothing removed.' };
  }
  return {
    ok: true,
    state: { ...state, groundings: state.groundings.filter((g) => g.placeId !== placeId) },
    message: `Removed Grounding for ${target.name}.`,
  };
}

/**
 * Record a model reply. Generation happens outside (Gemini seam); this module
 * owns legality: any Session may gain Reflections (one per model reply), and
 * the first one freezes the Groundings.
 */
export function recordReflection(state: SessionState, text: string): Outcome {
  const n = state.turns.filter((t) => t.by === 'model').length + 1;
  return {
    ok: true,
    state: { ...state, turns: [...state.turns, { by: 'model', text }], frozen: true },
    message: `Reflection #${n} recorded. Grounding is now FROZEN.`,
  };
}

/** Record a user follow-up Turn (a Turn, never an Entry). */
export function recordTurn(state: SessionState, text: string): Outcome {
  return {
    ok: true,
    state: { ...state, turns: [...state.turns, { by: 'user', text }] },
    message: 'Follow-up Turn recorded (a Turn, not an Entry).',
  };
}

export function reflectionCount(state: SessionState): number {
  return state.turns.filter((t) => t.by === 'model').length;
}

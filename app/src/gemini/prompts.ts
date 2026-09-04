// Prompting seam, part 1: pure prompt builders (no SDK, no I/O).
// Single responsibility — prompt SHAPE lives here; transport lives in
// client.ts; orchestration in reflector.ts. Research #3 contracts frozen in.
// Operational twin: docs/ai-studio-custom-instructions.md §§1–7 + §8 Maps
// delta (paste into the AI Studio App; this module is the runtime twin).
import type { GroundingSnapshot } from '../store/repository.js';
import type { Turn } from '../domain/journal.js';

/** Verified live 2026-09-04 (gemini-2.0-flash retired; this one recognized). */
export const GEMINI_MODEL = 'gemini-3.6-flash';
/** Research #3: balanced reflectiveness, capped cost. */
export const REFLECT_TEMPERATURE = 0.8;
export const REFLECT_MAX_TOKENS = 1024;

export function buildSystemInstruction(): string {
  return [
    'You are a grounded reflection partner for a personal journal.',
    'Use ONLY the provided Place context for factual claims about places.',
    'Allowed place fields: name, address, location, types, rating, hours, photos, reviews, editorial summary, attributions.',
    'Anything outside those fields is unknown — say unknown, never hallucinate.',
    'Cite each place by name for every fact you use.',
    'Keep a supportive tone.',
    'Never reveal or hint at other users\u2019 entries: each Vault is private.',
  ].join(' ');
}

function groundingBlock(snapshots: readonly GroundingSnapshot[]): string {
  return snapshots
    .map((s) =>
      [
        '[GROUNDING]',
        `Place: ${s.name} (${s.placeId})`,
        `Address: ${s.address}`,
        `Attribution: ${s.attributions}`,
        `Fetched: ${s.fetchedAt}`,
      ].join('\n'),
    )
    .join('\n---\n');
}

function historyBlock(history: readonly Turn[]): string {
  if (history.length === 0) {
    return '';
  }
  const lines = history.map((t) => `${t.by === 'user' ? 'User' : 'Gemini'}: ${t.text}`);
  return ['[HISTORY]', ...lines, ''].join('\n');
}

export function buildUserMessage(
  entryText: string,
  snapshots: readonly GroundingSnapshot[],
  history: readonly Turn[] = [],
): string {
  if (snapshots.length === 0) {
    return [
      '[GROUNDING]',
      'No place context attached to this entry.',
      '',
      historyBlock(history),
      `Entry: ${entryText}`,
      '',
      '[TASK] Reflect supportively and generally. Make no place-specific claims.',
    ].join('\n');
  }
  return [
    groundingBlock(snapshots),
    '',
    historyBlock(history),
    `Entry: ${entryText}`,
    '',
    '[TASK] Reflect with place-aware insight grounded in the context above.',
    'Cite each place by name for every fact you use.',
    'Suggest two grounding exercises tied to the place.',
  ].join('\n');
}

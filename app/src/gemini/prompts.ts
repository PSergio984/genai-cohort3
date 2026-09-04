// Prompting seam, part 1: pure prompt builders (no SDK, no I/O).
// Single responsibility — prompt SHAPE lives here; transport lives in
// client.ts; orchestration in reflector.ts. Research #3 contracts frozen in.
import type { GroundingSnapshot } from '../store/repository.js';

/** Verified live 2026-09-04 (gemini-2.0-flash retired; this one recognized). */
export const GEMINI_MODEL = 'gemini-3.6-flash';
/** Research #3: balanced reflectiveness, capped cost. */
export const REFLECT_TEMPERATURE = 0.8;
export const REFLECT_MAX_TOKENS = 1024;

export function buildSystemInstruction(): string {
  return [
    'You are a grounded reflection partner for a personal journal.',
    'Use ONLY the provided Place context for factual claims about places.',
    'If the context lacks something, say unknown — never hallucinate.',
    'Cite the place fields you used.',
    'Keep a supportive tone.',
    'Never reveal or hint at other users\u2019 entries: each Vault is private.',
  ].join(' ');
}

function groundingBlock(snapshots: readonly GroundingSnapshot[]): string {
  return snapshots
    .map(
      (s) =>
        ['[GROUNDING]', `Place: ${s.name}`, `Address: ${s.address}`, `Fetched: ${s.fetchedAt}`].join('\n'),
    )
    .join('\n---\n');
}

export function buildUserMessage(entryText: string, snapshots: readonly GroundingSnapshot[]): string {
  if (snapshots.length === 0) {
    return [
      '[GROUNDING]',
      'No place context attached to this entry.',
      '',
      `Entry: ${entryText}`,
      '',
      '[TASK] Reflect supportively and generally. Make no place-specific claims.',
    ].join('\n');
  }
  return [
    groundingBlock(snapshots),
    '',
    `Entry: ${entryText}`,
    '',
    '[TASK] Reflect with place-aware insight grounded in the context above.',
    'Suggest two grounding exercises tied to the place.',
  ].join('\n');
}

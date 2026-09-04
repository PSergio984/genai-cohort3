// Prompting seam, part 2: Gemini transport with typed errors.
// Single responsibility — status mapping + SDK calls live here; prompt shape
// in prompts.ts; orchestration in reflector.ts. Callers depend on the
// IGeminiClient interface (dependency inversion), so tests never touch quota.
import { GoogleGenAI } from '@google/genai';
import { GEMINI_MODEL, REFLECT_TEMPERATURE, REFLECT_MAX_TOKENS } from './prompts.js';

export interface IGeminiClient {
  generate(system: string, user: string): Promise<string>;
}

/** Quota/billing exhausted (HTTP 429). Degrade visibly, never silently generic. */
export class QuotaDepletedError extends Error {
  readonly kind = 'quota-depleted' as const;
}
/** Server-side wobble (5xx). Safe to retry with backoff. */
export class TransientGeminiError extends Error {
  readonly kind = 'transient' as const;
}
/** Our fault (4xx non-quota): bad key, bad model, bad payload. Fail loudly. */
export class FatalGeminiError extends Error {
  readonly kind = 'fatal' as const;
}

/** Pure status mapping — the only decision in error handling, fully tested. */
export function classifyStatus(status: number): 'quota' | 'transient' | 'fatal' {
  if (status === 429) {
    return 'quota';
  }
  if (status >= 500) {
    return 'transient';
  }
  return 'fatal';
}

function toTypedError(status: number, message: string): Error {
  const kind = classifyStatus(status);
  if (kind === 'quota') {
    return new QuotaDepletedError(`Gemini quota depleted (HTTP ${status}): ${message}`);
  }
  if (kind === 'transient') {
    return new TransientGeminiError(`Gemini transient failure (HTTP ${status}): ${message}`);
  }
  return new FatalGeminiError(`Gemini request failed (HTTP ${status}): ${message}`);
}

export interface SdkDeps {
  readonly apiKey: string;
  readonly model?: string;
}

/** Production client: Gen AI SDK, AI-Studio-key mode. Key arrives, never read. */
export function createSdkClient({ apiKey, model = GEMINI_MODEL }: SdkDeps): IGeminiClient {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async generate(system: string, user: string): Promise<string> {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: user,
          config: {
            systemInstruction: system,
            temperature: REFLECT_TEMPERATURE,
            maxOutputTokens: REFLECT_MAX_TOKENS,
          },
        });
        return res.text ?? '';
      } catch (err) {
        const status = typeof (err as { status?: unknown }).status === 'number'
          ? ((err as { status: number }).status)
          : 500;
        const message = err instanceof Error ? err.message : String(err);
        throw toTypedError(status, message);
      }
    },
  };
}

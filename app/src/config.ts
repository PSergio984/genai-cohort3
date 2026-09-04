// Config seam: the ONLY place that reads secrets and environment.
// Single responsibility — resolution policy lives here; nothing else touches
// process.env or the Secret Manager volume mount directly. Key values are
// never logged here; callers receive them opaquely.
import { readFileSync } from 'node:fs';

/** Secret Manager volume mount path for the Maps key (Cloud Run). */
export const MAPS_KEY_FILE = '/secrets/maps-api-key';
/** Secret Manager volume mount path for the Gemini key (Cloud Run). */
export const GEMINI_KEY_FILE = '/secrets/gemini-api-key';

/**
 * Resolve one credential: explicit env var first (local dev via .env),
 * then the mounted secret file (Cloud Run volume, always latest).
 * Returns undefined when neither exists — callers decide how to degrade.
 */
export function resolveSecret(
  envVar: string,
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromEnv = env[envVar]?.trim();
  if (fromEnv !== undefined && fromEnv !== '') {
    return fromEnv;
  }
  try {
    const fromFile = readFileSync(filePath, 'utf8').trim();
    return fromFile === '' ? undefined : fromFile;
  } catch {
    return undefined;
  }
}

export function resolveMapsKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return resolveSecret('MAPS_API_KEY', MAPS_KEY_FILE, env);
}

export function resolveGeminiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return resolveSecret('GEMINI_API_KEY', GEMINI_KEY_FILE, env);
}

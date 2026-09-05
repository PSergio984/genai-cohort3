// Place-context seam: the SOLE touchpoint of the Maps/Places API.
// Single responsibility — fetching + normalization live here; caching policy
// lives in the store, transition rules in the domain core. The API key arrives
// as a parameter (config seam); this module never reads env, files, or clocks
// except through parameters, so every path is unit-testable without quota.
import type { FetchedPlace } from '../store/repository.js';

const PLACES_API = 'https://places.googleapis.com/v1';

/** Cheap everyday fields. `location` rides along for map pins (UX decision);
 * everything else is the inline card. Never `*`, never Atmosphere. */
export const CORE_MASK = [
  'displayName',
  'formattedAddress',
  'location',
  'rating',
  'regularOpeningHours',
].join(',');

/**
 * Expensive fields (Enterprise + Atmosphere, ~5x). Fetched ONLY on explicit
 * expand (UX decision); never part of the default grounding.
 */
export const ATMOSPHERE_MASK = ['photos', 'reviews', 'editorialSummary'].join(',');

export interface PlaceDetails {
  readonly placeId: string;
  readonly name: string;
  readonly address: string;
  readonly attributions: string;
  readonly rating?: number;
  readonly hours?: readonly string[];
  readonly photos?: readonly unknown[];
  readonly reviews?: readonly unknown[];
  readonly editorialSummary?: string;
}

export interface FetchDeps {
  readonly apiKey: string;
  /** Injectable HTTP layer (tests pass a fake; production omits it). */
  readonly fetchImpl?: typeof fetch;
  /**
   * Autocomplete session token, closed server-side: the picker opens a
   * session (autocomplete calls) and the grounding fetch with the same token
   * closes it (quota benefit). Random per picker session, never a secret.
   */
  readonly sessionToken?: string;
}

interface PlacesResponse {
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  photos?: unknown[];
  reviews?: unknown[];
  editorialSummary?: { text?: string };
  /** Provider attributions when the API returns them; defaulted otherwise. */
  attributions?: Array<{ provider?: string }> | string[];
}

/** Field is Atmosphere-tier (expensive, expand-only) — never in CORE_MASK. */
function wantsAtmosphere(mask: string, field: string): boolean {
  return mask.split(',').map((f) => f.trim()).includes(field);
}

/** Prefer provider text when present; the generic mark otherwise (always rendered). */
function resolveAttributions(body: PlacesResponse): string {
  const fallback = 'Powered by Google';
  if (!Array.isArray(body.attributions) || body.attributions.length === 0) {
    return fallback;
  }
  const names = body.attributions
    .map((a) => (typeof a === 'string' ? a : (a.provider ?? '')).trim())
    .filter((n) => n !== '');
  return names.length > 0 ? names.join('; ') : fallback;
}

/** Fetch + normalize one Place. Non-2xx rejects so callers degrade to ungrounded. */
export async function fetchPlaceDetails(
  placeId: string,
  mask: string,
  deps: FetchDeps,
): Promise<PlaceDetails> {
  const impl = deps.fetchImpl ?? fetch;
  const url =
    deps.sessionToken !== undefined && deps.sessionToken !== ''
      ? `${PLACES_API}/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(deps.sessionToken)}`
      : `${PLACES_API}/places/${encodeURIComponent(placeId)}`;
  const res = await impl(url, {
    headers: { 'X-Goog-Api-Key': deps.apiKey, 'X-Goog-FieldMask': mask },
  });
  if (!res.ok) {
    throw new Error(`places lookup failed for ${placeId}: HTTP ${res.status}`);
  }
  const body = (await res.json()) as PlacesResponse;
  // Atmosphere fields are honored ONLY when the mask asks for them: a CORE
  // response carrying them (or a sloppy mock) must not leak them downstream.
  const atmospheric = (field: 'photos' | 'reviews' | 'editorialSummary'): boolean =>
    wantsAtmosphere(mask, field);
  return {
    placeId,
    name: body.displayName?.text ?? placeId,
    address: body.formattedAddress ?? '',
    attributions: resolveAttributions(body),
    ...(body.rating !== undefined ? { rating: body.rating } : {}),
    ...(body.regularOpeningHours?.weekdayDescriptions !== undefined
      ? { hours: body.regularOpeningHours.weekdayDescriptions }
      : {}),
    ...(atmospheric('photos') && body.photos !== undefined ? { photos: body.photos } : {}),
    ...(atmospheric('reviews') && body.reviews !== undefined ? { reviews: body.reviews } : {}),
    ...(atmospheric('editorialSummary') && body.editorialSummary?.text !== undefined
      ? { editorialSummary: body.editorialSummary.text }
      : {}),
  };
}

/** Freeze a fetched Place into the snapshot shape Groundings persist. */
export function toSnapshot(
  details: PlaceDetails,
  fetchedAt: string,
): Pick<PlaceDetails, 'placeId' | 'name' | 'address' | 'attributions'> & { fetchedAt: string } {
  return {
    placeId: details.placeId,
    name: details.name,
    address: details.address,
    attributions: details.attributions,
    fetchedAt,
  };
}

/**
 * Adapter into the store's read-through cache: CORE-mask fetch shaped as the
 * store's FetchedPlace. The store owns caching/TTL; this owns the wire.
 * Clock injected (tests pin it; production omits it).
 */
export function createPlaceFetcher(
  apiKey: string,
  fetchImpl?: typeof fetch,
  nowMs: () => number = Date.now,
) {
  return async (placeId: string, sessionToken?: string): Promise<FetchedPlace> => {
    const details = await fetchPlaceDetails(placeId, CORE_MASK, { apiKey, fetchImpl, sessionToken });
    return {
      placeJson: details,
      fetchedAtMs: nowMs(),
    };
  };
}

export interface PlacePrediction {
  readonly placeId: string;
  readonly text: string;
}

interface AutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: { placeId?: string; text?: { text?: string } };
  }>;
}

export interface AutocompleteDeps {
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Server-proxied autocomplete: the browser never holds a Maps key. The
 * sessionToken (client-generated UUID per picker session) rides along so the
 * later grounding fetch with the same token closes the session server-side.
 */
export async function autocompletePlaces(
  query: string,
  deps: AutocompleteDeps & { sessionToken?: string },
): Promise<PlacePrediction[]> {
  const impl = deps.fetchImpl ?? fetch;
  const res = await impl(`${PLACES_API}/places:autocomplete`, {
    method: 'POST',
    headers: {
      'X-Goog-Api-Key': deps.apiKey,
      'Content-Type': 'application/json',
      'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text',
    },
    body: JSON.stringify({
      input: query,
      ...(deps.sessionToken !== undefined && deps.sessionToken !== '' ? { sessionToken: deps.sessionToken } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`places autocomplete failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as AutocompleteResponse;
  return (body.suggestions ?? [])
    .map((s) => ({
      placeId: s.placePrediction?.placeId ?? '',
      text: s.placePrediction?.text?.text ?? '',
    }))
    .filter((p) => p.placeId !== '' && p.text !== '');
}

// Place-context seam: the SOLE touchpoint of the Maps/Places API.
// Single responsibility — fetching + normalization live here; caching policy
// lives in the store, transition rules in the domain core. The API key arrives
// as a parameter (config seam); this module never reads env, files, or clocks
// except through parameters, so every path is unit-testable without quota.
import type { FetchedPlace } from '../store/repository.js';

const PLACES_API = 'https://places.googleapis.com/v1';

/** Cheap everyday fields (Essentials/Pro). Requested on every grounding. */
export const CORE_MASK = [
  'displayName',
  'formattedAddress',
  'location',
  'types',
  'rating',
  'regularOpeningHours',
  'websiteUri',
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
  /** Injected clock for fetchedAt (tests pin it). */
  readonly nowMs?: number;
}

interface PlacesResponse {
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  photos?: unknown[];
  reviews?: unknown[];
  editorialSummary?: { text?: string };
}

/** Fetch + normalize one Place. Non-2xx rejects so callers degrade to ungrounded. */
export async function fetchPlaceDetails(
  placeId: string,
  mask: string,
  deps: FetchDeps,
): Promise<PlaceDetails> {
  const impl = deps.fetchImpl ?? fetch;
  const res = await impl(`${PLACES_API}/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': deps.apiKey, 'X-Goog-FieldMask': mask },
  });
  if (!res.ok) {
    throw new Error(`places lookup failed for ${placeId}: HTTP ${res.status}`);
  }
  const body = (await res.json()) as PlacesResponse;
  const attributions = 'Powered by Google';
  return {
    placeId,
    name: body.displayName?.text ?? placeId,
    address: body.formattedAddress ?? '',
    attributions,
    ...(body.rating !== undefined ? { rating: body.rating } : {}),
    ...(body.regularOpeningHours?.weekdayDescriptions !== undefined
      ? { hours: body.regularOpeningHours.weekdayDescriptions }
      : {}),
    ...(body.photos !== undefined ? { photos: body.photos } : {}),
    ...(body.reviews !== undefined ? { reviews: body.reviews } : {}),
    ...(body.editorialSummary?.text !== undefined ? { editorialSummary: body.editorialSummary.text } : {}),
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
 */
export function createPlaceFetcher(apiKey: string, fetchImpl?: typeof fetch) {
  return async (placeId: string): Promise<FetchedPlace> => {
    const details = await fetchPlaceDetails(placeId, CORE_MASK, { apiKey, fetchImpl });
    return {
      placeJson: details,
      fetchedAtMs: Date.now(),
    };
  };
}

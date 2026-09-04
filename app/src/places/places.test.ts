// Places seam tests: headers, normalization, edges, adapter shape.
// No network, no keys, no quota: a fake fetch stands in for the API.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchPlaceDetails,
  toSnapshot,
  createPlaceFetcher,
  CORE_MASK,
  ATMOSPHERE_MASK,
} from './places.js';

interface Seen {
  url: string;
  init?: RequestInit;
}
function fakeFetch(body: unknown, status = 200) {
  const seen: Seen[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, seen };
}

const FULL_BODY = {
  displayName: { text: 'Rizal Park' },
  formattedAddress: 'Manila, Philippines',
  rating: 4.6,
  regularOpeningHours: { weekdayDescriptions: ['Mon: 5am-9pm'] },
  photos: [{ name: 'p1' }],
  reviews: [{ rating: 5, text: 'Peaceful' }],
  editorialSummary: { text: 'Historic urban park' },
};

describe('masks', () => {
  it('CORE stays cheap, Atmosphere stays gated', () => {
    for (const f of ['displayName', 'formattedAddress', 'rating']) {
      assert.ok(CORE_MASK.includes(f));
    }
    for (const f of ['photos', 'reviews', 'editorialSummary']) {
      assert.ok(!CORE_MASK.includes(f));
      assert.ok(ATMOSPHERE_MASK.includes(f));
    }
    assert.ok(!CORE_MASK.includes('*') && !ATMOSPHERE_MASK.includes('*'));
  });
});

describe('fetchPlaceDetails', () => {
  it('sends key + mask headers to the place endpoint', async () => {
    const { impl, seen } = fakeFetch(FULL_BODY);
    await fetchPlaceDetails('ChIJX', CORE_MASK, { apiKey: 'k', fetchImpl: impl });
    assert.equal(seen.length, 1);
    assert.ok(seen[0]?.url.endsWith('/places/ChIJX'));
    const headers = seen[0]?.init?.headers as Record<string, string>;
    assert.equal(headers['X-Goog-Api-Key'], 'k');
    assert.equal(headers['X-Goog-FieldMask'], CORE_MASK);
  });

  it('normalizes a full response, attribution always present', async () => {
    const { impl } = fakeFetch(FULL_BODY);
    const d = await fetchPlaceDetails('ChIJX', CORE_MASK, { apiKey: 'k', fetchImpl: impl });
    assert.equal(d.name, 'Rizal Park');
    assert.equal(d.address, 'Manila, Philippines');
    assert.equal(d.rating, 4.6);
    assert.deepEqual(d.hours, ['Mon: 5am-9pm']);
    assert.equal(d.photos?.length, 1);
    assert.equal(d.editorialSummary, 'Historic urban park');
    assert.equal(d.attributions, 'Powered by Google');
  });

  it('sparse response degrades to id + blanks, never crashes', async () => {
    const { impl } = fakeFetch({});
    const d = await fetchPlaceDetails('ChIJY', CORE_MASK, { apiKey: 'k', fetchImpl: impl });
    assert.equal(d.name, 'ChIJY');
    assert.equal(d.address, '');
    assert.equal(d.rating, undefined);
    assert.equal(d.photos, undefined);
  });

  it('non-2xx rejects so callers degrade to ungrounded', async () => {
    const { impl } = fakeFetch({ error: 'x' }, 404);
    await assert.rejects(fetchPlaceDetails('ChIJZ', CORE_MASK, { apiKey: 'k', fetchImpl: impl }), /HTTP 404/);
  });

  it('transport errors propagate', async () => {
    const impl = (async () => {
      throw new Error('net down');
    }) as typeof fetch;
    await assert.rejects(fetchPlaceDetails('ChIJZ', CORE_MASK, { apiKey: 'k', fetchImpl: impl }), /net down/);
  });
});

describe('toSnapshot', () => {
  it('freezes the audit fields plus fetchedAt, drops the rest', async () => {
    const { impl } = fakeFetch(FULL_BODY);
    const d = await fetchPlaceDetails('ChIJX', CORE_MASK, { apiKey: 'k', fetchImpl: impl });
    const s = toSnapshot(d, '2026-09-04T00:00:00.000Z');
    assert.deepEqual(s, {
      placeId: 'ChIJX',
      name: 'Rizal Park',
      address: 'Manila, Philippines',
      attributions: 'Powered by Google',
      fetchedAt: '2026-09-04T00:00:00.000Z',
    });
  });
});

describe('createPlaceFetcher', () => {
  it('returns the store FetchedPlace shape with a fresh timestamp', async () => {
    const { impl, seen } = fakeFetch(FULL_BODY);
    const before = Date.now();
    const got = await createPlaceFetcher('k', impl)('ChIJX');
    assert.deepEqual(got.placeJson, {
      placeId: 'ChIJX',
      name: 'Rizal Park',
      address: 'Manila, Philippines',
      attributions: 'Powered by Google',
      rating: 4.6,
      hours: ['Mon: 5am-9pm'],
      photos: [{ name: 'p1' }],
      reviews: [{ rating: 5, text: 'Peaceful' }],
      editorialSummary: 'Historic urban park',
    });
    assert.ok(got.fetchedAtMs >= before && got.fetchedAtMs <= Date.now());
    const headers = seen[0]?.init?.headers as Record<string, string>;
    assert.equal(headers['X-Goog-FieldMask'], CORE_MASK);
  });
});

// Places seam tests: headers, normalization, edges, adapter shape.
// No network, no keys, no quota: a fake fetch stands in for the API.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchPlaceDetails,
  toSnapshot,
  createPlaceFetcher,
  autocompletePlaces,
  CORE_MASK,
  ATMOSPHERE_MASK,
} from './places.js';

interface Seen {
  url: string;
  init?: RequestInit;
}
function reqBody(seen: Seen[], i: number): string {
  const body = seen[i]?.init?.body;
  if (typeof body !== 'string') {
    throw new Error('expected string request body');
  }
  return body;
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
    for (const f of ['displayName', 'formattedAddress', 'location', 'rating', 'regularOpeningHours']) {
      assert.ok(CORE_MASK.includes(f), `CORE must include ${f}`);
    }
    for (const f of ['photos', 'reviews', 'editorialSummary', 'types', 'websiteUri']) {
      assert.ok(!CORE_MASK.includes(f), `CORE must exclude ${f}`);
    }
    for (const f of ['photos', 'reviews', 'editorialSummary']) {
      assert.ok(ATMOSPHERE_MASK.includes(f), `Atmosphere must include ${f}`);
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
    const d = await fetchPlaceDetails('ChIJX', `${CORE_MASK},${ATMOSPHERE_MASK}`, {
      apiKey: 'k',
      fetchImpl: impl,
    });
    assert.equal(d.name, 'Rizal Park');
    assert.equal(d.address, 'Manila, Philippines');
    assert.equal(d.rating, 4.6);
    assert.deepEqual(d.hours, ['Mon: 5am-9pm']);
    assert.equal(d.photos?.length, 1);
    assert.equal(d.editorialSummary, 'Historic urban park');
    assert.equal(d.attributions, 'Powered by Google');
  });

  it('CORE mask strips Atmosphere fields even when the API sends them', async () => {
    const { impl } = fakeFetch(FULL_BODY);
    const d = await fetchPlaceDetails('ChIJX', CORE_MASK, { apiKey: 'k', fetchImpl: impl });
    assert.equal(d.photos, undefined);
    assert.equal(d.reviews, undefined);
    assert.equal(d.editorialSummary, undefined);
    assert.equal(d.name, 'Rizal Park');
  });

  it('provider attributions propagate when present', async () => {
    const { impl } = fakeFetch({ ...FULL_BODY, attributions: [{ provider: 'Listings Co' }, 'City Guide'] });
    const d = await fetchPlaceDetails('ChIJX', CORE_MASK, { apiKey: 'k', fetchImpl: impl });
    assert.equal(d.attributions, 'Listings Co; City Guide');
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
  it('returns the store FetchedPlace shape with a pinned clock', async () => {
    const { impl, seen } = fakeFetch(FULL_BODY);
    const got = await createPlaceFetcher('k', impl, () => 1234567890000)('ChIJX');
    const details = got.placeJson as Record<string, unknown>;
    assert.equal(details['name'], 'Rizal Park');
    assert.equal(details['photos'], undefined);
    assert.equal(got.fetchedAtMs, 1234567890000);
    const headers = seen[0]?.init?.headers as Record<string, string>;
    assert.equal(headers['X-Goog-FieldMask'], CORE_MASK);
  });

  it('threads an optional session token into the details URL', async () => {
    const { impl, seen } = fakeFetch(FULL_BODY);
    await createPlaceFetcher('k', impl, () => 0)('ChIJX', 'tok-1');
    assert.ok(seen[0]?.url.includes('sessionToken=tok-1'));
  });

  it('omits the token param when none is given', async () => {
    const { impl, seen } = fakeFetch(FULL_BODY);
    await createPlaceFetcher('k', impl, () => 0)('ChIJX');
    assert.ok(!seen[0]?.url.includes('sessionToken'));
  });
});

describe('autocompletePlaces', () => {
  const SUGGESTIONS = {
    suggestions: [
      { placePrediction: { placeId: 'ChIJX', text: { text: 'Rizal Park, Manila' } } },
      { placePrediction: { placeId: 'ChIJY', text: { text: 'Rizal Avenue' } } },
      { placePrediction: {} },
      {},
    ],
  };

  it('posts the query with key + mask and normalizes predictions', async () => {
    const { impl, seen } = fakeFetch(SUGGESTIONS);
    const out = await autocompletePlaces('rizal', { apiKey: 'k', fetchImpl: impl });
    assert.deepEqual(out, [
      { placeId: 'ChIJX', text: 'Rizal Park, Manila' },
      { placeId: 'ChIJY', text: 'Rizal Avenue' },
    ]);
    assert.ok(seen[0]?.url.endsWith('/places:autocomplete'));
    const headers = seen[0]?.init?.headers as Record<string, string>;
    assert.equal(headers['X-Goog-Api-Key'], 'k');
    const sentMask = headers['X-Goog-FieldMask'];
    if (typeof sentMask !== 'string') {
      throw new Error('expected mask header');
    }
    assert.ok(sentMask.includes('placePrediction'));
    const body = JSON.parse(reqBody(seen, 0)) as Record<string, unknown>;
    assert.equal(body.input, 'rizal');
    assert.equal('sessionToken' in body, false);
  });

  it('includes the session token when given', async () => {
    const { impl, seen } = fakeFetch(SUGGESTIONS);
    await autocompletePlaces('rizal', { apiKey: 'k', fetchImpl: impl, sessionToken: 'tok-1' });
    const body = JSON.parse(reqBody(seen, 0)) as Record<string, unknown>;
    assert.equal(body.sessionToken, 'tok-1');
  });

  it('empty suggestions resolve to an empty list, never null', async () => {
    const { impl } = fakeFetch({});
    assert.deepEqual(await autocompletePlaces('xyz', { apiKey: 'k', fetchImpl: impl }), []);
  });

  it('non-2xx rejects so the route maps 502', async () => {
    const { impl } = fakeFetch({ error: 'x' }, 429);
    await assert.rejects(autocompletePlaces('rizal', { apiKey: 'k', fetchImpl: impl }), /HTTP 429/);
  });
});

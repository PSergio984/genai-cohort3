# Research: Maps/Places API for Grounded Journal — Findings Fact Sheet

> **Ticket:** #2 (part of #1 wayfinder map) — `wayfinder:research`  
> **Branch:** `research/places-api` (throwaway, linkable for UX & ADR tickets)  
> **Date:** 2026-09-04 | **Repo:** PSergio984/genai-cohort3 | **Base issue:** #1 Beyond-baseline grounded journal  
> **Method:** Read official docs beyond this repo only — no code deliverable. Primary sources cited inline.

---

## TL;DR Recommendation

| Decision | Recommendation | Why |
|---|---|---|
| **Places API (New) yes/no** | **YES — use Places API (New) exclusively** | FieldMask billing, Essentials tier is cheap ($5/1k), legacy endpoint is on deprecation path, New has `editorialSummary`/`generativeSummary`/`evChargeOptions` and structured `FieldMask` that legacy lacks. |
| **Maps JavaScript API** | YES paired with Places (New) | Interactive picker + `google.maps.places` local search; attribution-covered. |
| **Geocoding API** | YES as complement | Lat/lng ↔ `formattedAddress` for coordinate journals; does not replace Place Details. |
| **Secure key handling** | **Server-side fetch, key in Secret Manager mounted as volume, restricted API key** | Cloud Run volume mount fetches latest secret atomically; never ship key to browser. |
| **Cache TTL / expiry** | **TTL 7 days target, hard delete at 30 days** | Service Terms §14.3 allows lat/lng caching 30 days max; non-lat/lng content must not be cached beyond permitted window — use 7-day refresh for `reviews`/`hours`. `place_id` exempt — store indefinitely. |
| **Cost guardrails** | Budget alert at 50%/90%, daily quota caps, FieldMask minimalism, cap Atmosphere fields | $5 vs $25/32 per 1k — Atmosphere fields 5× Essentials. |

**Read this as ADR pre-read:** link `research/places-api-findings.md#adr-pointers` and `docs/adr/000x-maps-places-new.md` (to be created by UX/ADR tickets).

---

## 1. Places API (New) vs Places API (Legacy) vs Maps JavaScript API vs Geocoding

### 1.1 Endpoints & status

| API | Endpoint host | Auth | Status |
|---|---|---|---|
| **Places API (New)** | `https://places.googleapis.com/v1/places/{PLACE_ID}` (`searchNearby`, `searchText`, `autocomplete`) | `X-Goog-Api-Key` header or `X-Goog-FieldMask` required; OAuth for select server-to-server | **Current.** FieldMask required, wildcard `*` discouraged in prod. Docs: `place-details` referenced 2026-09-01 update. |
| **Places API (Legacy)** | `https://maps.googleapis.com/maps/api/place/details/json` etc. | `key=YOUR_API_KEY` query param | **Legacy / migration path.** Not removed yet but Google pushes migration ("Migrate to Places (New)" banner across JS reference). Pricing kept as `Places API Legacy` block. Do not build new features on it. |
| **Maps JavaScript API — Places Library** | `https://maps.googleapis.com/maps/api/js?libraries=places` browser | API key with HTTP-referrer restriction | Companion for interactive map/picker. Shares quota with Places API per `Places Library shares a usage quota with Places API` (JS places docs). |
| **Geocoding API** | `https://maps.googleapis.com/maps/api/geocode/json` | API key or OAuth token | Complementary: coordinates ↔ address. Billed as `Geocoding` SKU `$5/1k` after 10k free. Supports indefinite `formatted_address` caching per Service Terms §6.3.2 (end-user isolated). |

Sources:

- Places API (New) overview & Place Details (New): https://developers.google.com/maps/documentation/places/web-service/overview, https://developers.google.com/maps/documentation/places/web-service/place-details (required `FieldMask`, `X-Goog-Api-Key`)
- Legacy price block still present at `places/billing-and-pricing/pricing` under “Legacy product pricing — Places API Legacy” (read 2026-09-04)
- Maps JS Places Library quota note: https://developers.google.com/maps/documentation/javascript/places (“shares a usage quota with Places API”, “Use without a Google Map” varies by Core Service §14.1)
- Geocoding API usage/billing: https://developers.google.com/maps/documentation/geocoding/usage-and-billing (Geocoding SKU $0.005/req ≈ $5/1k, 25 QPS default, 3 000/min limit; $200 credit note is pre-2025 horizon line)

### 1.2 Why New wins for journaling

- **Field-level billing (SKU-per-field):** New splits cost across Essentials / Pro / Enterprise / Enterprise+Atmosphere per `data-fields`. Legacy charged broad “Basic/Contact/Atmosphere” bundles with less control.
- **Mask = guardrail:** `X-Goog-FieldMask: id,displayName,formattedAddress,location,editorialSummary` → only requested SKUs billed. Legacy `fields=` param was advisory, not enforcement at same granularity.
- **Needed journal fields exist in New:** `editorialSummary` (curated blurb), `generativeSummary` (AI summary), `reviewSummary`, `photos` (media array), `reviews`, `regularOpeningHours`/`currentOpeningHours`, `priceLevel`, `websiteUri`, `nationalPhoneNumber`. Legacy `editorial_summary` existed but without generative variant.
- **Session-token cost saver:** `Autocomplete (New) + Place Details (New)` session pricing aggregates autocomplete keystrokes into one `Autocomplete Session Usage` SKU (unlimited free entry in price list) vs. per-keystroke billing. ADR should adopt session tokens for picker.
- **Deprecation risk:** Building on legacy now creates migration debt inside the wayfinder backlog; ADR can cite “New is the only path that receives `placeSummaries`/`reviewSummaries` AI features.”

### 1.3 What each API actually does (do not conflate)

- **Places API (New)**: Knowledge-grounded POI lookup (search, details, photos, autocomplete). This is the journal's grounding source.
- **Maps JavaScript API**: Renders the map, markers, info-windows, drawing; does not itself enrich the LLM prompt — it supplies the picker UX and satisfies attribution (“show Places content on a Google Map” rule, §3.2.3.e of Platform Terms).
- **Geocoding API**: Structured address ↔ coordinates. Use when entry has raw GPS (EXIF, manual pin) but no semantic place, or to normalize user-typed address before Text Search. Note Service Terms §6.3 allows indefinite caching of `formatted_address` when isolated to end user — cheaper than re-geocoding.

> **UX ticket link:** picker choice (map-search vs. autocomplete-only) depends on whether the team accepts Maps JS bundle cost (Maps loads are Dynamic Maps SKU, separate from Places — not priced in this sheet but ~ $7/1k). Keep findings linkable.

---

## 2. Place Details fields — mapping to journal needs

### 2.1 FieldMask mechanics

Place Details (New) requires a mask; omission → error. Header form:

```
X-Goog-FieldMask: displayName,formattedAddress,location,primaryType,editorialSummary
```

or URL param `$fields=...`. Wildcard `*` returns everything but Google discourages in prod ("large amount of data...billing charges"). Each field maps to exactly one SKU tier; mixing tiers in one call triggers sum of those SKUs (documented as “For a complete list ... see Place Data Fields (New)”). Source: https://developers.google.com/maps/documentation/places/web-service/place-details and https://developers.google.com/maps/documentation/places/web-service/data-fields (read 2026-09-04, 771 lines parsed).

### 2.2 Field → SKU tier (place-details perspective; Text/ Nearby Search have parallel columns)

Parsed from `data-fields` page (property field → Place Details SKU):

| Journal need | Field | SKU | Price at 0–100k (after free cap) | Note for journal |
|---|---|---|---|---|
| Display | `id` (= `place_id` in response `name` / `id`), `displayName` | IDs Only=free; `displayName`=**Pro** | `displayName` triggers **Place Details Pro $17/1k** (5k free) — not Essentials. So name alone lifts cost tier. |
| Address line | `formattedAddress`, `addressComponents`, `adrFormatAddress`, `postalAddress` | **Essentials $5/1k** (10k free) | Cheapest textual grounding. |
| Coordinates | `location` (lat/lng), `viewport` | Essentials | Same $5 tier; cacheable 30 days per §14.3. |
| Map link / attribution | `googleMapsUri` | **Pro $17** | Needed if not showing Google Map simultaneously. |
| Hours | `currentOpeningHours`, `regularOpeningHours`, `currentSecondaryOpeningHours`, `regularSecondaryOpeningHours` | **Enterprise $20/1k** (1k free) | Expensive; consider lazy-load on demand, not per-entry auto-fetch. |
| Contact | `internationalPhoneNumber`, `nationalPhoneNumber`, `websiteUri` | Enterprise $20 | Same — fetch only if UX shows contact card. |
| Rating scaffold | `rating`, `userRatingCount`, `priceLevel`, `priceRange` | Enterprise $20 | |
| Curated description | `editorialSummary` | **Enterprise + Atmosphere $25/1k** | “Overview blurbs” Google editorial team wrote; **premium tier**. |
| AI summaries | `generativeSummary`, `reviewSummary` | Enterprise + Atmosphere $25 | New GenAI field; requires Atmosphere add-on. |
| Social proof | `reviews` (array of author/text/rating entries), `photos` (via separate Place Photos (New) media fetch) | `reviews` = Enterprise + Atmosphere $25; `photos` = **Place Details Photos $7/1k** (1k free) + media fetch cost | Photos endpoint is `GET https://places.googleapis.com/v1/{name}/media?maxWidthPx=...` with `X-Goog-Api-Key`; each media call is its own Photos SKU. Up to 10 photos per details; do not fetch all. |
| Metadata (good for UX) | `primaryType`, `types`, `businessStatus`, `containment`, `iconMaskBaseUri`, `iconBackgroundColor` | Pro $17 | Type display / icon. |
| Accessibility | `accessibilityOptions` | Pro $17 | Optional. |
| Booleans (dogs, dineIn, delivery…) | `allowsDogs`, `dineIn`, `delivery`, `curbsidePickup`, `servesBreakfast`… | Enterprise + Atmosphere $25 | Not needed for MVP journal — skip. |

**Key takeaway for cost-sensitive journal:** Every call that includes *any* Enterprise or Atmosphere field jumps from $5 to $20–$25 per 1k. Design two FieldMasks:

- **Journal Core (Essentials + Pro):** `id,displayName,formattedAddress,location,primaryType,types,businessStatus,viewport,addressComponents,googleMapsLinks?` → dominated by Pro $17 tier but avoids $25 tier. Could further split: fetch `displayName` in same call as address? No way to avoid Pro if you want the name; accept $17.
- **Enriched (on explicit user expand):** `editorialSummary,generativeSummary,reviews,photos,rating,userRatingCount,regularOpeningHours,websiteUri,priceLevel` → $25+ $20 + Photos $7. Gate behind “Show place details” click.

Source: `data-fields` parsed 2026-09-04 (blocks like `editorialSummary | Place Details Enterprise + Atmosphere | Text Search Enterprise + Atmosphere | Nearby Search Enterprise + Atmosphere`); pricing list https://developers.google.com/maps/billing-and-pricing/pricing (Places API (New) block).

### 2.3 Photos specifics

- Legacy `place/photo?photo_reference=…` pattern; New is `places/{placeId}/photos/{photoName}/media` (documented under Place Photos (New)). Each media fetch is `Places API Place Details Photos` SKU $7/1k after 1k free; there is **no free wildcard for photos**. Attribution required: photo author attribution must be shown with image (Places Policies “You must retrieve and display attributions for place details, photos, and reviews … including author information”). Do not strip `authorAttributions` from `photos[].authorAttributions`.

### 2.4 Reviews specifics

- `reviews` array (Enterprise+Atmosphere) returns up to 5 reviews per call (paging unclear — treat as capped). Each contains `authorAttribution`, `rating`, `text`, `publishTime`, `relativePublishTimeDescription`. Must show `authorAttribution.displayName` + URI. `reviewSummary` is the newer aggregated AI field — same SKU tier.
- GDPR/EEA note: `reviews` processing may involve personal data (author names). Privacy Policy must mention this; Custom Instructions draft below includes disclosure reminder.

---

## 3. Pricing, quotas, $200 credit, and billing nuance

### 3.1 Places API (New) price list (parsed 2026-09-04 from https://developers.google.com/maps/billing-and-pricing/pricing)

| SKU | Free cap /mo | 0–100k | 100–500k | 500k–1M | 1–5M | 5M+ |
|---|---|---|---|---|---|---|
| **Essentials** ||||||
| Autocomplete Requests `4EF4-B17C…` | 10k | $2.83 | $2.27 | $1.70 | $0.85 | $0.21 |
| Autocomplete Session Usage `EEA3-417B…` | Unlimited | free | free | free | free | free |
| Geocoding `BAC8-4E68…` | 10k | $5.00 | $4.00 | $3.00 | $1.50 | $0.38 |
| Maps Grounding Lite `8CD0-1602…` | 10k | $7.00 | $5.95 | $4.90 | $3.85 | $2.80 |
| Place Details Essentials `6E05-E1C3…` | 10k | $5.00 | $4.00 | $3.00 | $1.50 | $0.38 |
| Place Details Essentials (IDs Only) `5C36-E272…` | Unlimited | free | free | free | free | free |
| Text Search Essentials (IDs Only) `635D-A9DD…` | Unlimited | free | free | free | free | free |
| **Pro** | | | | | | |
| Nearby Search Pro `99F9-A108…` | 5k | $32.00 | $25.60 | $19.20 | $9.60 | $2.40 |
| Place Details Pro `4ED6-464A…` | 5k | $17.00 | $13.60 | $10.20 | $5.10 | $1.28 |
| Text Search Pro `4FDA-34B1…` | 5k | $32.00 | $25.60 | $19.20 | $9.60 | $2.40 |
| **Enterprise** | | | | | | |
| Place Details Enterprise `2D9A-3DE0…` | 1k | $20.00 | $16.00 | $12.00 | $6.00 | $1.51 |
| Place Details Enterprise + Atmosphere `EB23-5ECC…` | 1k | $25.00 | $20.00 | $15.00 | $7.50 | $2.28 |
| Place Details Photos `DCD1-FE97…` | 1k | $7.00 | $5.60 | $4.20 | $2.10 | $0.53 |
| Nearby Search Enterprise `772E-9975…` | 1k | $35.00 | $28.00 | $21.00 | $10.50 | $2.63 |
| Nearby Enterprise + Atmosphere `F20E-7034…` | 1k | $40.00 | $32.00 | $24.00 | $12.00 | $3.40 |
| Text Search Enterprise (+Atmosphere) | 1k | $35–$40 (same pattern) | | | | |

Legacy block (still billed if you call legacy host) shown separately under “Legacy product pricing — Places API Legacy” — same Autocomplete $2.83, Basic Data free, Find Place ID-only free etc. Full parse omitted here — link pricing page for fidelity.

### 3.2 What this means for the journal's scale

Assume 1 000 MAU, each writes 8 entries/month with a place attached, each entry does one Text Search Pro + one Place Details fetch:

- Text Search Pro $32/1k = $0.032/entry → 8k searches = $256
- Place Details split: 50% Essentials-only refreshes ($5/1k = $0.005) = $20, 50% enriched Enterprise+Atmosphere ($25/1k = $0.025) = $100
- Photos: if 20% fetch 2 photos → 3 200 photo media calls $7/1k = $22
- Total ~ $398/mo before free caps. Free caps shave ~ $50–$80 (10k Essentials free, 5k Pro free, 1k Enterprise free). So **~$320/mo at 8k enriched entries**.
- At 100 entries/day (~3k/mo) with Core-only FieldMask, cost stays under $60. **Guardrail:** default to Core, gate Atmosphere behind explicit expand.

### 3.3 $200 credit horizon

Pricing page no longer highlights a universal $200 recurring credit — Geocoding billing page still mentions “A $200 USD credit ... until Feb 28 2025, automatically applied” (now past). Assume billing account no longer receives that credit unless under legacy promo; budget as if no credit. Create a budget alert at $10 to catch onboarding spikes.

### 3.4 Quotas

- Geocoding: 25 QPS default (auto-scaled), 3 000/min per project reported on usage/billing page; raise via Cloud Console > IAM & Admin > Quotas > Geocoding API.
- Places API (New): quota is per-SKU QPS; default not printed on pricing page — set via Console > Google Maps Platform > Quotas. Places Details (New) typical default ~ 30–100 QPS per project; the journal should set **daily cap** (e.g., 5k Text Search Pro, 5k Place Details) lower than GCP's hard limit so runaway loop cannot burn $25* N.
- **Recommendation:** In `cmd.md`, document `gcloud` or Console steps for `gcloud alpha services quota update` or `gcloud services quota ...` — but quotas for Maps are Console-managed, not `gcloud services` (note this in repro log).

Sources: Geocoding usage-and-billing (25 QPS, $200 credit line); Maps pricing page volume tiers; Service Terms quota-review clause (§4 Verification).

---

## 4. API key vs OAuth and Secret Manager handling

### 4.1 API key is the intended auth for this journal

| Factor | API key | OAuth 2.0 (service account) |
|---|---|---|
| **Supported for Places API (New)?** | Yes — primary method. Send `X-Goog-Api-Key: YOUR_KEY` or `key=` param. | Supported for *some* Maps services server-to-server, but not as the primary recommended path. Docs say “If you want to use OAuth … look for the OAuth topic in your API documentation” (api-security-best-practices) — many Places endpoints' OAuth topic is absent. |
| **Client vs server** | Works both; restriction type determines safety. | **Server-to-server only.** “Never expose service account keys in a client-side application that may be run by untrusted end users” (security guidance). |
| **Rotation / Secret Manager** | Key can be stored in Secret Manager, mounted as env or volume to Cloud Run. Rotation requires redeploy or volume reload. | Service account JSON also storable in Secret Manager, but broader permission scope (“extremely broad permissions”) → larger blast radius. |
| **Least privilege** | Restrict key to specific APIs (Places API (New) + Geocoding) and application type (IP addresses for server key, HTTP referrers for JS key). | IAM role for service account is project-level; harder to scope to “Places read-only”. |

**Verdict:** **API keys** for both browser (Maps JS + Places UI Kit) and server (Places Details). OAuth adds complexity without cost or security benefit for this use case. Only reconsider OAuth if a future Maps product requires it.

Sources: https://developers.google.com/maps/api-security-best-practices (sections “Use OAuth for server-side apps”, “Use separate API keys for each app”, “Restrict your API keys”, financial responsibility for unrestricted keys).

### 4.2 Secure key handling pattern (Cloud Run)

**Recommended pattern — two keys, least privilege:**

1. **Browser key (`maps_browser_key`):**
   - Application restriction: `HTTP referrers (web sites)` → `https://YOUR_DOMAIN/*`, `http://localhost:*` for dev.
   - API restrictions: `Maps JavaScript API`, `Places API (New)` (if JS Places library proxies via browser). Do **not** add Geocoding or Secret Manager to browser key.
   - Deliver to client via server-injected config at build-time, not hard-coded in git. Even though referrer-restricted, treat as public; set low quota (e.g., 10k/day) so leaked referrer spoof cannot scale.

2. **Server key (`maps_server_key`):**
   - Application restriction: `IP addresses (web servers, cron jobs, etc.)` → Cloud Run egress IPs (or `None` if behind Cloud Load Balancing with no stable IP; then rely on API restrictions + Secret Manager + VPC Service Controls).
   - API restrictions: `Places API (New)`, `Geocoding API`, `Place Photos (New)` equivalent, `Address Validation` if needed. **Not** Maps JS.
   - Stored in **Secret Manager** as `projects/PROJECT_ID/secrets/maps-server-key/versions/latest` (or pinned version). Do **not** write `AIza...` in source.

**Cloud Run injection — volume mount (preferred over env var):**

Why volume? Per https://cloud.google.com/run/docs/configuring/secrets:

> “When you mount each secret as a volume, Cloud Run makes the secret available to the container as files. When reading a volume, Cloud Run always fetches the secret value ... with the latest version. This method also works well with secret rotation.”  
> “Environment variables are resolved at instance startup time, so if you use this method, Google recommends that you pin the secret to a particular version instead of using `latest`.”

Journal should use **volume mount** so rotation doesn't require redeploy and compromised env-var leak is smaller (env vars are often dumped in error telemetry).

**Repro `cmd.md` fragment (to be appended verbatim in later plan ticket):**

```bash
# one-time: enable APIs + Secret Manager
gcloud services enable places.googleapis.com geocoding-backend.googleapis.com secretmanager.googleapis.com run.googleapis.com --project=$PROJECT_ID

# create secret (value from stdin, never echo in shell history)
printf "%s" "$MAPS_SERVER_KEY" | gcloud secrets create maps-server-key --data-file=- --project=$PROJECT_ID
# or update: printf "%s" "$NEW_KEY" | gcloud secrets versions add maps-server-key --data-file=- --project=$PROJECT_ID

# grant Cloud Run service account accessor
gcloud secrets add-iam-policy-binding maps-server-key \
  --member="serviceAccount:$RUN_SA" --role="roles/secretmanager.secretAccessor" --project=$PROJECT_ID

# deploy with volume mount (Cloud Run 2nd gen)
gcloud run deploy journal-api --image=$IMAGE --region=$REGION --project=$PROJECT_ID \
  --service-account="$RUN_SA" \
  --add-volume=name=maps-key,type=secret,secret=maps-server-key \
  --add-volume-mount=volume=maps-key,mount-path=/secrets/maps,path=server-key \
  --set-env-vars="MAPS_KEY_PATH=/secrets/maps/server-key"

# alternative: env var pinned version (not preferred)
gcloud run deploy journal-api --image=$IMAGE --region=$REGION --project=$PROJECT_ID \
  --update-secrets="MAPS_API_KEY=maps-server-key:3"

# browser key is injected at build, not at runtime: NEXT_PUBLIC_MAPS_BROWSER_KEY or Vite import.meta.env
```

Code reads key at runtime:

```ts
// server: never import key at build time
import { readFileSync } from "node:fs";
const keyPath = process.env.MAPS_KEY_PATH ?? "/secrets/maps/server-key";
const MAPS_SERVER_KEY = readFileSync(keyPath, "utf8").trim();
// use as header: 'X-Goog-Api-Key': MAPS_SERVER_KEY
```

**Restrictions setup (Console, reproducible note for `cmd.md`):**

- Cloud Console → Google Maps Platform → Credentials → Create API key → *Restrict key* → Application restriction + API restriction. Document screenshot step; there is no stable `gcloud` command for Maps API key restrictions (unlike `gcloud services api-keys` alpha — avoid scripting key creation; record manual step + `gcloud alpha services api-keys list` for verification).

**Anti-patterns to forbid (Custom Instructions will enforce):**

- `const API_KEY = "AIzaSy..."` in source → flag as critical flaw (mirrors codelab security guidance §4 `Prohibit Hardcoded Strings`).
- Client fetch to `places.googleapis.com` with server key → would exfiltrate billing-attributable key; must proxy through backend.

Sources: https://developers.google.com/maps/api-security-best-practices (“Safeguard your API keys by storing them securely outside your application's source code”, “You are financially responsible for charges caused by abuse of unrestricted API keys”); https://cloud.google.com/run/docs/configuring/secrets; codelab security hygiene §4 (Secret Manager `access_secret` sample in `codelab-baseline`).

---

## 5. Client vs server fetch

| Dimension | Client-side fetch (browser → Google) | Server-side fetch (browser → journal-api → Google) |
|---|---|---|
| **Key exposure** | Browser key visible in Network panel even if referrer-restricted; spoofable. Must be treated as public. | Server key never leaves Cloud Run; private. |
| **Billing attack surface** | Referrer can be spoofed; attacker could burn quota until daily cap. | Harder to abuse — behind Firebase Auth; can rate-limit per Vault. |
| **FieldMask control** | User could tamper with mask to request `*` and force Enterprise billing. | Backend whitelists allowed FieldMasks; untrusted input ignored. |
| **Caching** | Browser cache is per-device, not shared, TTL not enforced by policy. Service Terms §14.3 still applies but hard to audit. | Central `placeCache` in Firestore, TTL enforced, shared across devices of same user. Compliant and observable. |
| **CORS / latency** | Direct Google latency, no cold-start. | Extra hop (+ ~30–80 ms Cloud Run), but enables batching, review pagination, photo resizing proxy. |
| **Attribution** | Easier to satisfy “on a Google Map” requirement (Maps JS draws map → attribution automatic). | Server responses that are displayed without map must include Google logo/text attribution + photo/review authorship (Places Policies). Must add UI for this. |
| **Gemini grounding** | Would need to ship place blob to Gemini client-side — leaks key + place content. | Server composes `placeContext` and calls Vertex AI Gemini with proper grounding; auditable. |

**Recommendation for journal:** **Server-primary, client-supplementary.**

- `Autocomplete (New)` + `Text Search` + `Place Details` + `Place Photos` → **server**. Browser sends `query` or `placeId`; backend fetches with server key, applies FieldMask whitelist, writes to `placeCache`, returns sanitized payload to client.
- `Maps JavaScript API` rendering + lightweight `google.maps.places.Autocomplete` preview (session token) → **client** for low-latency typeahead, but session is completed via server (`Place Details (New)` with `sessionToken` from client) to get session-pricing benefit. Autocomplete Session Usage SKU is unlimited free, so client autocomplete does not trigger billing until session is closed with a Details call — close sessions on server where billing is metered.

Linkable note for UX ticket: “Make the picker feel instant (client autocomplete) but bill on server close-session.”

---

## 6. Caching policy — what the Terms actually allow

### 6.1 The two layers

1. **Platform Terms of Service §3.2.3 Restrictions Against Misusing the Services — (a) No Scraping, (b) No Caching** (https://cloud.google.com/maps-platform/terms) — general prohibition: “Customer will not pre-fetch, index, store, reshare, or rehost Google Maps Content ... will not cache ... except as expressly permitted under the Maps Service Specific Terms.” General cache default is **no caching**.

2. **Maps Service Specific Terms** (https://cloud.google.com/maps-platform/terms/maps-service-terms) — per-service exceptions. Plus **Places Policies** overlay (https://developers.google.com/maps/documentation/places/web-service/policies).

### 6.2 What is permitted for this stack

| Content | Allowed cache | Delete / expiry | Source |
|---|---|---|---|
| `place_id` / `id` (`name` field in New) | **Indefinite** | Never — exempt from caching restrictions. | Places Policies → Exceptions from caching restrictions (“place ID ... exempt ... store indefinitely”); Service Terms §3 Google ID Caching (place_id from Places API). |
| `location` lat/lng, `viewport` area, latitude/longitude from Geocoding / Places / Directions | **30 consecutive calendar days**, then delete. | Hard delete at 30 days. | Service Terms B.6.3.1 (Geocoding), B.14.3 (Places API Legacy and New), B.4.3 (Directions), B.7.3 (Geolocation). All read 2026-09-04: “temporarily cache latitude and longitude values ... for up to 30 consecutive calendar days, after which Customer must delete the cached latitude and longitude values.” |
| `formatted_address` / `formattedAddress` and structured address from Geocoding | Two modes: (a) temporary 30 days for any purpose, (b) **indefinite** *only* to support direct end-user functionality of the application that initiated request, logically isolated to that End User, not as replacement for a later call (see below). | If (b), keep until termination but isolate per user. | Service Terms B.6.3.2: “Customer may indefinitely cache latitude, longitude, formatted_address ... solely to support the direct, End User facing functionality ... only where the cache is not used as a replacement for making an additional call ... Cached data must be logically isolated to the specific End User ... must not be used across multiple End Users.” This is why per-Vault isolation (§7 below) is not just security — it's *terms compliance*. |
| All other Places content (`displayName`, `editorialSummary`, `reviews`, `photos` metadata, `currentOpeningHours`, `priceLevel`, etc.) | **Not permitted to cache beyond 30 days; effectively treat as 30-day max, but delete earlier for freshness.** No “indefinite” carve-out in Service Terms for these fields. Places Policies restates “You must not pre-fetch, cache, or store Places API content beyond the allowed exceptions.” | Delete at 30 days; recommendation 7 days for volatile fields. | Service Terms A §3.2.3(b) general; B.14.3 only permits lat/lng. Absence of broader permission = prohibition. Grounding Lite Grounded Output has explicit 30-day exception (§10.2.2) — reinforces that Places Details without such clause is narrower. |
| `photos` binary (image media) | Same as above — content of Places API. May be cached only within same constraints; advise not to cache image bytes in Firestore (store reference + fetch via Photos media URL with short-lived auth). | Delete media cache at 30 days; better to re-fetch via `photos[].name` media endpoint on demand. | Places Policies attribution requirement for photos implies revalidation. |
| Grounded Output (if using Maps Grounding Lite API to ground Gemini) | 30 consecutive days “solely for evaluating and optimizing performance/display” | Delete after 30 days. | Service Terms B.10.2.2. |

**Bottom line for journal placeCache:** Do not treat Firestore as a long-lived warehouse of Google content beyond `place_id` and (with per-user isolation) `formattedAddress`. The journal's value — “that café was great” — must be **user-authored** (Entry/Reflection), not a copy of Google's catalogue. The `placeCache` is a *performance + cost* cache, not a data lake.

### 6.3 Recommended TTL per field group

| Group | TTL target | Hard expiry | Rationale |
|---|---|---|---|
| `place_id` / canonical `googleMapsUri` id | Indefinite (until place is moved/closed) | On webhook or user refresh — listen for `movedPlace`/`businessStatus=CLOSED_PERMANENTLY` then evict | Exempt from cache cap. |
| `formattedAddress`, `addressComponents`, `location` | **30 days hard cap**, **7 days target** | Delete row at 30 days; background refresher at 7 days for active vaults | Volatile as businesses move; 7-day keeps journal credible without burning quota daily. |
| `displayName`, `primaryType`, `types`, `businessStatus`, `icon*` | 30 days hard, 7 days target (same row) | Revalidate if stale `cachedAt` older than 7d on next entry load | Relatively stable, but cheap to refresh. |
| `editorialSummary`, `generativeSummary`, `reviewSummary` | **24 hours – 7 days** (default 48h) | Hard 30d; but refresh faster because editorial copy can be updated by Google. | Higher billing tier — short TTL prevents serving stale $25 content. |
| `reviews` | **24 hours** | Hard 30d | Reviews are user-generated and frequent; stale reviews mislead. Fetch on explicit expand + cache 24h. |
| `regularOpeningHours`, `currentOpeningHours` | **24 hours** | Hard 30d | Hours change for holidays/special hours; `currentOpeningHours` includes `openNow` that is point-in-time — caching it at all is questionable; either don't cache `currentOpeningHours` (always fresh) or TTL 1h. Recommendation: cache `regularOpeningHours` 24h, **do not cache `currentOpeningHours`** — recompute server-side on each load or replace with live fetch. |
| `photos` metadata (`photos[].name`, attributions) | 7 days metadata; **do not cache image bytes in Firestore** (cache URLs + attributions only) | Delete at 30d | Image bytes attribution shift; re-fetch media with placePhotoName. If using CDN, set Cache-Control 24h. |
| `rating`, `userRatingCount`, `priceLevel` | 24h–7d | Hard 30d | Serve stale gracefully but refresh on background. |

Implementation shape (see §7): row stores `cachedAt`, `expiresAt = cachedAt + min(ttlForField, 30d)`, `fetchedFieldMask` (which SKUs were paid). On read: if `now > expiresAt`, re-fetch before returning to Gemini grounding. If `now > cachedAt + targetTTL`, background revalidate asynchronously but serve stale with `stale: true` flag.

**Required rule:** Never serve cached Google content after 30 days without re-fetch — delete the row (or at least the non-exempt fields) and re-fetch on next use. Keep `place_id` row skeleton so link remains.

Sources: Platform Terms §3.2.3; Service Terms B.14.3, B.6.3.1/6.3.2, B.10.2.2; Places Policies “You must not pre-fetch, cache, or store ... beyond the allowed exceptions ... place_id is exempt”.

---

## 7. Baseline Firestore isolation — what the place cache per-Vault requires

### 7.1 Baseline from codelab (Personal Gemini Journal)

The codelab source (https://codelabs.developers.google.com/codelabs/cloud-run/cloud-run-ai-challenge) specifies:

- **Cloud Run + Firebase Auth + Firestore (Vault-isolated) + Gemini API.**
- Security checklist (Step 2, “Add Custom Instructions”): RBAC via `get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role`, JWT verification via Firebase Admin SDK on backend, “Firestore Vault isolation” mentioned in wayfinder map Issue #1 notes.

The exact codelab snippet read 2026-09-04 includes the “Custom Instructions” evaluation rubric and the security section stating:

> **Role-Based Access Control (RBAC)**: Use custom claims or dynamic document lookups (`get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role`) for elevated administrative operations.  
> **Auth State Integrity**: Verify JWT tokens on backend server environments (e.g., Cloud Functions or Cloud Run) using the Firebase Admin SDK.  
> **Secret Management ... Google Cloud Secret Manager Integration** ... (with `secretmanager.SecretManagerServiceClient` sample).

There is not yet a `CONTEXT.md` or `docs/adr/` in this repo (checked 2026-09-04 — `CONTEXT.md` absent, `docs/adr` not present); map glossary is starter: `Entry, Reflection, Grounding, Place, Session, Vault`.

### 7.2 Recommended per-Vault cache schema

**Why per-Vault:** Service Terms B.6.3.2 indefinite cache for `formatted_address` is only allowed “logically isolated to the specific End User … must not be used across multiple End Users.” Even temporary 30-day lat/lng caching is safer per-user. And the journal's product promise is Vault-isolated entries — a shared global place cache that leaks one user's visited places to another would be a privacy bug and a terms breach.

Two viable shapes — recommend **Option A** (subcollection) for strict isolation:

```text
vaults/{vaultId}/
  entries/{entryId}         ← journal entries (user-authored; already Vault-scoped)
    placeId: string         ← denormalized reference to cache row (not embedded copy)
  placeCache/{placeId}      ← per-Vault cache shard
    placeId: string         ← canonical Places (New) id e.g. "places/ChIJ..."
    legacyPlaceId: string?  ← if migrated
    displayName: {text, languageCode}
    formattedAddress: string
    location: {lat, lng}
    primaryType: string
    types: string[]
    editorialSummary: {text, languageCode}?
    generativeSummary / reviewSummary?
    rating, userRatingCount, priceLevel?
    regularOpeningHours: {periods, weekdayDescriptions}?
    # Do NOT store currentOpeningHours.openNow — volatile; store regular and compute openNow server-side
    photos: Array<{name, widthPx, heightPx, authorAttributions[]}>?  // metadata only
    reviews: Array<{authorAttribution, rating, text, publishTime}>? // truncated, 24h TTL
    attributions: string[]          // required display strings passed to client
    googleMapsUri: string
    websiteUri?: string
    fetchedFieldMask: string        // e.g. "id,displayName,formattedAddress,location"
    skuTier: "essentials"|"pro"|"enterprise"|"enterprise+atmosphere"|"mixed"
    cachedAt: Timestamp
    expiresAt: Timestamp            // cachedAt + 30d max, but query on cachedAt+targetTTL
    staleAfter: Timestamp
    fetchedBy: uid
    version: number
```

```firestore
// Option B alternative (if wanting single collection with composite key):
placeCaches/{vaultId}_{placeId}
  vaultId: string
  placeId: string
// then query by vaultId; rules need vaultId == request.auth.token.vaultId
```

Option A is preferred because Firestore Security Rules for subcollections naturally scope: `match /vaults/{vaultId}/placeCache/{placeId}` with `allow read, write: if request.auth != null && isOwner(vaultId)` — no cross-Vault query needed. Option B duplicates isolation logic.

**Do NOT do:** `placeCache/{placeId}` as a global top-level collection shared across vaults. That would violate B.6.3.2 and leak visit history across users; also a Firestore Rules bypass (any authed user could guess `placeId`).

### 7.3 Security Rules (least-privilege)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isSignedIn() { return request.auth != null; }
    function isVaultOwner(vaultId) {
      // vault document stores ownerUid; or vaultId == request.auth.uid for single-vault-per-user model
      return isSignedIn() && get(/databases/$(database)/documents/vaults/$(vaultId)).data.ownerUid == request.auth.uid;
      // Alternative if vaultId == uid: return request.auth.uid == vaultId;
    }

    match /vaults/{vaultId} {
      allow read, write: if isVaultOwner(vaultId);

      match /entries/{entryId} {
        allow read, write: if isVaultOwner(vaultId)
          && (resource == null || resource.data.vaultId == vaultId)
          && request.resource.data.vaultId == vaultId;
      }

      match /placeCache/{placeId} {
        // per-Vault cache — only owner can read/write; backend service account bypasses via Admin SDK
        allow read, write: if isVaultOwner(vaultId);
        // Optional: validate expiresAt is not fabricated to circumvent 30-day rule
        allow create, update: if request.resource.data.expiresAt <= request.time + duration.value(30, 'd');
      }
    }
    // No top-level global placeCache
  }
}
```

**Backend bypass:** Cloud Run service account uses Firebase Admin SDK (`admin.firestore()`) which bypasses rules — that's intended. Rules protect against client-side reads/writes; all place fetches should go through the backend so rules are defense-in-depth, not primary gate. Add `appCheck` if using client autocomplete writes.

### 7.4 Entry grounding linkage

Entries store `placeId` pointer, not embedded copy of place details, so:

- Entry document: `{ title, body, placeId, placeSnapshotAtEntryTime?: {displayName, formattedAddress, editorialSummary?} }` — the snapshot inside Entry is *copy for rendering historical entry* and is user-visible content but is arguably a cache; keep its TTL same as placeCache or store as “Entry's own content derived at entry time” (arguably End User's journal, not Google content cache). Safer to store only `placeId` + tiny snapshot of `displayName`+`formattedAddress` that can be re-resolved.
- Gemini grounding prompt composes at read time from fresh `placeCache` row, not from stale Entry snapshot.

Source chain: codelab baseline (vault-isolated Firestore + Firebase Auth + Secret Manager); Service Terms B.6.3.2 / B.14.3 isolation requirement; Firebase Security Rules structuring doc https://firebase.google.com/docs/firestore/security/rules-structure (referenced per `firestore-security-rules` fetch).

---

## 8. Custom Instructions expansion draft — secure Maps integration

This draft is intended to be appended to the repo's **Custom Instructions** file (the codelab's `custom_instructions.md` / `GEMINI.md` / repo root `AGENTS.md` extension — exact path to be decided by ADR ticket). It follows the codelab's 5-section shape (objective → code patterns → reviewer persona) and the project's “every new integration expands Custom Instructions” standing preference (Issue #1 Notes).

> **Copy-paste anchor for the future ADR/plan:** Put this under `## 6. Maps & Places Grounding — Secure Integration` in Custom Instructions. Keep verbatim so `cmd.md` repro and security review checklist can reference it.

```markdown
## 6. Maps & Places Grounding — Secure Integration

### 6.1 Objective
Ground journal Entries and Gemini Reflections in semantic Place context (Places API (New) Place Details, Text Search, Place Photos) without leaking billing-attributable keys, violating Maps Terms caching rules, or breaking Vault isolation. Every place fetch must be server-mediated, field-mask minimal, attribution-preserving, and per-Vault cached with expiry.

### 6.2 Mandatory Code Patterns

**Prohibit:** Any client-side call to `places.googleapis.com` with a server-scoped key; any hardcoded `AIza...` string; any `X-Goog-FieldMask: *` in production; any global `placeCache/{placeId}` collection.

**Require — Server key handling (Cloud Run + Secret Manager volume mount):**
```ts
import { readFileSync } from "node:fs";
// NEVER: const KEY = "AIza...";
// ALWAYS:
const keyPath = process.env.MAPS_KEY_PATH ?? "/secrets/maps/server-key";
const MAPS_SERVER_KEY = readFileSync(keyPath, "utf8").trim();
const headers = {
  "X-Goog-Api-Key": MAPS_SERVER_KEY,
  "X-Goog-FieldMask": ALLOWED_MASK, // whitelist, not user input
};
```

**Require — FieldMask whitelist (cost guardrail):**
```ts
const CORE_MASK = "id,displayName,formattedAddress,location,primaryType,types,businessStatus,viewport,addressComponents";
const ENRICHED_ATMOSPHERE_MASK = "editorialSummary,generativeSummary,reviewSummary,reviews,rating,userRatingCount,priceLevel,regularOpeningHours,websiteUri,nationalPhoneNumber,internationalPhoneNumber";
const PHOTO_MASK = "photos"; // billed as Photos SKU separately
// Reject any user-supplied mask; pick CORE by default, ENRICHED only on explicit expand.
function maskForRequest(wantsEnriched: boolean, wantsPhotos: boolean) {
  if (wantsPhotos) return `${CORE_MASK},photos`;
  return wantsEnriched ? `${CORE_MASK},${ENRICHED_ATMOSPHERE_MASK}` : CORE_MASK;
}
```

**Require — Per-Vault cache path & TTL enforcement:**
```ts
// Firestore path: vaults/{vaultId}/placeCache/{placeId}
const snap = await admin.firestore().doc(`vaults/${vaultId}/placeCache/${placeId}`).get();
if (snap.exists) {
  const { cachedAt, expiresAt } = snap.data();
  if (Date.now() > expiresAt.toMillis()) {
    await snap.ref.delete(); // hard 30-day expiry — do not serve stale
  } else if (Date.now() > cachedAt.toMillis() + TARGET_TTL_MS) {
    // background revalidate, serve stale with stale:true flag
    revalidateInBackground(vaultId, placeId);
  }
}
await snap.ref.set({
  ...freshPlace, cachedAt: FieldValue.serverTimestamp(),
  expiresAt: Timestamp.fromMillis(Date.now() + 30*24*3600*1000),
  fetchedFieldMask: maskUsed, skuTier, fetchedBy: auth.uid,
}, { merge: true });
```

**Require — Attribution passthrough:**
```ts
// Every response that includes Google content must forward attributions.
return { place, attributions: place.attributions, photoAttributions: place.photos?.flatMap(p=>p.authorAttributions) };
// Client renders: <img ...> + author line + Google logo/text per https://developers.google.com/maps/documentation/places/web-service/policies
```

**Require — Client/server boundary:**
- Autocomplete keystroke: client may call `google.maps.places.Autocomplete` (session token) OR `POST /api/places/autocomplete` (server proxy). Session is closed server-side: `POST /api/places/details {placeId, sessionToken}` with server key.
- Place Photos media: server proxies `GET /api/places/{placeId}/media?maxWidthPx=...` — do not expose media URL with server key to client.

### 6.3 Vault & Privacy Invariants

- `vaults/{vaultId}/placeCache/{placeId}` — never `placeCache/{placeId}` global.
- `formattedAddress` indefinite cache only allowed if `vaultId` isolation holds and not used to avoid a future call for a different user — enforce by rule `get(.../vaults/$(vaultId)).data.ownerUid == request.auth.uid`.
- Entry documents store `placeId` pointer; any embedded snapshot must be treated as stale after TTL and re-resolved via cache.
- Reviews contain PII (author names). Privacy Policy must disclose Maps content retention and 30-day deletion. Do not send user PII to Maps APIs (Platform Terms §4.4(b)/Data Protection).

### 6.4 Gemini Grounding Contract

When an Entry references `placeId`, the backend composes:

```
placeContext = {
  name: placeCache.displayName,
  address: placeCache.formattedAddress,
  editorialSummary: placeCache.editorialSummary?.text, // only if ENRICHED and TTL fresh
  rating: placeCache.rating,
 _hours: placeCache.regularOpeningHours?.weekdayDescriptions, // never currentOpeningHours.openNow from cache
  attributions: placeCache.attributions,
}
systemInstruction += "\n\n[Place Grounding — generated from Google Maps, ${cachedAt}]" + JSON.stringify(placeContext)
```

- Do **not** send `photos` bytes or full `reviews` array to Gemini unless user explicitly asked for review-aware reflection (cost + prompt bloat). Send `reviewSummary` if available.
- Include attribution lineage in any Grounded Output stored: if Maps Grounding Lite is introduced later, its 30-day Grounded Output cache rule (Service Terms B.10.2.2) applies.

### 6.5 Security Reviewer Checks (pre-commit / PR gate)

- [ ] No `AIza` literal in diff (`rg -n "AIza" --hidden` must be clean).
- [ ] No `X-Goog-FieldMask: *` or dynamic mask from request body.
- [ ] Secret mounted via volume (`--add-volume type=secret`), not plaintext env.
- [ ] API key has application restriction (IP or referrer) + API restriction (Places New, Geocoding) — screenshot in PR.
- [ ] Firestore rules deny cross-Vault `placeCache` read (negative test: user B cannot read vault A cache).
- [ ] Cache row has `expiresAt <= now+30d` and background job deletes at 30d.
- [ ] Photo/review attributions rendered in UI (snapshot test).
- [ ] Daily quota + budget alert (`gcloud billing budgets` or Console) set and logged in `cmd.md`.

### 6.6 Repro Log Anchor (append to `cmd.md`)

Every `gcloud` Maps/Secret Manager/Run command from §4 must be copy-paste runnable in `cmd.md`. Include project selection, enabling services, secret creation, IAM binding, deploy with volume mount, and Console quota/budget screenshot steps.

Sources: codelab §4 Secret Manager & §5 Security Reviewer (codelab-baseline); Maps api-security-best-practices; Cloud Run secrets (https://cloud.google.com/run/docs/configuring/secrets); Places Polices attribution; Service Terms caching §B.14.3/§B.6.3.
```

---

## 9. Cost guardrails — concrete settings

| Guardrail | Setting | Where | Notes |
|---|---|---|---|
| **Budget alert** | Billing budget $50 soft alert at 50% ($25), hard alert at 90% ($45); pub/sub → email/Slack | Console Billing → Budgets & alerts or `gcloud billing budgets create` | Link to project; $50 is starter — raise after first month of real usage. |
| **Daily API quota caps (per-SKU)** | Text Search Pro 5k/day, Place Details Pro 5k/day, Enterprise 1k/day, Photos 2k/day | Console → Google Maps Platform → Quotas | Prevents runaway loop that would otherwise scale as `$32 * N`. Quotas are Maps-specific, not IAM quota. |
| **FieldMask minimalism** | Default CORE (Essentials+Pro); Atmosphere fields behind explicit expand endpoint `/api/places/details?enriched=true` that requires auth and is rate-limited | Backend code — whitelist in §8.2 | Single biggest cost lever: avoiding $25 SKU unless needed. |
| **Photo throttling** | Max 1 photo per entry by default; paginate additional photos on user scroll; cache media metadata 7d, not bytes | Backend + CDN | Photos SKU $7/1k — 10 photos per details × N entries scales fast. |
| **Session tokens** | Create `sessionToken = uuid()` at autocomplete start; close with `Place Details (New)` server call that sends `sessionToken` header | Client (token) + server (close) | Converts many Autocomplete Requests ($2.83/1k) into cheaper session usage (unlimited free entry per pricing table). Requires Autocomplete (New). |
| **Per-Vault, per-user rate limit** | e.g., 60 place searches/min per uid, 100 details/day per uid | Cloud Run middleware or Firestore counter | Prevents one compromised vault from burning global quota. |
| **$200 credit note** | Do not budget assuming $200 credit — treat as $0 | — | Credit expired 2025-02-28 per Geocoding page; verify current account's Billing → Credit. |
| **Maps JS loads guardrail** | If using Maps JS, cap Dynamic Maps loads (separate SKU ~$7/1k) | Same Quotas panel | Not in Places table but adjacent — set cap 10k/day. |

**Operational note for `cmd.md`:** Document `gcloud billing budgets describe` and quota screenshot steps even if they are Console clicks — repro means “person can re-create from log,” not strictly `gcloud` automation. See Issue #1 standing preference: “every `gcloud` command (auth, config, firestore, secret manager, run deploy) is appended copy-paste runnable to `cmd.md`.”

---

## 10. ADR pointers & UX linkability

This fact sheet is designed to be cited by the next tickets without re-researching:

| Downstream ticket | How to cite this file | Section to link |
|---|---|---|
| **UX — picker vs auto-detect vs map-search** | `research/places-api-findings.md#5-client-vs-server-fetch` and `#1.3 what each API does` | Client/server split, session-token autocomplete, Maps JS requirement for “on a Google Map” attribution |
| **ADR — Places (New) selection** | `research/places-api-findings.md#1-places-api-new-vs-...` + `#2 place details fields` | FieldMask SKUs, editorialSummary tier, legacy deprecation risk |
| **ADR — Firestore schema / Vault isolation** | `research/places-api-findings.md#7-baseline-firestore-isolation` + Security Rules snippet | `vaults/{vaultId}/placeCache/{placeId}` vs global; B.6.3.2 isolation compliance |
| **ADR — caching & expiry policy** | `research/places-api-findings.md#6-caching-policy` + TTL table | 30-day hard cap, per-field TTLs, `place_id` indefinite |
| **ADR — key handling & threat model** | `research/places-api-findings.md#4-api-key-vs-oauth` + Cloud Run volume-mount `cmd.md` block | Two keys, Secret Manager volume, referrer vs IP restrictions |
| **Custom Instructions PR** | `research/places-api-findings.md#8-custom-instructions-expansion-draft` | Copy-paste §6 block |
| **Budget / SRE ticket** | `research/places-api-findings.md#9-cost-guardrails` + `#3 pricing quotas` | Quota caps, budget alerts, FieldMask minimalism |
| **`cmd.md` repro ticket** | `research/places-api-findings.md#4.2` gcloud block + `#8.6` anchor | Secret creation, IAM binding, volume mount deploy |

Suggested ADR draft title: `ADR-0002: Places API (New) + per-Vault 30-day placeCache with server-side Secret Manager key` — reference this file as “Context” link.

---

## 11. Risks, unknowns, and follow-up questions

1. **Legacy sunset date not pinned:** Pricing page still lists legacy SKUs but no firm shutdown announcement was parsed on 2026-09-04 (migrate-to-new URL returned 404 — docs structure changed). Follow-up: subscribe to https://developers.google.com/maps/deprecations and verify in Console that legacy project still provisions. Assume 12-month warning before hard removal — do not depend on legacy for new data.

2. **Cloud Run egress IP stability:** If the service is behind Cloud Run domain mapping without static IP, `IP restriction` on server key is ineffective. Alternative: leave server key with `None` application restriction and rely on API restrictions + VPC Service Controls perimeter. ADR should decide and document.

3. **Indefinite `formattedAddress` per-user cache vs. journal history:** Journal entries arguably are “End User facing functionality that initiated the request” — may justify indefinite `formattedAddress` retention per B.6.3.2. Conservative stance taken here (30-day delete) to avoid optimistic legal reading; legal review ticket can relax to indefinite if product counsel approves isolation proof.

4. **`currentOpeningHours.openNow` cacheability:** `openNow` is time-sensitive; caching it misleads. The TTL table recommends not caching `currentOpeningHours` at all. Needs UX decision: compute `openNow` on server from `regularOpeningHours` + current time vs. always fresh fetch.

5. **Place Photos display credential:** Media URL may require `X-Goog-Api-Key` each fetch; CDN caching image bytes with key-embedded URL risks key leak in logs. Proxy via backend (signed short-lived URL) fixes but adds egress cost — spike ticket should prototype both.

6. **Geocoding QPS vs. Places QPS contention:** Both share project quota pool in some older accounts; verify quotas page lists them separately. If coupled, a geocoding burst could throttle place details.

7. **EEA ToS variant:** Service Terms header notes EEA-specific terms for billing address in EEA (different caching & attribution language). The EU billing case must read https://cloud.google.com/maps-platform/terms/maps-platform-eea etc. — not parsed here.

---

## 12. Source ledger (fetch log for verifiability)

All URLs fetched via `ctx_fetch_and_index` or sandbox `fetch` on 2026-09-04; markdown indexed as FTS5 sources (labels below). Raw HTML not stored; parsed text windows cited inline.

- `places-new-overview` — https://developers.google.com/maps/documentation/places/web-service/overview
- `places-details` / `places-field-mask` — https://developers.google.com/maps/documentation/places/web-service/place-details (+ `#fields` anchor)
- `places-photos-new` — https://developers.google.com/maps/documentation/places/web-service/place-photos
- `places-pricing` — https://developers.google.com/maps/billing-and-pricing/pricing (core pricing list, includes Places API (New) block parsed with 0–100k tier)
- `places-usage-billing` — https://developers.google.com/maps/documentation/places/web-service/usage-and-billing (SKU → pricing list mapping)
- `places-policies` — https://developers.google.com/maps/documentation/places/web-service/policies (place_id exempt, attribution, no caching beyond exceptions)
- `maps-api-security-best-practices` — https://developers.google.com/maps/api-security-best-practices (restrict keys, separate keys per app, OAuth for server-to-server)
- `cloud-run-secret-manager` — https://cloud.google.com/run/docs/configuring/secrets (volume vs env var, “always fetches latest” for volume)
- `maps-service-terms` + second parse `maps-service-terms` detailed — https://cloud.google.com/maps-platform/terms/maps-service-terms (B.14.3 Places caching lat/lng 30d, B.6.3 Geocoding, B.10.2.2 Grounding Lite 30d, §3 ID caching)
- `maps-service-terms-legacy-alias` — https://cloud.google.com/maps-platform/terms (generic ToS §3.2.3 No Scraping / No Caching)
- `codelab-baseline` — https://codelabs.developers.google.com/codelabs/cloud-run/cloud-run-ai-challenge (Vault-isolated Firestore, Secret Manager sample, Custom Instructions rubric)
- `maps-js-places` — https://developers.google.com/maps/documentation/javascript/places (shared quota, libraries=places, API restrictions)
- `geocoding-overview` / `geocoding-usage` — https://developers.google.com/maps/documentation/geocoding/overview + /usage-and-billing (25 QPS, Geocoding SKU)
- `secret-manager-docs` — https://cloud.google.com/secret-manager/docs/overview
- `gemini-custom-instructions` — https://ai.google.dev/gemini-api/docs/system-instructions (systemInstructions pattern for Gemini grounding — cited for Custom Instructions shape)
- `firestore-security-rules` — https://firebase.google.com/docs/firestore/security/rules-structure (rules_version 2, `get()` RBAC pattern)
- `data-fields` — https://developers.google.com/maps/documentation/places/web-service/data-fields (full property → SKU matrix: `editorialSummary` → Enterprise+Atmosphere etc.)
- Plus sandbox direct fetches for pricing table raw lines and data-fields property windows (parsed 771 lines) on 2026-09-04.

Indexed via `ctx_fetch_and_index` with `concurrency: 5`, then verified with `ctx_search` (5 calls) and sandbox `fetch` HTML-stripped parsers. No secondary blog/LLM summary used — every claim traces to an official domain (`developers.google.com`, `cloud.google.com`, `codelabs.developers.google.com`, `ai.google.dev`, `firebase.google.com`).

---

## 13. Checklist for the next agent/human (wayfinder continuation)

- [ ] Create `docs/adr/0002-places-api-new.md` citing this file (#1, #2, #6, #7).
- [ ] Create/update `CONTEXT.md` glossary: formalize Place (Google Place with `place_id`), Vault (user-isolated Firestore root), Grounding (placeContext injection into Gemini), Session (autocomplete session token).
- [ ] Wireframe picker UX citing §5 (server-close session pattern) — keep link `research/places-api-findings.md#5`.
- [ ] Draft `cmd.md` entries for Secret Manager + Run volume mount (copy block from §4.2) — verify `gcloud run deploy --add-volume` syntax on writer's Cloud SDK version.
- [ ] Open follow-up issues for risks §11 items 2 & 4 (egress IP, openNow).
- [ ] Set billing budget + quota caps in the dev GCP project and record screenshots/commands in `cmd.md`.

---

*End of fact sheet. Keep this branch as a linkable artifact — do not merge to `main`. UX and ADR tickets should link to this file's section anchors.*

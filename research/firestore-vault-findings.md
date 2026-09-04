# Research: Firestore Vault Isolation + Schema for Entries and Place Cache — Findings Fact Sheet

> **Ticket:** #4 (part of #1 wayfinder map) — `wayfinder:research`  
> **Branch:** `research/firestore-vault` (throwaway)  
> **Date:** 2026-09-04 | **Repo:** PSergio984/genai-cohort3

---

## TL;DR Recommendation

| Collection | Path | Isolation | Why |
|---|---|---|---|
| Vaults | `vaults/{vaultId}` fields: `ownerUid, createdAt` | `ownerUid == request.auth.uid` | Codelab baseline uses owner-bound isolation |
| Entries | `vaults/{vaultId}/entries/{entryId}` fields: `ownerUid, text, placeId, groundingSnapshot, createdAt` | Vault rule inherits owner check | Map history per Vault |
| PlaceCache (recommended) | `vaults/{vaultId}/placeCache/{placeId}` fields: `placeJson, fetchedAt, expiresAt` | Per-Vault subcollection, not global | Global `placeCache/{placeId}` would violate Service Terms B.6.3.2 per-user isolation for cached Maps content |
| Shared placeId index | None — place_id exempt per Policies#exceptions, but other fields not | Don't share cache across Vaults | 30-day delete requires per-Vault expiry guard |

---

## 1. Codelab Baseline Isolation

Codelab Personal Gemini Journal: interactions saved to Firestore, isolated strictly to this user so different users can't read each other's entries. Production Directives #5 (Firestore isolation) requires owner-bound rules. Baseline path in AI Studio prompt: `users/{uid}/entries` — we rename to `vaults/{vaultId}` per starter glossary (Vault).

---

## 2. Proposed Schema

**vaults**
- `vaultId` (doc id, e.g., uid)
- `ownerUid: string`
- `displayName: string`
- `createdAt: timestamp`

**vaults/{vaultId}/entries**
- `entryId: auto`
- `ownerUid: string` (denormalized for rule)
- `text: string`
- `placeId: string | null`
- `groundingSnapshot: map | null` (minimal place fields used at write time — for attribution/hallucination audit)
- `geminiReflection: string`
- `createdAt: timestamp`

**vaults/{vaultId}/placeCache**
- `placeId` (doc id)
- `placeJson: map` (full Place Details subset, includes attributions)
- `fetchedAt: timestamp`
- `expiresAt: timestamp` (= fetchedAt + 7 days, hard delete <=30d via TTL or scheduled function)

Indexes: `vaults/{vaultId}/entries` composite on `ownerUid + createdAt desc` for history view. TTL policy on `expiresAt` (Firestore TTL or Cloud Scheduler cleanup).

---

## 3. Security Rules (required for Vault isolation)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Vault must be owned by caller
    match /vaults/{vaultId} {
      allow read, write: if request.auth != null
        && get(/databases/$(database)/documents/vaults/$(vaultId)).data.ownerUid == request.auth.uid;

      match /entries/{entryId} {
        allow read, write: if request.auth != null
          && resource.data.ownerUid == request.auth.uid
          && request.resource.data.ownerUid == request.auth.uid;
        // create must set ownerUid == auth.uid, placeId nullable
      }

      match /placeCache/{placeId} {
        // Enforce 30-day Service Terms B.14.3 guard
        allow read, write: if request.auth != null
          && get(/databases/$(database)/documents/vaults/$(vaultId)).data.ownerUid == request.auth.uid
          && request.resource.data.expiresAt <= request.time + duration.value(30, 'd');
        // Optional: deny read if expiresAt < request.time (stale)
      }
    }
  }
}
```

Source pattern matches codelab Production Directives #5 recipe (firebase.google.com/docs/firestore/security/rules-conditions) and Vault term from glossary.

**Why per-Vault placeCache?** Maps Service Terms B.6.3.2: cached place content must remain end-user isolated if user-provided location. Global cache would leak place lookups across users.

---

## 4. Cache Expiry Policy Link to Maps Terms

- lat/lng: 30 days max, then delete (Service Terms B.14.3) — aligns with expiresAt hard delete
- place_id: exempt indefinitely (Policies#exceptions) — store placeId separately without expiry
- other Place fields (reviews, hours): ≤30d, recommended 7d target + 24h for hours/reviews freshness

Verified against findings from ticket #2 (research/places-api-findings.md section 6.3).

---

## 5. gcloud Deploy Snippet for Rules

```bash
# init firestore in native mode (once)
gcloud firestore databases create --location=us-central1 --type=firestore-native

# deploy rules (repro in cmd.md)
firebase deploy --only firestore:rules  # or gcloud with firestore.rules file
gcloud firestore operations list --project=$PROJECT_ID
```

---

## 6. Linkability

- ADR #8: schema + rule rationale, ADR pointer section 5
- UX #7: history map view reads vaults/{vaultId}/entries + placeCache join
- Prototype #9: mock placeCache docs without live Maps key

Sources: firebase.google.com/docs/firestore/data-model, firebase.google.com/docs/firestore/security/rules-structure, codelab #1 Production Directives

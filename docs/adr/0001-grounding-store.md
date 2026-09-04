# Per-Vault grounding store with frozen snapshots

Journal Entries ground in shared public Places, but Maps terms cap place-data caching at 30 days and require per-user isolation — while history must stay an honest audit of what Gemini saw at reflection time. So: the place cache lives per-Vault at `vaults/{vaultId}/placeCache/{placeId}` (never a shared global collection); each Grounding embeds a frozen minimal snapshot (place_id, name, address, attributions, fetchedAt); retention is 7-day core target / 24h freshness for reviews-hours / 30-day hard delete, enforced by a Firestore TTL policy on backend-computed `expiresAt` plus a lazy stale-check on read; and frozen Groundings never follow later cache refreshes. Schema: `vaults/{vaultId}` (ownerUid), `entries/{entryId}` (denormalized ownerUid, text, placeId, groundingSnapshot, geminiReflection, createdAt; history index ownerUid + createdAt desc), `placeCache/{placeId}` (placeJson, fetchedAt, expiresAt) — all in the `grounded-journal` database.

## Considered Options

- **Shared global cache**: cheaper on duplicate places, rejected — isolation would rest entirely on rules getting it right, and one mistake leaks place lookups across Vaults.
- **Bare cache references (no embedded snapshot)**: rejected — cache expiry would orphan old Groundings, leaving history pointing at nothing.
- **Scheduled cleanup function**: rejected — precise timing isn't worth owning Scheduler + function infra for a journal; TTL plus lazy-check covers both the legal guarantee and read freshness.

## Consequences

- Duplicate place payloads across Vaults: accepted storage cost in exchange for isolation by construction.
- Named database reports `freeTier: false`: keep the Maps + Gemini budget alerts; tiny dev volumes cost ~nothing but the guardrail stays.
- `firestore.rules` deploys must target `grounded-journal`, and the rules keep the `expiresAt <= now + 30d` ceiling as backstop behind backend-computed expiry.

# Threaded turns replace the single-reflection field

Entries first stored one `geminiReflection` string, so repeat reflects overwrote history and user follow-ups lived nowhere. Now every turn persists in `turns: [{by, text, placeIds}]`: user turns from each reflect call plus each model reply, with the entry's placeIds frozen onto every turn as the per-reflection audit (reconstructing what each reply saw from the immutable snapshots).

## Considered Options

- **Dual fields (`reflections` + `turns`)**: rejected — two sources of truth for one thread; the freeze check and history reads would have to agree on precedence forever.
- **Subcollection per turn**: rejected — a thread is small and always read whole; a subcollection buys pagination nobody needs at the cost of an extra query per history row.

## Consequences

- Pre-thread docs (if any) read `turns` as empty via the `?? []` guard; the freeze check keys on the first model turn. No production journal docs existed at migration time, so no backfill ran.
- `removeGrounding` refuses once any model turn exists — enforced in the store transaction, surfaced as 409, so the freeze holds even against callers that skip the route check.

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React + Vite (TypeScript) for the frontend, decided by the user 2026-09-06, replacing the previous vanilla no-build `app/public` setup. Build output is served by the existing Express `express.static` server with no API contract changes; the output itself is gitignored build output (the client builds first, in CI and in Docker). Firebase web config arrives via `VITE_` build env (`app/client/.env` locally, repo Variables in CI/CD, Dockerfile ARG) — never source. Backend stays TypeScript + Express on Cloud Run, Firestore (`grounded-journal` DB) for persistence, Firebase Auth (Google sign-in) for identity.

## Users

Solo journaler writing private entries to think clearly, grounding entries in real places and receiving Gemini reflections that could only have been written HERE. Challenge judges observe the demo but are not the user.

## Product Purpose

A personal journaling web app (Cloud Run AI Challenge entry, baseline: Personal Gemini Journal) extended with Places + Maps knowledge grounding. The user writes an Entry, attaches a real Place via search, and Gemini reflects with place-aware insight. Everything lives in the user's private Vault. Success is the acceptance demo: the same entry text reflected in two different places yields visibly different, cited reflections, plus narrated Vault privacy and quota discipline.

## Positioning

Reflections shaped by actual Places knowledge (structured Place JSON injected via `systemInstruction`, not generic platitudes), per-user Vault isolation (shared public places link nothing between Vaults), and quota discipline (per-Vault place cache, on-demand reflection only, cache-only display reads, frozen grounding audit trail).

## Operating Context

Web app deployed on Cloud Run (`personal-gemini-journal`, us-central1). Workflow: sign in with Google → write Entry (may stay ungrounded) → attach Place(s) via autocomplete search picker any time before the first Reflection → request Reflection on demand → follow-up Turns in the same Session. Grounding freezes at the first Reflection. History is a chronological list (map-pin view arrives with the browser key). Reproducible cloud operations are logged in `cmd.md`.

## Capabilities and Constraints

- One Vault per user (Firebase UID); server derives the Vault from the ID token and re-verifies ownership on every write.
- One Entry is immutable once saved; a Session is exactly one Entry plus its follow-up Turns and Reflections; each Reflection is bound to exactly one Entry; an Entry may carry several Groundings (one per Place), frozen at the first Reflection with attributions.
- Domain vocabulary follows `CONTEXT.md` (Entry, Reflection, Grounding, Place, Session, Turn, Vault); ADRs in `docs/adr/` (per-Vault cache, TTL, frozen snapshots) stand.
- Server API contracts are frozen (entries, groundings, reflections, cache-only place details, autocomplete); the browser never holds Maps or Gemini keys.
- Display reads are cache-only (zero quota surprise); place photos/reviews load only behind explicit expand; reflection is on demand, never automatic on save.
- Live map pins stay stubbed (disabled toggle + note) until the human console step lands: a referrer-restricted browser key.
- Frontend rebuild constraint: Vite build output must be servable by `express.static` with no server code changes; `app.js` ES-module constraint is retired with the vanilla setup.
- Human-blocked items unchanged: Gemini billing top-up (Reflect returns 429 until funds post), `firestore.rules` release via `firebase login`, browser key for map pins.

## Brand Commitments

Name `Grounded Journal` stays. Voice: private-vault assurance ("your entries live in your private vault"), honest states (explicit ungrounded message, freeze refusal explanation, quota-free history note). No invented claims. No binding visual identity beyond the name; the redesign replaces the incumbent look.

## Evidence on Hand

- Feature spec: `Spec: Knowledge-grounded journal — Places-grounded entries, Vault isolation, HERE-only reflections` (GitHub issue, `ready-for-agent`); data+ship spec: `Spec: Data + ship slice — Vault rules, expiry, README, deploy`.
- UX decisions: `Grilling: Knowledge-grounded UX and scoring originality (picker, entry flow, map history)`; glossary `CONTEXT.md`; ADRs `docs/adr/0001-0002`; repro log `cmd.md`; custom instructions `docs/ai-studio-custom-instructions.md`.
- Live service: `https://personal-gemini-journal-56gpfvk5zq-uc.a.run.app` (CI + CD green).
- Absences future work must not fabricate: no testimonials, no map-pin UI beyond the stub, no second grounding source, no quota-automation claims.

## Product Principles

1. The Vault boundary is the privacy boundary; shared places never link Vaults.
2. Grounding is an audit trail: frozen at first Reflection, always attributed, always inspectable.
3. Quota is spent only on explicit user asks; revisiting the past is always free.
4. Ungrounded entries are first-class; the model never hallucinates a whereabouts.
5. History is an honest record: immutable entries, chronological, nothing faked onto a pin.

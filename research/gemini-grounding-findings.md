# Research: Gemini Grounding + Custom Instructions Expansion — Findings Fact Sheet

> **Ticket:** #3 (part of #1 wayfinder map) — wayfinder:research  
> **Branch:** esearch/gemini-grounding (throwaway, linkable for UX & ADR)  
> **Date:** 2026-09-04 | **Repo:** PSergio984/genai-cohort3
> **Method:** Read official docs beyond this repo only — no code deliverable.

---

## TL;DR Recommendation

| Decision | Recommendation | Why |
|---|---|---|
| **Grounding strategy** | Prompt-augment with Place JSON, not Google Search grounding tool | Search grounding bills per query and is for web search; place grounding is structured context injection via system prompt + user message |
| **Custom Instructions vs System Instructions** | Expand Google AI Studio Custom Instructions (maps to Gemini systemInstruction) | Codelab Production Directives #1-7 are Custom Instructions that become systemInstruction in Vertex/Gemini API — add Maps section as delta |
| **Prompt shape** | System: role + place schema contract; User: grounding block + entry text; Model: reflection | Keeps hallucination low, attribution clear, easy to test |

---

## 1. How Gemini Consumes Place Context

### 1.1 System instruction (from gemini-api/docs/system-instructions)
- System instructions steer behavior without per-turn repetition. Gemini 2.5/3 respects systemInstruction for persona, rules, output format.
- Codelab Custom Instructions map 1:1 to systemInstruction: Agentic Threat Modeling, secure coding, Firestore isolation, secret mgmt.

### 1.2 Place context injection (not Search grounding)
- Grounding with Google Search (ai.google.dev/gemini-api/docs/grounding) is a *tool* that bills per search query — for open-web QA. Not needed for place-aware journal; we have structured Place API response.
- Instead, inject Place JSON as grounded context block in prompt. Example:
\\\json
{
  "place_id": "ChIJ...",
  "displayName": "Rizal Park",
  "formattedAddress": "Manila, Philippines",
  "location": {"latitude": 14.58, "longitude": 120.97},
  "types": ["park", "tourist_attraction"],
  "rating": 4.6,
  "regularOpeningHours": {"weekdayDescriptions": [...]},
  "editorialSummary": "Historic urban park...",
  "reviews": [{"rating":5,"text":"Peaceful..."}],
  "attribution": "Powered by Google"
}
\\\
- Keep attribution passthrough per Maps terms (display attributions).

### 1.3 Prompt template

**System:**
> You are a grounded reflection partner. Use ONLY the provided Place context for factual claims about the place. If context missing, say unknown, don't hallucinate. Cite place fields when used. Keep tone supportive. Respect Vault isolation — never reveal other users' entries.

**User (example):**
> [GROUNDING]
> Place: Rizal Park (see JSON)
> Entry: "I walked here today feeling stuck..."
> [TASK] Reflect with place-aware insight, suggest 2 grounding exercises tied to park.

**Guardrails:** temperature 0.7-0.9, maxOutputTokens 1024, safety thresholds default.

---

## 2. Custom Instructions Expansion Draft

Add as delta to codelab Production Directives (paste into AI Studio Custom Instructions):

\\\markdown
## 6. Maps & Places Grounding
- **Objective:** Teach AI to securely handle Places API place context and keep Gemini grounded.
- **Scope Lens:**
  - **FieldMask whitelist:** Only request displayName, formattedAddress, location, types, rating, hours, photos, editorialSummary, reviews; never request \*
  - **Secret handling:** Server IP-restricted API key in Secret Manager as Cloud Run volume mount (see #1 5/6)
  - **Attribution:** Passthrough \ttributions\ from Place Details to UI verbatim
  - **Grounding contract:** System prompt block lists allowed place fields; model must not invent absent fields
  - **Cache discipline:** Respect 30-day hard delete, place_id exempt
- **Mandatory Execution Criteria:** Generated code must (1) mount Maps key as volume, (2) filter FieldMask to allowed list, (3) render attribution, (4) inject grounding block as shown, (5) include per-Vault isolation check.
- **Reviewer checklist:** Is API key client-exposed? Is \* used? Is attribution missing? Is hallucination guard in system prompt?
\\\

Source pattern matches codelab Custom Instructions sections 1-7 at codelabs.developers.google.com/.../cloud-run-ai-challenge#1

---

## 3. Eval Checklist for Authenticity/Usability

- **Authenticity:** Is reflection place-specific (not generic)? Test with 5 place/entry pairs, check for place field citation.
- **Usability:** Place picker latency <1s (server cache hit), attribution visible, mobile map readable.
- **Stability/Security:** System prompt hallucination rate, Secret volume mount works, Vault rule denies cross-user read.

---

## 4. Sources (14 primary)

- ai.google.dev/gemini-api/docs/system-instructions
- ai.google.dev/gemini-api/docs/grounding
- ai.google.dev/gemini-api/docs/get-started (Custom Instructions pattern)
- codelabs.developers.google.com/.../cloud-run-ai-challenge (Production Directives #1-7)
- Same Maps docs as ticket #2 for attribution/caching contract

---

## 5. Linkability for ADR/UX/cmd.md

- ADR-000x: reference section 1.3 prompt template and 2 delta
- UX ticket #7: use prompt shape for picker→ground→reflect flow
- Prototype #9: stub this prompt without live Places call (mock JSON)

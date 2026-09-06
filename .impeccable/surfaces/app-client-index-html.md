---
version: 1
slug: "app-client-index-html"
primary_target: "app/client/index.html"
related_targets: []
---

# Surface brief: journal workspace (/)

Mode: Operate. Single-route app UI: the signed-in journal workspace plus the signed-out gate.

Audience and job: solo journaler writing private entries to think clearly; judges observe the demo. Tasks: write Entry, ground it in Place(s) via autocomplete, request Reflection on demand, send follow-ups, revisit filterable history and map. Proof: same-entry-text × two places yields visibly different cited reflections; Vault privacy narrated; quota discipline visible (cache-only history note, explicit Details expand).

Constraints: React + Vite build served by express.static; frozen server API contracts; browser holds no keys (Firebase web config + Maps browser key arrive via server-rendered runtime routes); display reads cache-only; CONTEXT.md vocabulary (Session, Grounding, Vault); no marketing hero, no gamification, no decoration over the task.

Direction: e-ink instrument world (seed c0efca0d, assigned 7 of 7). Neutral paper, ink prose, hairline-ruled segments, one ink-blue accent held by law for grounded/reflection states; system sans controls, reading serif entries; tabular metadata. Memorable moment: the entry field carries the largest type on the page (type-as-matter); the freeze rule reads as a sealed ledger.

Unresolved: live pin proof with real keys (needs deployed env + sign-in; map renders from Vault cache, key restricted to referrers); signed-in states verified by code parity with the tested vanilla UI, not screenshots (Firebase key forbids localhost sign-in).

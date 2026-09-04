# cmd.md — Reproducible gcloud Command Log

> Append-only log: every `gcloud` invocation for this repo is appended here copy-paste runnable, with timestamp and project. Standing preference per wayfinder map #1 Notes. `gcloud` skill rules apply: Step 1 `gcloud help <leaf>` first (exclusive authority), Step 2 param verify incl `--dry-run`/`--validate-only` support, single commands with `--quiet --project --region`, `--limit`/`--filter`/`--format` on lists, no IAM/delete/billing/org/kms without explicit human approval.

## How to use

- Run a gcloud command, then append the exact line + output snippet here.
- Group by phase (see research/cloudrun-gcloud-findings.md section 2).
- Never redact `$PROJECT_ID` — set `export PROJECT_ID=...` at top. Active project for this effort: `valid-meridian-475214-e3` (account `eric.manabatseam@gmail.com`, verified 2026-09-04 via `config list --format=json --quiet` + `projects describe`).

```powershell
$env:PROJECT_ID = "valid-meridian-475214-e3"
$env:RUN_SA = "273533786531-compute@developer.gserviceaccount.com"
# gcloud binary: C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd (SDK 583.0.0). Already on Machine PATH; if a shell misses it, refresh: $env:Path = [Machine] + ";" + [User], then `gcloud --version`.
# RUN_SA = default compute SA (verified 2026-09-04 via `iam service-accounts list`; also used by bq-data-agent). Alternatives in-project: barista-agent-sa (coffee-barista), coffee-shop-agent-sa (coffee-mgr-agent). Dedicated SA for the journal can be decided in the ADR; default keeps codelab parity.
```

## Where to get the API keys (console links, HITL)

- **Gemini API key** → https://aistudio.google.com/apikey (Google AI Studio → Get API Key → Create; paste value as `GEMINI_API_KEY`, never commit it)
- **Maps API key** → https://console.cloud.google.com/apis/credentials?project=valid-meridian-475214-e3 (Create Credentials → API key; restrict it: IP addresses of the Cloud Run service for server use + referrers only if a browser key is added later)
- **Verify secrets afterwards** → https://console.cloud.google.com/security/secret-manager?project=valid-meridian-475214-e3

---

## 0. Environment

```bash
# 2026-09-04 SDK resolved: C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd, SDK 583.0.0 (was "not on PATH" — it was on Machine PATH, shell just needed refresh; `gcloud --version` now succeeds). See issue #5, #10.
gcloud --version --quiet
gcloud config list --format=json --quiet
gcloud projects describe valid-meridian-475214-e3 --format=json --quiet
```

Result 2026-09-04: SDK 583.0.0; config project `valid-meridian-475214-e3`, account `eric.manabatseam@gmail.com`; project ACTIVE (`My First Project`, number 273533786531). Validated leaf help: `help run deploy`, `help secrets create`, `help firestore databases create`, `help run services describe` (exclusive authority per skill). `run deploy` has NO `--dry-run`/`--validate-only` (only `--async`) — proposal goes straight to Step 4 with `--quiet`.

---

## 1. Setup — Enable APIs

```bash
# secretmanager enable APPROVED by human 2026-09-04 (see task ticket) — RAN, but BLOCKED on billing (see Result):
gcloud services enable secretmanager.googleapis.com --project=$PROJECT_ID --quiet
# Safe read-only check (data-reduced, one service per call):
gcloud services list --enabled --filter="config.name:run.googleapis.com" --format="value(config.name)" --project=$PROJECT_ID --quiet
```

Result 2026-09-04: `run` ENABLED, `firestore` ENABLED, `cloudbuild` ENABLED; `secretmanager` ENABLED 2026-09-04 after billing attach (first attempt failed UREQ_PROJECT_BILLING_NOT_OPEN; user attached billing, re-run `operations/acat.p2-273533786531-*` finished successfully, verified via filtered list). All four deploy-plan APIs now on.

---

## 2. Firestore

```bash
# Validated: --location REQUIRED, --type default firestore-native, --database default "(default)" (per help firestore databases create). Dedicated DB per decision 2026-09-04 (not (default)).
gcloud firestore databases list --format="value(name)" --project=$PROJECT_ID --quiet
gcloud firestore databases create --database=grounded-journal --location=us-central1 --type=firestore-native --project=$PROJECT_ID --quiet
# deploy rules: needs authed Firebase (browser login — `npx firebase-tools login`; plain CLI hangs headless, verified 2026-09-04). Then pick the grounded-journal DB at the prompt. Rules API alternative NOT used: named-DB release IDs unverifiable, guessing risks false security.
npx -y firebase-tools@latest deploy --only firestore:rules --project=$PROJECT_ID
# TTL (validated: help firestore fields ttls update; one TTL field per collection group):
gcloud firestore fields ttls update expiresAt --collection-group=placeCache --database=grounded-journal --enable-ttl --project=$PROJECT_ID --quiet
gcloud firestore fields ttls list --database=grounded-journal --project=$PROJECT_ID --quiet
# history index (validated: help firestore indexes composite create; PowerShell: QUOTE flag values or commas split args):
gcloud firestore indexes composite create --collection-group=entries --database=grounded-journal "--field-config=field-path=ownerUid,order=ascending" "--field-config=field-path=createdAt,order=descending" --project=$PROJECT_ID --quiet --async
gcloud firestore indexes composite list --database=grounded-journal --project=$PROJECT_ID --quiet
```

Result 2026-09-04: `firestore.rules` written (ADR-0001, compiler-clean via Rules API, auth matrix 3/3 green, emulator suite 15/15 green — see tests/firestore) but NOT yet released (see HITL note above; empty DB = zero exposure meanwhile). TTL `placeCache.expiresAt` ACTIVE. History index (entries: ownerUid ASC + createdAt DESC, COLLECTION scope) READY.

Result 2026-09-04: dedicated `projects/valid-meridian-475214-e3/databases/grounded-journal` CREATED (us-central1, FIRESTORE_NATIVE, STANDARD, realtime updates on, PITR off, delete protection off). Pre-existing `coffee-menu` (asia-east1) left untouched. Note: named DB reports `freeTier: false` — tiny dev volumes cost ~nothing, but keep the budget alerts from the ADR. Rules deploy must target `grounded-journal`; schema/collections per Firestore research + ADR.

---

## 3. Secrets

```bash
# Validated: --data-file=- reads stdin (per help secrets create). API now ENABLED; store empty (verified 2026-09-04: `secrets list` returns no rows). Creation gated on key material from human — do NOT invent values.
gcloud secrets list --format="table(name)" --limit=10 --project=$PROJECT_ID --quiet
gcloud secrets create gemini-api-key --data-file=- --project=$PROJECT_ID --quiet
gcloud secrets create maps-api-key --data-file=- --project=$PROJECT_ID --quiet

Result 2026-09-04: BOTH CREATED from local `.env` via stdin (values never logged) — `gemini-api-key` version [1], `maps-api-key` version [1]. Key values live only in `.env` (git-ignored) + Secret Manager.
# APPROVED + EXECUTED 2026-09-04 (human "proceed"; secrets existed first): both bindings applied, verified via get-iam-policy.
gcloud secrets add-iam-policy-binding gemini-api-key --member=serviceAccount:273533786531-compute@developer.gserviceaccount.com --role=roles/secretmanager.secretAccessor --project=$PROJECT_ID --quiet
gcloud secrets add-iam-policy-binding maps-api-key --member=serviceAccount:273533786531-compute@developer.gserviceaccount.com --role=roles/secretmanager.secretAccessor --project=$PROJECT_ID --quiet
```

---

## 4. Build & Deploy

```bash
# Validated: --source builds via Dockerfile/buildpacks, --update-secrets /path=SECRET:version mounts volume (always latest) vs --set-secrets env (startup-pinned), --labels alias of --update-labels (per help run deploy). No --dry-run supported.
gcloud run deploy personal-gemini-journal --source . --region us-central1 --allow-unauthenticated --update-secrets=/secrets/maps-api-key=maps-api-key:latest --set-secrets=GEMINI_API_KEY=gemini-api-key:latest --service-account=$RUN_SA --labels=challenge=codelab,app=grounded-journal --project=$PROJECT_ID --quiet
gcloud run services describe personal-gemini-journal --region us-central1 --project=$PROJECT_ID --quiet
```

Result 2026-09-04 (read-only check, data-reduced): existing services `bq-data-agent`, `coffee-barista`, `coffee-mgr-agent` — `personal-gemini-journal` not yet deployed (deploy itself is out of this planning map's scope; needs secretmanager enabled + secrets created first).

---

## 5. Verify

```bash
gcloud run services list --format="table(metadata.name,status.url)" --limit=5 --project=$PROJECT_ID --quiet
gcloud logging read "resource.type=cloud_run_revision" --limit 20 --project=$PROJECT_ID --quiet
```

---

## Log — append below (timestamp, command, exit code, snippet)

- `2026-09-04T15:00Z` — `gcloud --version` — not found (issue #5) — PATH fix pending in #10
- `2026-09-04T15:30Z` — scaffold created from research branches #2, #3, #4, #5 — see https://github.com/PSergio984/genai-cohort3/issues/1
- `2026-09-04T16:00Z` — task resolution: SDK found at `C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd` (583.0.0, on Machine PATH; shell refresh fixes `where.exe` miss). Validated `help run deploy | secrets create | firestore databases create | run services describe`. `config list` → project `valid-meridian-475214-e3` / `eric.manabatseam@gmail.com`; `projects describe` → ACTIVE. Enabled: run, firestore, cloudbuild; DISABLED: secretmanager (needs approval). DB `coffee-menu` exists; services `bq-data-agent, coffee-barista, coffee-mgr-agent`. No writes executed (enable/IAM/create/deploy all gated). Sections 0-5 corrected to validated syntax.
- `2026-09-04T16:20Z` — secretmanager enable APPROVED then attempted: `gcloud services enable secretmanager.googleapis.com --project=valid-meridian-475214-e3 --quiet` → FAILED_PRECONDITION UREQ_PROJECT_BILLING_NOT_OPEN (no open billing account on 273533786531). API still disabled; secrets create + IAM bindings stay gated behind (1) billing attach (console HITL), (2) enable re-run. See Task: Enable Secret Manager API + stage Maps/Gemini secrets.
- `2026-09-04T16:35Z` — billing attached by human; re-ran enable → operation `acat.p2-273533786531-*` finished successfully; verified `secretmanager.googleapis.com` ENABLED via filtered list. `secrets list` → empty (no rows). Secrets create still gated on key values (GEMINI_API_KEY, MAPS_API_KEY) + IAM bindings gated on approval + RUN_SA. See Task: Enable Secret Manager API + stage Maps/Gemini secrets.
- `2026-09-04T16:50Z` — RUN_SA resolved AFK: `273533786531-compute@developer.gserviceaccount.com` (default compute SA; `iam service-accounts list` also shows barista-agent-sa, coffee-shop-agent-sa, ais-gemini-key Flyrank-image; `run services list` confirms bq-data-agent uses default, coffee services use dedicated SAs). IAM bindings prepared with concrete SA in section 3 but NOT run (need secrets to exist + explicit approval). Key console links + Custom Instructions doc (`docs/ai-studio-custom-instructions.md`, codelab §§1–7 + repo §8 Maps delta) added. See Task: Enable Secret Manager API + stage Maps/Gemini secrets.
- `2026-09-04T17:00Z` — secrets STAGED with human proceed: both created from `.env` via stdin (script-fed, no shell pipes, values never logged) — version [1] each. IAM bindings for default compute SA applied + verified (`get-iam-policy` shows SA + secretAccessor on both). Secrets infra COMPLETE; next is deploy (out of planning map scope until requested).
- `2026-09-04T17:10Z` — dedicated Firestore `grounded-journal` CREATED (us-central1, native, STANDARD) per human request; `coffee-menu` (asia-east1) untouched. Named DB = `freeTier: false`, keep budget alerts. Rules + schema pending ADR.
- `2026-09-04T18:00Z` — data slice implemented (spec #13): `firestore.rules` written (ADR-0001; compiler-clean, Rules API auth matrix 3/3 green); emulator suite `tests/firestore` 15/15 green (ownership + retention incl. ceiling/past/missing-expiry/update-extension/stranger edges); TTL `placeCache.expiresAt` ACTIVE; history index (ownerUid ASC + createdAt DESC, COLLECTION scope) READY; `firebase.json` added (rules + emulator port 8090); parity script `tests/parity.mjs` green. Rules NOT released: firebase CLI needs browser login (HITL) and Rules API named-DB release IDs are unverifiable — release is one authed `deploy --only firestore:rules` (pick grounded-journal) away; empty DB = zero exposure meanwhile.
- `2026-09-04T19:00Z` — persistence slice + CI/CD: `app/src/store/` (repository contracts + Firestore impl, backend-computed expiry, read-through cache with strict stale boundary) with 12 emulator tests (ordering, owner filter, limit, reflection write, missing/fresh/stale/boundary fetch, error propagation); CI (app, rules, parity jobs) + CD (build, `--source .` deploy + `--max-instances=4`) adapted from the Go example to this stack (no goose/migrations — Firestore needs none); `GCP_CREDENTIALS` secret documented. Full suite green (app 31, rules 19, parity 0 drift).
- `2026-09-04T19:30Z` — CI red, fixed: rules job `npm ci` failed on firebase@11 vs rules-unit-testing peer @10 (local `--legacy-peer-deps` doesn't transfer) → pinned test-only `firebase@^10`, lockfile regenerated, stock `npm ci` verified; one v10 SDK quirk found (denied-read→write same context trips settings-lock) → split into single-assert tests, suite 20/20. CD skips green until `GCP_CREDENTIALS` exists (`if:` guard — that secret is the one human step).


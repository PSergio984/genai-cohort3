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
# Validated: --location REQUIRED, --type default firestore-native, --database default "(default)" (per help firestore databases create). Only create if no DB exists.
gcloud firestore databases list --format="value(name)" --project=$PROJECT_ID --quiet
gcloud firestore databases create --location=us-central1 --type=firestore-native --project=$PROJECT_ID --quiet
# deploy rules (firebase-basics skill: npx firebase-tools)
npx -y firebase-tools@latest deploy --only firestore:rules --project=$PROJECT_ID
```

Result 2026-09-04: database `projects/valid-meridian-475214-e3/databases/coffee-menu` already exists — do NOT create `(default)` without a decision (would diverge from existing DB; ADR input).

---

## 3. Secrets

```bash
# Validated: --data-file=- reads stdin (per help secrets create). API now ENABLED; store empty (verified 2026-09-04: `secrets list` returns no rows). Creation gated on key material from human — do NOT invent values.
gcloud secrets list --format="table(name)" --limit=10 --project=$PROJECT_ID --quiet
gcloud secrets create gemini-api-key --data-file=- --project=$PROJECT_ID --quiet
gcloud secrets create maps-api-key --data-file=- --project=$PROJECT_ID --quiet
# DENYLIST — IAM binding modification, requires explicit human approval AND existing secrets (binding to a missing secret fails). NOT yet run:
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


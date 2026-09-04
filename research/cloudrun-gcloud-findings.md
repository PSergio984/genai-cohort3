# Research: Cloud Run Deploy + gcloud cmd.md Inventory and SDK PATH Fix — Findings Fact Sheet

> **Ticket:** #5 (part of #1 wayfinder map) — `wayfinder:research`  
> **Branch:** `research/cloudrun-gcloud` (throwaway)  
> **Date:** 2026-09-04 | **Repo:** PSergio984/genai-cohort3

---

## TL;DR Recommendation

| Decision | Recommendation |
|---|---|
| **Deploy method** | `gcloud run deploy` with `--source .` (Cloud Build builds Dockerfile) |
| **Secret handling** | Secret Manager volume mount (not env var) for MAPS_API_KEY + GEMINI_API_KEY |
| **Firestore init** | `gcloud firestore databases create --type=firestore-native --location=us-central1` |
| **gcloud inventory** | 5 phases: setup, auth, firestore, secrets, deploy, verify — copy-paste runnable for cmd.md |
| **SDK PATH fix** | SDK not found on PATH (checked C: Program Files, AppData, D:); reinstall via winget/installer or set PATH to `google-cloud-sdk/bin` |

---

## 1. Cloud Run Deploy Path (from cloud.google.com/run/docs/deploying)

**Prereqs enabling APIs:**
```bash
gcloud services enable run.googleapis.com firestore.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com --project=$PROJECT_ID
```

**Firestore (once):**
```bash
gcloud firestore databases create --location=us-central1 --type=firestore-native --project=$PROJECT_ID
# or firebase init
```

**Secret Manager:**
```bash
echo -n "$GEMINI_API_KEY" | gcloud secrets create gemini-api-key --data-file=- --project=$PROJECT_ID
echo -n "$MAPS_API_KEY" | gcloud secrets create maps-api-key --data-file=- --project=$PROJECT_ID

gcloud secrets add-iam-policy-binding gemini-api-key --member=serviceAccount:$RUN_SA --role=roles/secretmanager.secretAccessor --project=$PROJECT_ID
gcloud secrets add-iam-policy-binding maps-api-key --member=serviceAccount:$RUN_SA --role=roles/secretmanager.secretAccessor --project=$PROJECT_ID
```

**Cloud Run deploy (from cloud.google.com/sdk/gcloud/reference/run/deploy):**
```bash
gcloud run deploy personal-gemini-journal \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars=NODE_ENV=production \
  --set-secrets=GEMINI_API_KEY=gemini-api-key:latest,MAPS_API_KEY=maps-api-key:latest \
  --update-secrets=/secrets/maps-api-key=maps-api-key:latest \
  --service-account=$RUN_SA \
  --labels=challenge=codelab,app=grounded-journal \
  --project=$PROJECT_ID
```

Note: `--set-secrets` as env var is startup-pinned; `--update-secrets` as volume mount always fetches latest (cloud.google.com/run/docs/configuring/secrets). Use volume for Maps key rotation.

**Verify:**
```bash
gcloud run services describe personal-gemini-journal --region us-central1 --project=$PROJECT_ID
gcloud run services list --project=$PROJECT_ID
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" https://personal-gemini-journal-*.run.app
```

---

## 2. Full gcloud cmd.md Inventory for Reproducibility

Group by phase — each block copy-paste runnable. This is the source for cmd.md.

### Phase 0: SDK install & auth
```bash
# install (if missing)
winget install -e --id Google.CloudSDK
# or https://cloud.google.com/sdk/docs/install

gcloud --version
gcloud auth login
gcloud auth application-default login
gcloud config set project $PROJECT_ID
gcloud config set run/region us-central1
gcloud projects describe $PROJECT_ID
```

### Phase 1: Enable APIs
```bash
gcloud services enable run.googleapis.com firestore.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com --project=$PROJECT_ID
gcloud services list --enabled --project=$PROJECT_ID
```

### Phase 2: Firestore
```bash
gcloud firestore databases describe --project=$PROJECT_ID || gcloud firestore databases create --location=us-central1 --type=firestore-native --project=$PROJECT_ID
firebase deploy --only firestore:rules --project=$PROJECT_ID  # vaults/{vaultId} rules
```

### Phase 3: Secrets
```bash
# create and bind (see section 1)
gcloud secrets describe gemini-api-key --project=$PROJECT_ID || echo -n "$GEMINI_API_KEY" | gcloud secrets create gemini-api-key --data-file=- --project=$PROJECT_ID
gcloud secrets versions access latest --secret=gemini-api-key --project=$PROJECT_ID | head -c 20
```

### Phase 4: Build & Deploy
```bash
gcloud builds submit --tag gcr.io/$PROJECT_ID/personal-gemini-journal --project=$PROJECT_ID  # optional if not --source .
gcloud run deploy personal-gemini-journal --source . --region us-central1 --allow-unauthenticated --set-secrets=GEMINI_API_KEY=gemini-api-key:latest --project=$PROJECT_ID
```

### Phase 5: Verify & labels
```bash
gcloud run services describe personal-gemini-journal --region us-central1 --format="value(status.url)" --project=$PROJECT_ID
gcloud logging read "resource.type=cloud_run_revision" --limit 20 --project=$PROJECT_ID
```

---

## 3. SDK PATH Fix (ticket reports C: drive other SSD, not on PATH)

**Findings 2026-09-04:**
- `where.exe gcloud` not found, checked `C:\Program Files\Google\Cloud SDK\...`, `C:\Users\admin\AppData\Local\Google\Cloud SDK\...`, `C:\gcloud\...`, `D:\` shallow search — no binary.
- Host `gcloud` command absent in PowerShell session (win32).

**Remediation:**
1. Check other SSD mount letters: `Get-PSDrive -PSProvider FileSystem` — reporter said C: drive but may be `D:` or `E:` with folder `google-cloud-sdk\bin\gcloud.cmd`
2. Search: `Get-ChildItem -Path C:\,D:\,E:\ -Filter gcloud.cmd -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select FullName`
3. If found, add to PATH: `[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\path\to\google-cloud-sdk\bin", "User")` + restart shell
4. If not found, reinstall: `winget install Google.CloudSDK` or download from https://cloud.google.com/sdk/docs/install — installer updates PATH automatically
5. Verify: `gcloud --version` succeeds before ticket #10 closes cmd.md scaffold

Task ticket #10 depends on this research to know which commands to log.

---

## 4. Linkability

- ADR #8: references volume mount vs env var decision
- cmd.md: paste Phase 0-5 blocks verbatim into `cmd.md`, keep append-only log
- Notes standing preference: every future gcloud invocation appends to `cmd.md` with timestamp and output

Sources: cloud.google.com/run/docs/deploying, cloud.google.com/run/docs/configuring/secrets, cloud.google.com/sdk/gcloud/reference/run/deploy, cloud.google.com/sdk/docs/install

# cmd.md — Reproducible gcloud Command Log

> Append-only log: every `gcloud` invocation for this repo is appended here copy-paste runnable, with timestamp and project. Standing preference per wayfinder map #1 Notes.

## How to use

- Run a gcloud command, then append the exact line + output snippet here.
- Group by phase (see research/cloudrun-gcloud-findings.md section 2).
- Never redact `$PROJECT_ID` — set `export PROJECT_ID=...` at top.

---

## 0. Environment

```bash
# 2026-09-04 SDK check (not yet on PATH — see issue #5, #10)
gcloud --version
gcloud config list
gcloud auth list
gcloud projects list --limit 5
```

Result: gcloud not found on PATH (checked C: Program Files, AppData, D: — no binary). Remediation in issue #10: search other SSD or `winget install Google.CloudSDK`, then verify `gcloud --version`.

---

## 1. Setup — Enable APIs

```bash
gcloud services enable run.googleapis.com firestore.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com --project=$PROJECT_ID
gcloud services list --enabled --project=$PROJECT_ID
```

---

## 2. Firestore

```bash
gcloud firestore databases create --location=us-central1 --type=firestore-native --project=$PROJECT_ID
# deploy rules
firebase deploy --only firestore:rules --project=$PROJECT_ID
```

---

## 3. Secrets

```bash
echo -n "$GEMINI_API_KEY" | gcloud secrets create gemini-api-key --data-file=- --project=$PROJECT_ID
echo -n "$MAPS_API_KEY" | gcloud secrets create maps-api-key --data-file=- --project=$PROJECT_ID
gcloud secrets add-iam-policy-binding gemini-api-key --member=serviceAccount:$RUN_SA --role=roles/secretmanager.secretAccessor --project=$PROJECT_ID
gcloud secrets add-iam-policy-binding maps-api-key --member=serviceAccount:$RUN_SA --role=roles/secretmanager.secretAccessor --project=$PROJECT_ID
```

---

## 4. Build & Deploy

```bash
gcloud run deploy personal-gemini-journal --source . --region us-central1 --allow-unauthenticated --set-secrets=GEMINI_API_KEY=gemini-api-key:latest,MAPS_API_KEY=maps-api-key:latest --labels=challenge=codelab,app=grounded-journal --project=$PROJECT_ID
gcloud run services describe personal-gemini-journal --region us-central1 --project=$PROJECT_ID
```

---

## 5. Verify

```bash
gcloud run services list --project=$PROJECT_ID
gcloud logging read "resource.type=cloud_run_revision" --limit 20 --project=$PROJECT_ID
curl -s https://<service-url>/ | head -20
```

---

## Log — append below (timestamp, command, exit code, snippet)

- `2026-09-04T15:00Z` — `gcloud --version` — not found (issue #5) — PATH fix pending in #10
- `2026-09-04T15:30Z` — scaffold created from research branches #2, #3, #4, #5 — see https://github.com/PSergio984/genai-cohort3/issues/1


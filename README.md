# genai-cohort3 — Knowledge-Grounded Journal (Cloud Run AI Challenge entry)

Personal Gemini Journal extended with **Places + Maps knowledge grounding**:
user-isolated journal entries grounded in place context, with Gemini reflections
enriched by local knowledge. Built for the
[Cloud Run AI Challenge](https://codelabs.developers.google.com/codelabs/cloud-run/cloud-run-ai-challenge)
— scored on Authenticity, Usability, Stability, Security. Baseline as-is won't
score; the original feature (place-grounded reflection) is the direction.

> Status: **building** — the [wayfinder map](https://github.com/PSergio984/genai-cohort3/issues/1)
> is complete (10/10) and two specs are `ready-for-agent` (feature + data/ship);
> data slice implemented, app next. No app code yet.

## Quickstart (once `.env` is filled)

```powershell
# 1. Clone + restore agent skills (installed skills are local-only, see skills-lock.json)
git clone https://github.com/PSergio984/genai-cohort3.git
npx skills add google/skills

# 2. Secrets — copy the template, paste real keys (NEVER commit .env)
Copy-Item .env.example .env
# Gemini key → https://aistudio.google.com/apikey
# Maps key   → https://console.cloud.google.com/apis/credentials?project=valid-meridian-475214-e3

# 3. gcloud (SDK 583.0.0; if a shell misses it: $env:Path = [Machine] + ";" + [User])
$env:PROJECT_ID = "valid-meridian-475214-e3"
gcloud --version
gcloud config list --format=json --quiet

# 4. Rules tests (local emulator, no cloud, no keys)
npx -y firebase-tools@latest emulators:exec --only firestore --project=demo-grounded-journal "npm test --prefix tests/firestore"
node tests/parity.mjs   # README↔cmd.md drift check

# 5. App (domain core + server) + client build (Vite output is gitignored)
npm install --prefix app
npm install --prefix app/client   # needs VITE_FIREBASE_* env: copy app/client/.env.example to app/client/.env
npm run build --prefix app/client # emits to app/public/ for express.static (also builds in-stage in Docker)
npm run typecheck --prefix app
npm test --prefix app        # unit tests (Journal reducer + server boundary)
```

## Frontend (React + Vite)

Build first (`npm run build --prefix app/client` — needs `VITE_FIREBASE_*`
env, see `app/client/.env.example`; output lands gitignored in `app/public/`
for `express.static`, and builds in-stage in Docker).

Open `/` on the running service: write an Entry, ground it in a Place via the
search picker (proxied through `POST /api/places/autocomplete` — the browser
never holds a Maps key; the session token closes server-side on grounding),
reflect on demand, and browse history. Identity is Firebase Auth (Google
sign-in, one Vault per user); the map toggle waits on a
browser key (deferred, no new secrets until then).

Every cloud command for this repo is logged copy-paste runnable in [`cmd.md`](./cmd.md)
— read it before running anything; it carries the validated syntax, the guardrails
(`--quiet --project --region`, no IAM/delete/billing without approval), and the log.

## Deploy (data slice)

1. **Prereqs:** gcloud SDK + Firebase CLI (`npx firebase-tools`), project
   `valid-meridian-475214-e3` with run/firestore/cloudbuild/secretmanager enabled.
2. **Secrets:** `.env` holds `GEMINI_API_KEY` + `MAPS_API_KEY` (never committed);
   Secret Manager versions `gemini-api-key` / `maps-api-key` v1 exist with
   `secretAccessor` for the runtime SA (verify: `cmd.md` §3).
3. **Rules:** `npx firebase-tools deploy --only firestore:rules` (needs browser
   login — the one HITL step), picking the `grounded-journal` database. TTL
   (`placeCache.expiresAt`) is ACTIVE; history index READY.
4. **Container:** `gcloud run deploy personal-gemini-journal --source . …`
   (full command in `cmd.md` §4 — volume-mounted Maps secret, pinned SA,
   challenge labels).
5. **Verify:** service URL via `run services describe`; smoke the endpoint;
   challenge labeling present. Full checklist in `cmd.md` §5.

## CI/CD

- **CI** (`.github/workflows/ci.yml`, every push + PR): app typecheck + full
  suite under the emulator, rules matrix, parity check.
- **CD** (`.github/workflows/cd.yml`, pushes to `main`): typecheck + build,
  then `run deploy --source .` (command mirrors `cmd.md` §4, plus
  `--max-instances=4` as the billing guardrail). One deploy at a time.
- **Required repo secret:** `GCP_CREDENTIALS` — service-account JSON with
  `run.admin` on the project + `serviceAccountUser` on the runtime SA. No app
  secrets in GitHub: keys mount from Secret Manager at deploy time.

## Docs index

| File | What it is |
| ---- | ---------- |
| [`cmd.md`](./cmd.md) | Reproducible gcloud log — the runbook. Append-only. |
| [`firestore.rules`](./firestore.rules) | Vault isolation + retention backstop (ADR-0001). Tested (19/19 emulator); release needs one authed deploy, see `cmd.md` §2. |
| [`firebase.json`](./firebase.json) | Rules path + local emulator config (port 8090). |
| [`tests/firestore/`](./tests/firestore) | Emulator rules suite (19/19, `npm test` via `emulators:exec`) + `tests/parity.mjs` drift check. |
| [`.github/workflows/`](./.github/workflows) | CI (typecheck, suites, parity) + CD (build, Cloud Run deploy). |
| [`docs/ai-studio-custom-instructions.md`](./docs/ai-studio-custom-instructions.md) | Production Directives for the AI Studio App (§§1–7 codelab + §8 Maps delta). Paste into AI Studio Custom Instructions. |
| [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md) | Where issues live (GitHub) + `gh` conventions. |
| [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md) | `needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`. |
| [`docs/agents/domain.md`](./docs/agents/domain.md) | Single-context layout (`CONTEXT.md` + `docs/adr/`). |
| [Wayfinder map](https://github.com/PSergio984/genai-cohort3/issues/1) | Destination, decisions so far, fog, out-of-scope. |

## Repo layout

```
/
├── .env / .env.example      # local secrets (git-ignored) + documented template
├── cmd.md                   # gcloud runbook (append-only)
├── docs/
│   ├── ai-studio-custom-instructions.md
│   └── agents/              # issue-tracker / triage-labels / domain
├── AGENTS.md                # agent-skills pointer block
├── app/                     # TS app: domain core + Firestore store + server
│   ├── public/              # Vite build output (gitignored): React frontend serving write, ground, reflect, history
│   ├── client/              # React+Vite frontend source (needs VITE_FIREBASE_* env, see .env.example)
│   └── src/routes/          # journal API + places autocomplete proxy
├── firestore.rules + firebase.json  # Vault rules (tested 19/19, pending one authed release) + emulator config
├── tests/firestore/         # emulator rules suite + README-to-cmd.md parity check
├── .github/workflows/       # CI (typecheck, suites, parity) + CD (build, deploy)
└── research/<name>/         # throwaway finding sheets (on research/* branches, not main)
```

Active GCP project: `valid-meridian-475214-e3` (run, firestore, cloudbuild,
secretmanager enabled; secrets `gemini-api-key` + `maps-api-key` v1;
dedicated Firestore DB `grounded-journal` in us-central1 — TTL ACTIVE, history
index READY, rules tested-not-yet-released; runtime SA
`273533786531-compute@developer.gserviceaccount.com`).
Full cloud state + history: [`cmd.md`](./cmd.md).

## Contributing / agent workflow

- Work is tracked as GitHub issues via `gh` (see `docs/agents/issue-tracker.md`).
- Planning runs through the wayfinder map — one decision ticket per session,
  research in parallel, decisions indexed on the map, never as bare `#numbers`.
- `graphify` post-commit hook auto-rebuilds the knowledge graph (code files,
  no LLM); run `/graphify --update` manually after doc waves.
- Secrets rule (§4 of the Custom Instructions): no hardcoded keys, Secret Manager
  or env injection only — `.env` stays local, `firestore.rules` stay owner-bound.

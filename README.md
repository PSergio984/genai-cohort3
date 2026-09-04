# genai-cohort3 — Knowledge-Grounded Journal (Cloud Run AI Challenge entry)

Personal Gemini Journal extended with **Places + Maps knowledge grounding**:
user-isolated journal entries grounded in place context, with Gemini reflections
enriched by local knowledge. Built for the
[Cloud Run AI Challenge](https://codelabs.developers.google.com/codelabs/cloud-run/cloud-run-ai-challenge)
— scored on Authenticity, Usability, Stability, Security. Baseline as-is won't
score; the original feature (place-grounded reflection) is the direction.

> Status: **planning** — the route is being charted on the
> [wayfinder map](https://github.com/PSergio984/genai-cohort3/issues/1).
> No app code yet; this README is the base everything builds on.

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
```

Every cloud command for this repo is logged copy-paste runnable in [`cmd.md`](./cmd.md)
— read it before running anything; it carries the validated syntax, the guardrails
(`--quiet --project --region`, no IAM/delete/billing without approval), and the log.

## Docs index

| File | What it is |
| ---- | ---------- |
| [`cmd.md`](./cmd.md) | Reproducible gcloud log — the runbook. Append-only. |
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
└── research/<name>/         # throwaway finding sheets (on research/* branches, not main)
```

Active GCP project: `valid-meridian-475214-e3` (run, firestore, cloudbuild,
secretmanager enabled; secrets `gemini-api-key` + `maps-api-key` v1;
dedicated Firestore DB `grounded-journal` in us-central1; runtime SA
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

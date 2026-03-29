# Enterprise DLC — branches, CI/CD, cloud execution

This project is designed so **nobody needs a working Python install on a laptop** to run the verified stack: **Docker**, **GitHub Actions**, and optional **GitHub Codespaces** / cloud VMs.

## Branch model (Git Flow–style)

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready; protected; only via PR from `develop` or release branches. |
| `develop` | Integration; default target for feature PRs. |
| `feature/*` | Short-lived work (e.g. `feature/bd-feeds`). Open PR → `develop`. |
| `release/*` | Optional version freeze before merging to `main`. |

**Enforcement:** Turn on branch protection in GitHub (required status checks: `CI / verify`, `CI / docker`).

## CI/CD pipeline (`.github/workflows/ci.yml`)

1. **Checkout** — immutable commit SHA.
2. **Verify** — `compileall`, `pytest`, generate `artifacts/pipeline_snapshot.json` **without** cotton CSV (stages show `skipped` for data-dependent steps).
3. **Artifact** — Upload `pipeline-snapshot` ZIP for auditors / dashboard seeding.
4. **Docker** — Build `Dockerfile` (dashboard image); cache via GitHub Actions cache.

**Optional next steps (you enable in GitHub):**

- Push image to GHCR on `main` (`docker push ghcr.io/<org>/cmi-dashboard:latest`).
- Deploy dashboard to Cloud Run / ECS / AKS from that image.
- Add secret `COTTON_DAILY_DATA` only in a **private** workflow if you want full snapshots in CI (usually keep data out of Git).

## Where the dashboard fits (visual “where we are”)

- **Streamlit app:** `dashboard/app.py`
- **Run in cloud:** `docker compose up` or deploy the same image to your host.
- **Stage truth:** `src/pipeline_snapshot.py` produces JSON aligned with DLC stages: config → data → benchmarks → signal → news → roadmap → narrative.

Each CI run refreshes the **snapshot artifact** so you can attach it to a release or load it into the dashboard via `CMI_PIPELINE_SNAPSHOT`.

## Cloud IDE (no local install)

- **GitHub Codespaces:** open repo → “Create codespace” → uses `.devcontainer/devcontainer.json`.
- **Docker only:** `docker compose up --build` from any machine with Docker Desktop / Engine.

## Operational checklist

- [ ] Branch protection on `main` + required CI checks  
- [ ] Secrets only in GitHub / vault (never in repo)  
- [ ] `HF_HOME` or model cache on persistent disk for ML images  
- [ ] Dashboard behind SSO / VPN for internal mills  

See also: `wiki/Bangladesh-Market.md`, `wiki/Strategic-Procurement.md`.

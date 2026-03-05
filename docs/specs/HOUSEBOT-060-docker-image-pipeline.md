# HOUSEBOT-060: Docker Images for Bot and Mini App

## Summary

Add production Docker images and CI/CD image flow so both services are deployable to Cloud Run from Artifact Registry.

## Goals

- Add reproducible Dockerfiles for `apps/bot` and `apps/miniapp`.
- Provide local Docker smoke execution for both services.
- Build images in CI and deploy Cloud Run from pushed images in CD.

## Non-goals

- Kubernetes manifests.
- Full production runbook and cutover checklist.
- Runtime feature changes in bot or mini app business logic.

## Scope

- In: Dockerfiles, nginx config for SPA serving, compose smoke setup, CI/CD workflow updates, developer scripts/docs.
- Out: Advanced image signing/SBOM/scanning.

## Interfaces and Contracts

- Bot container exposes `PORT` (default `8080`) and `/health`.
- Mini app container serves SPA on `8080` and provides `/health`.
- CD builds and pushes:
  - `<region>-docker.pkg.dev/<project>/<repo>/bot:<sha>`
  - `<region>-docker.pkg.dev/<project>/<repo>/miniapp:<sha>`

## Domain Rules

- None (infrastructure change).

## Data Model Changes

- None.

## Security and Privacy

- No secrets embedded in images.
- Runtime secrets remain injected via Cloud Run/Secret Manager.

## Observability

- Container health checks for bot and mini app.
- CD logs include image refs and deploy steps.

## Edge Cases and Failure Modes

- Missing Artifact Registry repository: image push fails.
- Missing Cloud Run service vars: deploy falls back to documented defaults.
- Missing DB secret: migrations are skipped but deploy continues.

## Test Plan

- Unit: N/A.
- Integration: CI docker build jobs for both images.
- E2E: local `docker compose up --build` smoke run with health endpoint checks.

## Acceptance Criteria

- [ ] Both services run locally via Docker.
- [ ] CI builds both images without manual patching.
- [ ] CD deploys Cloud Run from built Artifact Registry images.

## Rollout Plan

- Merge Docker + workflow changes.
- Configure optional GitHub vars (`GCP_REGION`, `ARTIFACT_REPOSITORY`, service names).
- Trigger `workflow_dispatch` CD once to validate image deploy path.

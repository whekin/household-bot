# Archived GitHub Actions Workflows

These workflows are preserved for historical cloud deployment targets, but they are intentionally
outside `.github/workflows` so GitHub does not run them.

Active deployment target: Coolify.

Active workflows:

- `.github/workflows/ci.yml`
- `.github/workflows/cd-coolify.yml`

Archived workflows:

- `cd-gcp.yml` — former Cloud Run / Artifact Registry deployment
- `cd-aws.yml` — former Pulumi AWS deployment

To restore one of these deployment paths, move the workflow back to `.github/workflows/`, review the
required GitHub secrets/vars and cloud credentials, then run it manually before re-enabling automatic
deploy triggers.

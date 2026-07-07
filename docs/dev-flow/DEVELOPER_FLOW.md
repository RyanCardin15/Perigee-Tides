# NOAA MCP Developer Flow

This repository uses GitHub for review and deterministic checks, and Codex for scheduled package scouting, implementation, live smoke verification, and owner-facing iMessage updates.

## Branching

- `main` is the release branch.
- Normal work starts from a feature branch.
- Merge through pull requests only.
- Prefer squash merge so each PR lands as one coherent change.

## Required Pull Request Checks

Every PR should pass:

- `npm run build`
- `npm test`
- `npm run test:live` when NOAA API behavior, tool behavior, transport, or formatting changes.

The GitHub Actions workflow in `.github/workflows/ci.yml` runs build/test and validates package metadata.

## Owner Approval Gate

Codex-generated plans live as GitHub issues with the `codex-plan` label.

Codex builder automations must not implement a plan until the owner applies `codex-approved`.

Recommended lifecycle:

1. Codex scout creates an issue labeled `codex-plan` and `needs-owner-approval`.
2. Owner reviews the issue.
3. Owner applies `codex-approved` to approve implementation.
4. Codex builder creates a feature branch and pull request.
5. Owner reviews and merges the pull request.

## Labels

- `codex-plan`: a plan produced by Codex.
- `needs-owner-approval`: waiting for owner review.
- `codex-approved`: owner approved Codex to implement.
- `codex-in-progress`: Codex has started implementation.
- `codex-implemented`: Codex opened a PR.
- `live-smoke`: live NOAA smoke testing is required.

## Releases

Publishing to npm is intentionally release-driven:

1. Prepare a version bump PR.
2. Ensure `package.json`, `package-lock.json`, and `server.json` agree.
3. Merge after CI passes.
4. Create a GitHub Release.
5. The npm publish workflow runs from the release event using `NPM_TOKEN`.

After NOAA changes land, sync `src/` into the Perigee web app in a separate Perigee PR.

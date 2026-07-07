# Codex Automations For NOAA MCP

Codex owns scheduled package exploration and implementation. GitHub owns durable review records and CI status. The owner approves work through GitHub issue labels.

GitHub repository: `RyanCardin15/Perigee-Tides`.

## Notification Channel

Codex sends owner-facing updates through the local Mac Messages app by running:

```bash
scripts/codex-imessage.sh "message text"
```

The default recipient is `832-212-1341`. Override with `CODEX_IMESSAGE_TO` if needed.

Use iMessage only for high-signal outcomes:

- A new high-value plan was created.
- An approved implementation PR is ready.
- A scheduled run is blocked and needs owner action.
- Live smoke testing finds an actionable regression.

Every iMessage must be useful without opening GitHub. Keep it concise, but
include the substance of the work, not just the link.

Scout message format:

- `Codex MCP scout: suggested <feature/fix title> (#issue).`
- `Area: <tool group/service/transport/docs/package surface>.`
- `Why: <user/dev/reliability impact in one sentence>.`
- `Proposed change: <specific implementation slice>.`
- `Evidence: <tool output/log/check result/live behavior>.`
- `Next: approve with codex-approved or leave for later.`

Builder message format:

- `Codex MCP builder: opened PR #<pr> for #<issue> - <title>.`
- `Changed: <specific tools/services/docs/package behavior>.`
- `Verification: <local checks and GitHub status>.`
- `Live smoke: <run result or not required>.`
- `Risk/notes: <known caveat or rollback note>.`
- `Next: review PR #<pr>.`

Blocked/failure message format:

- `Codex MCP blocked: <issue/PR/run context>.`
- `Reason: <exact blocker or failing check>.`
- `Impact: <what did not happen>.`
- `Next: <specific owner action needed>.`

## MCP Scout

Purpose: inspect the MCP package and create owner-reviewable GitHub issues.

Run behavior:

1. Confirm the working tree is clean. If not, avoid edits and continue read-only.
2. Review `README.md`, `CLAUDE.md`, recent commits, open issues, open PRs, `server.json`, and `smithery.yaml`.
3. Run cheap health checks when useful: `npm run build`, `npm test`.
4. Use `npm run test:live` when a plan depends on live NOAA behavior.
5. Look for concrete improvements in:
   - tool schemas and descriptions
   - NOAA edge-case handling
   - output formatting
   - resources and prompts
   - HTTP transport behavior
   - package metadata and registry docs
   - README accuracy
   - test coverage
6. Create at most three GitHub issues for the best plans.
7. Label plans with `codex-plan` and `needs-owner-approval`.
8. Do not implement code.
9. Send one iMessage only if a strong plan was created or the run is blocked,
   following the scout or blocked/failure message format above.

Issue quality bar:

- State the affected tool group, service, or package surface.
- Explain why the change matters.
- Propose the smallest coherent implementation.
- Include acceptance criteria.
- Include logs, tool examples, or test output when available.

## MCP Approved Builder

Purpose: implement one approved GitHub issue end-to-end.

Prerequisite: `.github/workflows/ci.yml` must already exist on the current
`main` checkout. If the bootstrap developer-flow PR has not been merged yet,
the builder must stop and send an iMessage explaining that approved
implementation is blocked until CI is present on `main`.

Run behavior:

1. Find the highest-value open issue labeled `codex-approved` and `codex-plan`.
2. If none exists, stop without messaging.
3. Confirm the issue is not already linked to an open PR.
4. Create a feature branch.
5. Implement the smallest coherent change satisfying the issue acceptance criteria.
6. Run required checks:
   - `npm run build`
   - `npm test`
   - `npm run test:live` when tool/API behavior changes
7. Open a pull request linked to the issue.
8. Remove `needs-owner-approval`, add `codex-implemented`.
9. Send an iMessage following the builder message format above.

Hard limits:

- Do not merge PRs.
- Do not publish npm packages.
- Do not create releases.
- Do not implement unapproved issues.
- Preserve unrelated local changes.

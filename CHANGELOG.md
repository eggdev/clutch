# Changelog

## 0.30.0 (2026-11-01)

### Features

- feat(env): add a dev container and the Cursor cloud setup (CL-203)
- feat(agents): add the repo MCP config for agents (CL-205)

## 0.29.0 (2026-11-01)

### Features

- feat(ci): keep lockfile packages on the npm registry (CL-133)
- feat(ci): pin each required check to the Actions app (CL-134)

## 0.28.2 (2026-11-01)

### Fixes and maintenance

- docs(tracker): record the Neighborhood starting branch (CL-601)

## 0.28.1 (2026-11-01)

### Fixes and maintenance

- docs(tracker): record that clutch drives the workflow (CL-902)

## 0.28.0 (2026-11-01)

### Features

- feat(tracker): generate the tracker on main, never in a PR (CL-123)

### Fixes and maintenance

- docs(skills): ask the owner for one approval round per batch (CL-124)
- fix(pr): keep the whole stack and only the PR's commits in sync (CL-311)

## 0.27.0 (2026-10-31)

### Features

- feat(cli): add clutch worktree new and list (CL-201)
- feat(cli): add clutch worktree rm and dev --stop (CL-201b)

### Fixes and maintenance

- fix(pr): act on the checkout's head in pr sync and pr wait (CL-122)
- fix(pr): refuse a merge that waits for a code owner (CL-138)
- docs(worktree): document per-checkout isolation (CL-202)

## 0.26.2 (2026-10-31)

### Fixes and maintenance

- test(release): read the capability count (CL-127)

## 0.26.1 (2026-10-31)

### Fixes and maintenance

- ci: check only the affected scope on each PR (CL-303)

## 0.26.0 (2026-10-31)

### Features

- feat(validate): add validate --changed and clutch checks (CL-204)

## 0.25.3 (2026-10-31)

### Fixes and maintenance

- test: wait for the event instead of a fixed sleep (CL-309)

## 0.25.2 (2026-10-31)

### Fixes and maintenance

- test(cli): stop CLI tests needing tags or a fixed count (CL-310)

## 0.25.1 (2026-10-31)

### Fixes and maintenance

- docs(tracker): survey Neighborhood for upstream (CL-605)

## 0.25.0 (2026-10-31)

### Features

- feat(pr): open agent PRs as the release bot (CL-137)

## 0.24.0 (2026-10-31)

### Features

- feat(metrics): grade dry-run verdicts in one place (CL-130)

## 0.23.0 (2026-10-30)

### Features

- feat(ci): turn auto-merge on for bot PRs (CL-405)

## 0.22.0 (2026-10-30)

### Features

- feat(ci): auto-merge in steps, with a main-red guard (CL-132)

## 0.21.0 (2026-10-30)

### Features

- feat(cli): add PR size, agent branches and steps to metrics (CL-503b)

## 0.20.3 (2026-10-30)

### Fixes and maintenance

- fix(pr): fix three gaps in the pr commands (CL-121)

## 0.20.2 (2026-10-30)

### Fixes and maintenance

- fix(cli): let clutch sync finish in a fresh project (CL-131)

## 0.20.1 (2026-10-30)

### Fixes and maintenance

- ci(release): keep the bot key in a main-only environment (CL-136)

## 0.20.0 (2026-10-30)

### Features

- feat(ci): require agent review and SAST via a synced ruleset (CL-308)

## 0.19.0 (2026-10-30)

### Features

- feat(ci): label each PR with its size and warn when large (CL-401)

## 0.18.0 (2026-10-30)

### Features

- feat(ci): run Semgrep where code scanning is not available (CL-135)

## 0.17.0 (2026-10-30)

### Features

- feat(ci): label each PR with its kind and areas (CL-109)

## 0.16.0 (2026-10-30)

### Features

- feat(skills): add the babysit-pr skill (CL-111)

## 0.15.0 (2026-10-30)

### Features

- feat(ci): revert a merged PR with one label (CL-110)

## 0.14.3 (2026-10-30)

### Fixes and maintenance

- fix(verify): start no flow before its owner record (CL-107)

## 0.14.2 (2026-10-30)

### Fixes and maintenance

- test(sync): migrate the PGlite test database once (CL-903)

## 0.14.1 (2026-10-30)

### Fixes and maintenance

- ci(review): drop the unused id-token grant (CL-115)

## 0.14.0 (2026-10-30)

### Features

- feat(skills): add a command index and nudge raw gh calls (CL-120)

## 0.13.3 (2026-10-30)

### Fixes and maintenance

- docs(gardening): name the token that opens the gardening PR

## 0.13.2 (2026-10-30)

### Fixes and maintenance

- build(deps): add Renovate with a 3-day minimum release age (CL-104)

## 0.13.1 (2026-10-30)

### Fixes and maintenance

- build(validate): run validate from tools/validate.ts (CL-126)

## 0.13.0 (2026-10-30)

### Features

- feat(pr): add status, wait, failures, sync and ready commands (CL-117)

## 0.12.2 (2026-10-30)

### Fixes and maintenance

- docs(skills): add the run-lanes skill (CL-119)

## 0.12.1 (2026-10-30)

### Fixes and maintenance

- build(validate): print failing task output inline (CL-125)

## 0.12.0 (2026-10-30)

### Features

- feat(cli): add clutch issues new with safe ids (CL-118)

## 0.11.1 (2026-10-30)

### Fixes and maintenance

- fix(release): pass check-changeset on a release commit (CL-116)

## 0.11.0 (2026-10-30)

### Features

- feat(risk): re-tier risk to Brendan's rule (CL-114)

## 0.10.0 (2026-10-30)

### Features

- feat(ci): make every dry-run verdict countable (CL-112)

## 0.9.4 (2026-10-30)

### Fixes and maintenance

- docs(ci): audit CI credentials and waive oidc_ci (CL-105)

## 0.9.3 (2026-10-30)

### Fixes and maintenance

- ci(codeql): add the CodeQL workflow (CL-102)

## 0.9.2 (2026-10-30)

### Fixes and maintenance

- ci(workflows): admit only same-repo runs to auto-merge (CL-113)

## 0.9.1 (2026-10-30)

### Fixes and maintenance

- ci(workflows): lint workflows with actionlint and zizmor (CL-103b)

## 0.9.0 (2026-10-30)

### Features

- feat(ci): add the low-risk auto-merge workflow in dry-run mode (CL-404)

## 0.8.0 (2026-10-30)

### Features

- feat(cli): add risk tiers by path (CL-403)

## 0.7.0 (2026-10-30)

### Features

- feat(cli): add clutch metrics for factory observability (CL-503)

### Fixes and maintenance

- ci(workflows): pin every action to a commit SHA (CL-103)

## 0.6.8 (2026-10-30)

### Fixes and maintenance

- ci: run actions on Node 24 and pin ubuntu-26.04 (CL-042)

## 0.6.7 (2026-10-30)

### Fixes and maintenance

- ci(gardening): let gardening PRs pass the gates (CL-041)

## 0.6.6 (2026-10-30)

### Fixes and maintenance

- chore(trust): record the main ruleset and adopt protection (CL-106)

## 0.6.5 (2026-10-30)

### Fixes and maintenance

- docs(tracker): re-sequence the plan around delegated merge (CL-040)

## 0.6.4 (2026-10-30)

### Fixes and maintenance

- fix(doctor): prove review and gardening agents can run (CL-038)

## 0.6.3 (2026-10-30)

### Fixes and maintenance

- fix(tracker): close the gaps the P0 audit found (CL-036)

## 0.6.2 (2026-10-30)

### Fixes and maintenance

- ci(release): push releases with a GitHub App token (CL-039)

## 0.6.1 (2026-10-30)

### Fixes and maintenance

- ci(review): run agent workflows on the cheapest model (CL-037)

## 0.6.0 (2026-10-30)

### Features

- feat(security): scan secrets with gitleaks, add SECURITY.md (CL-101)

## 0.5.2 (2026-10-30)

### Fixes and maintenance

- docs(tracker): refresh every plan against the current repository

## 0.5.1 (2026-10-30)

### Fixes and maintenance

- docs(tests): review every test file (CL-029)

## 0.5.0 (2026-10-30)

### Features

- feat(cli): run sync, init and doctor from the release binary (CL-028b)

## 0.4.0 (2026-10-30)

### Features

- feat(cli): follow the latest Clutch release, not a pin (CL-028)

## 0.3.0 (2026-10-30)

### Features

- feat(mise): install the clutch binary from the latest release (CL-025b)

## 0.2.0 (2026-10-30)

### Features

- feat(cli): ship clutch as a release binary for the tracker (CL-025)

## 0.1.0 (2026-10-30)

### Features

- feat(release): add changesets and the changeset check (CL-032)
- feat(release): release on each merge and start projects fresh (CL-032b)

### Fixes and maintenance

- fix(release): install without git hooks in the release job

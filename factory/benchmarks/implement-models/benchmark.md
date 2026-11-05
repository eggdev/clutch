---
description: Compares Opus and Sonnet on the implement agent, with 3 small Clutch issues.
agent: implement
configs:
  - name: opus
    model: claude-opus-5-5
  - name: sonnet
    model: claude-sonnet-5-5
tasks:
  - name: cl-116-release-changeset
    commit: 25076894f5bbd0853aecf252d88d422aeef18352
    issue: .clutch/issues/CL-116.md
    check: >-
      git fetch --quiet --depth 1 "$CLUTCH_BENCH_REPO" a54639d5555929ba6aeba6e63a2b649a359cf7af &&
      git checkout FETCH_HEAD -- tools/check-changeset.test.ts &&
      mise exec -- bun test tools/check-changeset.test.ts
  - name: cl-103-pin-actions
    commit: a9f551f00d526573998eb0caf3515222e61936de
    issue: .clutch/issues/CL-103.md
    check: >-
      git fetch --quiet --depth 1 "$CLUTCH_BENCH_REPO" 9b3fb74f85eb0b3838c9e11a0c130f1b6518b150 &&
      git checkout FETCH_HEAD -- tools/check-workflows.test.ts apps/cli/src/doctor/seed.test.ts &&
      mise exec -- bun test tools/check-workflows.test.ts apps/cli/src/doctor/seed.test.ts
  - name: cl-504-fleet-key
    commit: 9bc97e32b94de0ec00816774ed74812853326ace
    issue: .clutch/issues/CL-504.md
    check: >-
      git fetch --quiet --depth 1 "$CLUTCH_BENCH_REPO" 3448c498b7c224ad2a586e865518e910f62503a3 &&
      git checkout FETCH_HEAD -- apps/cli/src/clutch-config/schema.test.ts &&
      mise exec -- bun test apps/cli/src/clutch-config/schema.test.ts
---

# Implement models

The suite measures how well each model builds a small issue with the
`implement` agent. Each task is a merged Clutch issue whose pull request added
or changed a test.

- Each task starts from the commit before the pull request's first code
  commit. The issue file is there, and the pull request's code is not.
- The agent gets the `implement` prompt, the rules of a benchmark run and the
  issue. It works in a scratch clone with no remote and no later history.
- The check copies the pull request's test files into the clone, then runs
  them. The agent never sees those files. Exit 0 passes.
- Each check fails at its pinned commit and passes at the head of its pull
  request. The pull request of CL-504 checked the key only. Its workflow needs
  a token, so the check leaves it out.

| Task                       | Issue                                                    | Pull request test files                                             |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| `cl-116-release-changeset` | A release commit passes `check-changeset`                | `tools/check-changeset.test.ts`                                     |
| `cl-103-pin-actions`       | `check-workflows` rejects a `uses:` without a commit SHA | `tools/check-workflows.test.ts`, `apps/cli/src/doctor/seed.test.ts` |
| `cl-504-fleet-key`         | `clutch.yaml` takes a `fleet` list of `repo` and `ref`   | `apps/cli/src/clutch-config/schema.test.ts`                         |

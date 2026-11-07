# CI failure explainer / investigation agent

A CI failure explainer is an agent that reads the logs of a failed CI run and comments with the cause and the fix.

## Why

Rank 63 of the researched practices. More than one third of the leading repositories use it (37%). A failed run often hides its cause in a long log. A short comment with the failed step and the fix command saves each author that search.

## Detection

`clutch doctor` reports this capability as present when two rules pass. `tools/github/failures.ts` exists, and the babysit-pr skill runs `pr failures`. It is partial when only one rule passes. See the `ci_failure_explainer` entry in [the registry](./registry.yaml).

## Adopt

The session that built a pull request explains its own failures. No workflow waits for CI to finish and comments later.

1. Keep `tools/github/failures.ts` and the `failures` command in `tools/github/pr.ts`. `bun run pr failures <number>` prints the failed step of each failed job, and the output of each failed Nx task.
2. Keep the step in [babysit-pr](../../../.agents/skills/babysit-pr/SKILL.md) that reads each red check with `pr failures` before it decides.
3. Set `ci_failure_explainer` to `adopted` in `clutch.yaml`.

A red default branch after a merge belongs to the session that merged: `pr merge` watches CI on the merge commit. See [rollback](../operations/rollback.md#auto-revert).

## Waive

Set `ci_failure_explainer` to `waived` in `clutch.yaml` with a reason. This capability is extra, so a gap only warns. A waiver is reasonable when CI failures are rare and their logs are short.

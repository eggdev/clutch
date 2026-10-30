# Changed-files / affected-scope check

An affected-scope check runs the checks only for the projects that a change touches.

## Why

Rank 17 of the researched practices. More than four in five of the leading repositories use it (85%). A full run gets slow as a repository grows, and agents push many small changes. An affected run gives fast feedback, and the default branch still runs every check.

## Detection

`clutch doctor` reports this capability as present when two rules pass. A workflow runs `nx affected`, `affected -t` or `nx-set-shas`. A file in `tools/hooks/` mentions `CHECK_BASE` or `merge-base`. It is partial when only one rule passes. See the `changed_scope_check` entry in [the registry](./registry.yaml).

## Adopt

1. In the CI workflow, find the base commit of each pull request. Use the merge base with the default branch, or the `nrwl/nx-set-shas` action.
2. Run `nx affected -t` with the same targets as the canonical check command.
3. Run the root checks on each pull request, because they read the whole repository.
4. Run the full canonical check command on each push to the default branch.
5. In a local hook, compare with the merge base in the same way. In this repository, [`tools/hooks/pre-push.ts`](../../../tools/hooks/pre-push.ts) uses `git merge-base`.
6. Set `changed_scope_check` to `adopted` in `clutch.yaml`.

## Waive

Set `changed_scope_check` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable for a small repository where the full check runs in a few minutes.

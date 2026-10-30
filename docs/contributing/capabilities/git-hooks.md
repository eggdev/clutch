# Git hooks (pre-commit / lefthook / husky / prek)

Git hooks run checks on the local machine before a commit or a push leaves it.

## Why

Rank 13 of the researched practices. About two thirds of the leading repositories use it (67%). A hook finds a format, lint or type error in seconds, before CI runs. Agents and people get the same feedback at the cheapest point.

## Detection

`clutch doctor` reports this capability as present when git tracks a file in `.githooks/` or `.husky/`, or a `lefthook.yml` or `lefthook.yaml` file at the root. See the `git_hooks` entry in [the registry](./registry.yaml).

## Adopt

1. Add the hook scripts to `.githooks/`. This repository has a `pre-commit` hook and a `pre-push` hook there.
2. Point Git at the folder from the root `prepare` script. In this repository, [`tools/hooks/install.ts`](../../../tools/hooks/install.ts) sets `core.hooksPath` to `.githooks`.
3. Run the fast checks on the staged files in `pre-commit`. Run the tests in `pre-push`.
4. Read [Git hooks](../setup/checks.md#git-hooks) for the hooks of this repository.
5. Husky and lefthook are other options. Each one also counts.
6. Set `git_hooks` to `adopted` in `clutch.yaml`.

## Waive

Set `git_hooks` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when nobody commits on a local machine, and CI is the only gate.

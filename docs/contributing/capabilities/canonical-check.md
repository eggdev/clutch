# Single canonical check command

A canonical check command is one command that runs every check that a change must pass.

## Why

Rank 20 of the researched practices. About nine in ten of the leading repositories use it (89%). An agent needs one answer to the question "is this change done?". One command also keeps the local run and CI the same.

## Detection

`clutch doctor` reports this capability as present when the root `package.json` has a `validate` script. See the `canonical_check` entry in [the registry](./registry.yaml).

## Adopt

1. Add a `validate` script to the root `package.json`. In this repository, it runs the typecheck, the tests, lint, the format check and the repository checks through Nx.
2. Run the same command in CI. See [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml).
3. Name the command in `AGENTS.md`.
4. Read [checks](../setup/checks.md) for the targets that `validate` runs in this repository.
5. Set `canonical_check` to `adopted` in `clutch.yaml`.

## Waive

Set `canonical_check` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable for a repository with no root `package.json`, such as one that uses `make check`.

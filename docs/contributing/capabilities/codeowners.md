# CODEOWNERS / ownership registry

A `CODEOWNERS` file names the people or teams who own each path, so GitHub asks them to review a change to that path.

## Why

Rank 5 of the researched practices. More than four in five of the leading repositories use it (85%). Ownership tells an agent and a reviewer who decides on a path. A required owner review also protects the guardrail files from a change that weakens a check.

## Detection

`clutch doctor` reports this capability as present when git tracks a `CODEOWNERS` file at the root, in `.github/` or in `docs/`. See the `codeowners` entry in [the registry](./registry.yaml).

## Adopt

1. Add `.github/CODEOWNERS`. The [`CODEOWNERS`](../../../.github/CODEOWNERS) file of this repository is an example.
2. Give each guardrail file an owner. `check-agent-hooks` rejects a guardrail file with no owner in `.github/CODEOWNERS`.
3. To make owner review required, turn on code owner review in the branch rules on GitHub.
4. Set `codeowners` to `adopted` in `clutch.yaml`.

## Waive

Set `codeowners` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable for a repository with one maintainer, because each review goes to the same person.

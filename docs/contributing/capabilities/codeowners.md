# CODEOWNERS / ownership registry

A `CODEOWNERS` file names the people or teams who own each path, so GitHub asks them to review a change to that path.

## Why

Rank 5 of the researched practices. More than four in five of the leading repositories use it (85%). Ownership tells an agent and a reviewer who decides on a path. A required owner review also protects the guardrail files from a change that weakens a check.

## Detection

`clutch doctor` reports this capability as present when git tracks a `CODEOWNERS` file at the root, in `.github/` or in `docs/`. See the `codeowners` entry in [the registry](./registry.yaml).

## Adopt

1. Add `.github/CODEOWNERS`. The [`CODEOWNERS`](../../../.github/CODEOWNERS) file of this repository is an example.
2. Generate it from the `one-way-door` tier of `.clutch/risk.yaml`, which holds each guardrail file: `mise exec -- bun tools/codeowners.ts --write`. It keeps the owner named in the current file. `check-agent-hooks` fails when the file drifts from the tier, or names no owner. The main ruleset requires a code owner's approval, so GitHub asks the owner to approve each one-way-door PR. See [approval](../../../.agents/skills/deliver/references/pull-requests.md#approval).
3. To make owner review required, turn on code owner review in the branch rules on GitHub.
4. Set `codeowners` to `adopted` in `clutch.yaml`.

## Waive

Set `codeowners` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable for a repository with one maintainer, because each review goes to the same person.

# Repo-owned agent verification CLI (drives the running app)

A verification CLI is a repository tool that starts the real app and drives it, so an agent can prove a change works.

## Why

Rank 42 of the researched practices. About half of the leading repositories use it (48%). Tests prove units, but an agent also needs proof from the running app. A tool that the repository owns runs each journey and records its evidence the same way each time.

## Detection

`clutch doctor` reports this capability as present when two rules pass. Git tracks `.agents/skills/verify/verification.json` or `tools/verification/verify.py`. Git also tracks a Markdown file in `.agents/skills/verify/features/`. It is partial when only one rule passes. See the `verification_cli` entry in [the registry](./registry.yaml).

## Adopt

1. Add a `verify` skill in `.agents/skills/verify/`. The [verify skill](../../../.agents/skills/verify/SKILL.md) of this repository is an example.
2. Add the configuration in [`verification.json`](../../../.agents/skills/verify/verification.json) and the runner in [`tools/verification/verify.py`](../../../tools/verification/verify.py).
3. Describe each feature in a Markdown file in `.agents/skills/verify/features/`. See the [features README](../../../.agents/skills/verify/features/README.md).
4. Read [verification setup](../setup/verification.md).
5. Set `verification_cli` to `adopted` in `clutch.yaml`.

## Waive

Set `verification_cli` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable for a library with no running app, where tests prove each behavior.

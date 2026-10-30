# Protected default branch (PR-only, required checks)

A protected default branch takes changes only through pull requests that pass the required checks.

## Why

Clutch adds this practice, so it has no rank in the research data. When many agents work in parallel, one direct push can break every branch. Branch rules make the checks a gate, not advice.

## Detection

`clutch doctor` reports this capability as present when the `protected_main` remote probe passes. Doctor checks the probe on GitHub only with `--remote`. Without that flag, it reports the capability as unknown. See the `protected_main` entry in [the registry](./registry.yaml).

## Adopt

1. On GitHub, add a ruleset for the default branch.
2. Require a pull request before each merge. Dismiss stale approvals after a push.
3. Require the status checks that run the canonical check command.
4. Block force pushes and branch deletion.
5. Run `mise exec -- bun run clutch doctor --remote` to confirm the result.
6. Set `protected_main` to `adopted` in `clutch.yaml`.

## Waive

Set `protected_main` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable for a personal scratch repository, or for a repository on a host other than GitHub.

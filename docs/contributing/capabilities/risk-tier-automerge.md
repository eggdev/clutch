# Risk-tiered / scoped auto-merge or auto-approve

Risk-tiered auto-merge gives each pull request a risk tier from the paths it touches, and merges the low-risk ones without a person.

## Why

Rank 7 of the researched practices. About seven in ten of the leading repositories use it (70%). A person cannot read each agent pull request. Tiers keep human review for the risky paths, and let a docs or test change merge after its checks pass.

## Detection

`clutch doctor` reports this capability as present when three rules pass. Git tracks `.clutch/risk.yaml`. A workflow file runs `gh pr merge --auto`. The `allow_auto_merge` remote probe passes. Doctor checks the remote probe on GitHub only with `--remote`, and reports it as unknown without that flag. A repository whose files pass reports as unknown without that flag. With `--remote`, a probe that fails makes it partial. See the `risk_tier_automerge` entry in [the registry](./registry.yaml).

## Adopt

1. Add `.clutch/risk.yaml` with rules. Each rule maps a tier to a list of path globs. The highest matching tier wins, whatever the rule order.
2. Put only what cannot be paid back in the highest tier. That is credentials and workflow permissions, auth, access, identity, migrations, billing and infra. The merge gate and the policy docs merge as any other change. Use a `lines` rule for a part of a file, such as a workflow's `permissions:`. Put docs and tests in the lowest tier, and every other path in `medium`. See [decision record 0005](../decisions/0005-the-owner-signs-off-what-cannot-be-paid-back.md).
3. Add a CI job that labels each pull request with its tier, such as `risk/low`.
4. Add a workflow that runs `gh pr merge --auto` for a low-risk pull request, with the merge method that the branch rules allow. Require an allowed author and green required checks. Clutch's workflow uses `--merge`, and it counts a PR as an agent's when a bot opened it, or when it is on a `clutch/cl-` branch.
5. Start in a dry-run mode that comments instead of merging. Compare the comments with human judgment.
6. On GitHub, allow auto-merge in the repository settings.
7. Set `risk_tier_automerge` to `adopted` in `clutch.yaml`.

## Waive

Set `risk_tier_automerge` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when a person must approve each merge, such as under a compliance rule.

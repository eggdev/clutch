# Dependency update bots (Renovate / Dependabot)

A dependency update bot opens small pull requests that update the dependencies of a repository.

## Why

Rank 50 of the researched practices. More than three quarters of the leading repositories use it (78%). Small, regular updates are easy to review and to revert. Without a bot, updates pile up into one large change with more risk.

## Detection

`clutch doctor` reports this capability as present when git tracks a `renovate.json` or `renovate.json5` file at the root or in `.github/`. A `dependabot.yml` or `dependabot.yaml` file in `.github/` also counts. See the `dep_automation` entry in [the registry](./registry.yaml).

## Adopt

1. Add `renovate.json` at the root, and install the Renovate app on GitHub. As an alternative, add `dependabot.yml` in `.github/`.
2. For Renovate, extend `config:recommended` and set `rangeStrategy` to `pin`.
3. Group related packages into one pull request, such as all the Nx packages.
4. Set a weekly schedule and a limit on open pull requests.
5. Pin the digests of GitHub Actions too.
6. Set `dep_automation` to `adopted` in `clutch.yaml`.

## Waive

Set `dep_automation` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when a person updates the dependencies on a fixed schedule.

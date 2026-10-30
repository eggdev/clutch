# Dependency minimum release age / update cooldown

A minimum release age makes the package manager or the update bot skip each version younger than a set time.

## Why

Rank 30 of the researched practices. About seven in ten of the leading repositories use it (70%). The registry often finds and removes a malicious package version within days. A cooldown of a few days keeps such a version out of the lockfile.

## Detection

`clutch doctor` reports this capability as present when one of three files sets the age. `bunfig.toml` sets `minimumReleaseAge`. A `renovate.json` file sets `minimumReleaseAge`. `.npmrc` sets `minimum-release-age`. See the `dep_min_age` entry in [the registry](./registry.yaml).

## Adopt

1. For Bun, add `minimumReleaseAge = 259200` to the `[install]` section of `bunfig.toml`. The value is three days, in seconds.
2. Run `mise exec -- bun install --dry-run` to confirm that the pinned Bun accepts the key.
3. For Renovate, set `minimumReleaseAge` to `3 days` in `renovate.json`.
4. For pnpm, set `minimum-release-age` in `.npmrc`.
5. Set `dep_min_age` to `adopted` in `clutch.yaml`.

## Waive

Set `dep_min_age` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when the package manager has no such setting. Then name the cooldown of the update bot in the reason.

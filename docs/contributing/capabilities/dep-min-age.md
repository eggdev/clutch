# Dependency minimum release age / update cooldown

A minimum release age makes the package manager or the update bot skip each version younger than a set time.

## Why

Rank 30 of the researched practices. About seven in ten of the leading repositories use it (70%). The registry often finds and removes a malicious package version within days. A cooldown of a few days keeps such a version out of the lockfile.

## Detection

`clutch doctor` reports this capability as present when one file sets an age or a cooldown. The table below lists each file and key. See the `dep_min_age` entry in [the registry](./registry.yaml).

## Adopt

Set the age in the package manager that the repository uses. Three days is a good start. The units differ, so check the value.

| Package manager | File                  | Setting                               | Unit                    | Three days |
| --------------- | --------------------- | ------------------------------------- | ----------------------- | ---------- |
| Bun             | `bunfig.toml`         | `minimumReleaseAge` under `[install]` | seconds                 | `259200`   |
| npm             | `.npmrc`              | `min-release-age`                     | days                    | `3`        |
| pnpm            | `pnpm-workspace.yaml` | `minimumReleaseAge`                   | minutes                 | `4320`     |
| Yarn            | `.yarnrc.yml`         | `npmMinimalAgeGate`                   | a duration such as `3d` | `3d`       |

1. Add the setting from the table.
2. Run a clean install with the lockfile, such as `bun install --frozen-lockfile`. A locked version younger than the age makes the install fail. Wait, or add an exception.
3. To let one package through, use the exception setting of the package manager. Bun has `minimumReleaseAgeExcludes`. pnpm has `minimumReleaseAgeExclude`. Yarn has `npmPreapprovedPackages`.
4. For an update bot, set a cooldown too. Renovate has `minimumReleaseAge` in `renovate.json`. Dependabot has `cooldown` in its configuration file.
5. Set `dep_min_age` to `adopted` in `clutch.yaml`.

Sources: [Bun](https://bun.com/docs/runtime/bunfig), [npm](https://docs.npmjs.com/cli/v11/using-npm/config), [pnpm](https://pnpm.io/settings/dependency-resolution), [Yarn](https://yarnpkg.com/configuration/yarnrc).

## Waive

Set `dep_min_age` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when the package manager has no such setting. Then name the cooldown of the update bot in the reason.

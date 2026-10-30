# Dependencies

How the repository checks its npm dependencies. Both checks run in
`validate`. See [checks](./checks.md).

## Exact versions

Each dependency is pinned to an exact version in its `package.json`. An
upgrade is a reviewed change. These are the template's core pins:

| Package                                                                  | Version    |
| ------------------------------------------------------------------------ | ---------- |
| `effect`, `@effect/platform-bun`, `@effect/sql-pg`, `@effect/sql-pglite` | 4.0.7      |
| `drizzle-orm`, `drizzle-kit`                                             | 1.0.0-rc.5 |
| `react`, `react-dom`                                                     | 19.3.1     |
| `vite`                                                                   | 8.3.5      |
| `@tanstack/react-router`                                                 | 1.170.46   |
| `tailwindcss`, `@tailwindcss/vite`                                       | 4.3.3      |

[Renovate](#renovate) opens the upgrade PRs.

Drizzle 1.0 is a release candidate. Its Effect drivers need Effect 4, and the
older `@effect/sql-drizzle` package works only with Effect 3. An Effect major
version is a planned upgrade for every package at once.

## Renovate

The repository runs Renovate itself.
[`renovate.yml`](../../../.github/workflows/renovate.yml) runs the open-source
Renovate CLI each day at 04:17 UTC, and on demand from the Actions tab. It reads
[`renovate.json`](../../../renovate.json) and signs in as the
[release bot](./releases.md#the-release-bot), so its PRs start CI and agent
review. Without the release bot, the job skips with a notice.

The config keeps the PR count low:

- Renovate opens new PRs only before 06:00 UTC on Mondays, with at most 3 open.
  The daily runs rebase open PRs and handle security fixes.
- One PR holds every minor and patch update. A major update gets its own PR.
  Nx, oxlint and oxfmt have their own group, since they move together.
- No version younger than 3 days is proposed. A security fix waits 3 days too,
  but skips the weekly schedule. This matches `minimumReleaseAge` in
  `bunfig.toml`, so `bun install` accepts each update.
- `rangeStrategy: pin` keeps exact versions.
- Each PR has the `dependencies` label and a `chore(deps):` commit, so the
  `commits` check passes.
- Each PR carries its changeset. A post-upgrade task runs
  [`tools/release/renovate-changeset.mjs`](../../../tools/release/renovate-changeset.mjs),
  which writes a patch changeset named after the branch. The workflow allows
  only that command.

The `github-actions` manager is off. Updating an action pin changes a workflow
file, and GitHub refuses that push unless the bot has the Workflows
permission. Once the app has it, turn the manager on in `renovate.json`, and
add `permission-workflows: write` to the token step in `renovate.yml`. Renovate
then updates each SHA pin and its version comment together.

Dependabot security updates stay off, so updates come only from Renovate. The
GitHub vulnerability alerts stay on, because Renovate reads them.

Each PR waits for a person to merge it. `renovate.json` sets
`automerge: false` and `platformAutomerge: true`. Set `automerge` to `true` to
let GitHub's own auto-merge merge each dependency PR once the required checks
pass. No script in the repository does the merge.

The workflow uses Actions minutes. A public repository's runs are free. A
private one pays for each daily run from its plan's minutes.

### The hosted app

The hosted Mend Renovate app is free, and it is the alternative to the
workflow. Use one of the two, never both on one repository. Both read the same
`renovate.json`, and both would open PRs on the same `renovate/` branches.
The hosted app also cannot run the changeset task, so each of its PRs would
need `mise exec -- bun run pr open` to add a changeset.

Where both are installed, the workflow opens the update PRs, and the hosted
app must stay in a mode that opens no update PRs. In its "Scan and Alert" mode, the app
still opens a "Configure Renovate" onboarding PR on a repository with no
`renovate.json`. Close that PR unmerged.

## Production audit

The `audit-prod` target runs [`tools/audit-prod.ts`](../../../tools/audit-prod.ts).
It reads the advisories for each production dependency in `bun.lock` with
`bun audit --prod`. A moderate, high or critical advisory fails the target. A
low advisory does not. Dev dependencies are out of scope, because they do not
ship.

The target asks the registry for advisories, so it needs network access. Nx
does not cache it, because the advisories change when the code does not. A
network failure fails the target with no advisory list. Check the connection
and the registry setting, then run the target again.

Fix a failure in this order:

1. Run `mise exec -- bun audit fix`. It upgrades each package to the lowest
   safe version in its declared range.
2. If no safe version is in range, upgrade the direct dependency that pulls the
   package in.
3. If a release has a fix that the range excludes, add an
   [override](#overrides) that pins a safe version, and document it.
4. If no release has a fix, the owner decides. An accepted advisory is an
   entry in [`tools/accepted-advisories.yaml`](../../../tools/accepted-advisories.yaml)
   with its reason and the event that removes it. The target fails on an
   entry whose advisory is gone from the audit, so a stale entry cannot stay.

## Overrides

Bun reads `overrides` and `resolutions` in the root `package.json`. Each key
forces one version of a package across the whole tree. An override hides the
choice from the package that asked for another version, so each one needs a
reason.

[`tools/dependency-overrides.yaml`](../../../tools/dependency-overrides.yaml)
holds one entry for each override: the package, the advisory or bug that it
closes, and the event that removes it. `check-dependency-overrides` fails when:

- An override has no entry, or an entry has no `reason` or no `revisit`.
- An entry names a package with no override. Delete the stale entry with the
  override.
- `package.json` repeats a key at any depth. JSON keeps only the last value, so
  the first one does nothing.

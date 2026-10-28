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

Drizzle 1.0 is a release candidate. Its Effect drivers need Effect 4, and the
older `@effect/sql-drizzle` package works only with Effect 3. An Effect major
version is a planned upgrade for every package at once.

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

# Migrations

A migration changes a stored shape. Once it reaches `main`, it never changes.
To change the shape again, write a new migration. See
[two-way and one-way doors](../../principles/two-way-doors.md).

## Where migrations live

Migration `.sql` files live in a folder named `migrations` under `apps/`,
`features/` or `packages/`. The check below finds them by that name, so the
folder needs no configuration. Other files in the folder, such as snapshots,
can change.

Drizzle Kit `1.0.0-rc.5` writes each package's migrations. It reads
`repo/schema.ts` and writes `repo/migrations/<timestamp>_<name>/migration.sql`
with a `snapshot.json`. Each package's `drizzle.config.ts` names both paths.

| Task               | Command                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| Make a migration   | `mise exec -- bun nx run <package>:db-generate`                          |
| Apply migrations   | Start the API. `apps/api/src/server.ts` runs them first.                 |
| Register a package | Add its `migrate` function to `migrations` in `apps/api/src/packages.ts` |

The API runs each package's migrations in order, with the sync tables first.
The same migrator runs on PGlite and on Postgres.

<!-- kickoff: The command that dry-runs a migration against a copy of production data. -->

## The check

`check-migrations` compares the working tree with a base commit on `main`. It
rejects a change, a rename or a deletion of a migration that the base has. A new
migration passes. It runs in `validate`, in the pre-push hook and in CI.

| Where      | Base                              |
| ---------- | --------------------------------- |
| Local      | The merge base with `origin/main` |
| CI, PR     | The PR's target branch            |
| CI, `main` | The commit before the push        |

When the check fails, restore the merged migration and write a new one.

## One-way migrations

Rehearse a one-way migration on a preview with seed data before it merges, and
attach the difference before and after to the PR. See
[seed data](./seeding.md) and [previews](./previews.md).

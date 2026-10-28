# 0006: Drizzle 1.0 is the ORM

- **Status:** accepted
- **Date:** 2026-10-28

## Context

Effect Schema checks shapes. It does not define tables, migrations or
queries. Raw SQL through Effect's `SqlClient` works, but it gives agents no
schema to follow and no migration generator. The older
`@effect/sql-drizzle` package needs Effect 3 and Drizzle below 0.50, so it
does not work with Effect 4 (0005).

## Decision

Use Drizzle `1.0.0-rc.5`, pinned to that exact version. Its release candidate
includes support for Effect 4: an Effect Postgres driver, Effect query
builders for SQLite, Effect migrators, and Schema generation from tables.

Drizzle is a language in the registry. It is allowed only in `repo/` and in
the server part of `packages/sync`. It is never allowed on the client. The
sync engine owns the local database, and no other code queries it.

Schemas that Drizzle generates from tables stay in `repo/`, to decode rows.
Public records are the hand-written schemas in `types/`.

## Consequences

- Each package keeps its migrations in `repo/migrations/`. The
  `check-migrations` target finds them by folder name.
- A release candidate can change before 1.0. The exact pin stops a surprise
  upgrade. A Drizzle upgrade is a reviewed change, like an Ultracite upgrade.
- No code on the client can skip the object pool to read the local database.

**Revisit if:** Drizzle 1.0 is not stable by 2027-04-28, or its Effect support
leaves the main package.

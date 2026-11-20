# Data storage

Where each fact lives, and the rules that keep tenants apart.

| Question                        | Answer                                          |
| ------------------------------- | ----------------------------------------------- |
| Which stores exist?             | See the runtime map in the [index](./index.md)  |
| Which tenant owns a record?     | The tenant ID in its key, column or name prefix |
| What leaves with a tenant?      | Everything in the data inventory below          |
| What can never change in place? | The frozen storage contracts below              |

## Every resource belongs to a tenant

A resource is owned by a tenant, never by a person. Signup creates a personal
tenant for each person, with that person as its only member. A product for one
person at a time still works this way.

The product does not have to show tenants. Organizations, teams and invites are
product features that kickoff decides on. The ownership model leaves room for
them: a second member joins an existing tenant, and no stored key or owner
column moves.

## Tenant isolation

Every tenant-owned record is scoped by the tenant ID: a column, a key prefix or
an object name. Every read and write takes the tenant ID as an argument. Two
tenants with the same logical name land on different records.

Each tenant-scoped test covers both paths: the owner succeeds, and another
tenant is denied.

<!-- kickoff: The isolation invariant from project intent, and any store that is not tenant-scoped, with the reason. -->

## Data inventory

One inventory lists every store that holds tenant data. Deletion and export both
read it, so they always cover the same data. Each table that grows needs a
retention rule or a written exemption in the inventory. No check covers this
rule. Review it in each change that adds a table.

<!-- kickoff: The file that holds the inventory, and a table: Store, What it holds, Retention, Exported. -->

## Frozen storage contracts

Some identifiers and stored shapes outlive any deploy: key formats, object
names, JSON stored in a column. They are cheap to list and costly to discover
later. A change to one adds fields on write and stays compatible on read,
unless a migration rewrites every stored copy. See
[two-way and one-way doors](../../principles/two-way-doors.md).

The template's sync engine holds these frozen contracts:

| Contract                                                     | Defined in                              |
| ------------------------------------------------------------ | --------------------------------------- |
| The `sync_counters`, `sync_events` and `sync_records` tables | `packages/sync/repo/schema.ts`          |
| The change shape in each event, with its `groups`            | `packages/sync/types/protocol.ts`       |
| The `records`, `transactions` and `position` client stores   | `packages/sync/runtime/indexed-db.ts`   |
| The saved pool state, with `groups`, `meta` and `actor`      | `packages/sync/types/local-database.ts` |

An event keeps its organization ID, so the log is scoped by tenant too. Its
`groups` column holds the sync groups of all its changes, with a GIN index.
An event written before the column existed has no groups, so no client gets
it. A saved pool state without `groups` and `meta` loads as an empty pool.
A saved position without `actor` keeps its copy, and takes the actor that the
server names first. The `records` store holds no record that is in no loaded
group of the position. A copy at sync ID 0 holds only part of a first load.
The next pull from 0 drops each record that it does not send again.

`sync_events` grows with each write. Its retention rule is
`SYNC_LOG_KEEP_DAYS`, which has no value in the template, so the log keeps
every event. With a value, the hourly `sync/trim-log` job deletes the older
events and the deleted records of `sync_records` that they leave behind. See
[the size of the log](./local-first-sync.md#the-size-of-the-log).

<!-- kickoff: Each other frozen contract: each key format, object name and stored JSON shape, with the file that defines it. -->

## What to read when changing it

- `packages/sync/runtime/database.server.ts`: the PGlite and Postgres drivers
- `repo/schema.ts` and `repo/migrations/` of each package
- [Server](./server.md#database) and [migrations](../setup/migrations.md)

<!-- kickoff: The file that holds the inventory. -->

- [Normalized source of truth](../../principles/normalized-source-of-truth.md)
- [Soft delete](./soft-delete.md): what delete does, and when data goes for good

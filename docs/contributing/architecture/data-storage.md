# Data storage

Where each fact lives, and the rules that keep tenants apart.

| Question                        | Answer                                          |
| ------------------------------- | ----------------------------------------------- |
| Which stores exist?             | See the runtime map in the [index](./index.md)  |
| Which tenant owns a record?     | The tenant ID in its key, column or name prefix |
| What leaves with a tenant?      | Everything in the data inventory below          |
| What can never change in place? | The frozen storage contracts below              |

## Tenant isolation

Every tenant-owned record is scoped by the tenant ID: a column, a key prefix or
an object name. Every read and write takes the tenant ID as an argument. Two
tenants with the same logical name land on different records.

Each tenant-scoped test covers both paths: the owner succeeds, and another
tenant is denied.

<!-- kickoff: The isolation invariant from project intent, and any store that is not tenant-scoped, with the reason. -->

## Data inventory

One inventory lists every store that holds tenant data. Deletion and export both
read it, so they always cover the same data. A test fails when a table that
grows has no retention rule or a written exemption.

<!-- kickoff: The file that holds the inventory, and a table: Store, What it holds, Retention, Exported. -->

## Frozen storage contracts

Some identifiers and stored shapes outlive any deploy: key formats, object
names, JSON stored in a column. They are cheap to list and costly to discover
later. A change to one adds fields on write and stays compatible on read,
unless a migration rewrites every stored copy. See
[two-way and one-way doors](../../principles/two-way-doors.md).

<!-- kickoff: The list of frozen contracts: each key format, object name and stored JSON shape, with the file that defines it. -->

## What to read when changing it

<!-- kickoff: The files that own storage drivers, migrations and the inventory. -->

- [Normalized source of truth](../../principles/normalized-source-of-truth.md)

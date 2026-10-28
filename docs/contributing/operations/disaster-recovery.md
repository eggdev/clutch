# Disaster recovery

How to get each store back after data loss, and how we know the path works.

| Question                              | Answer                                             |
| ------------------------------------- | -------------------------------------------------- |
| How much data can each store lose?    | The recovery targets below                         |
| What comes back, and from where?      | The three lists below                              |
| How do we know a recovery path works? | A live drill proved it. Each drill is an issue     |
| Who can delete a backup?              | No credential that can also delete production data |

## Recovery targets

The authority database holds the event log and every owner record, so its
backup restores both. A client never needs a backup. After a restore, each
client asks for the events after its last sync ID. A client whose last sync ID
is above the restored log gets `ServerBehind`. It drops its confirmed records
and loads again from sync ID 0. It keeps its pending transactions and sends
them again, so a write that the restore lost applies again.

<!-- kickoff: A table: Store, Recovery point (the most data it may lose, such as 24 hours), Recovery time (how long a restore may take), Recovery path. One row for each store in the runtime map. -->

## What comes back

Each store is on exactly one of these lists.

1. **Backed up.** A copy outside production restores it.
2. **Rebuilt.** The store is derived from other data, such as a search index or
   a cache. A command rebuilds it from the owner record. See
   [normalized source of truth](../../principles/normalized-source-of-truth.md).
3. **Accepted loss.** The owner accepts that this data can go, such as local
   logs. The entry says what users lose.

<!-- kickoff: The three lists, one line for each store, with the command or backup that brings it back. -->

## A path counts only after a drill

A recovery path is a guess until a drill restores real data from it. Each drill
is an issue from the recovery drill form: the store, the backup it used, the
steps, the time it took and what failed. Until a drill proves a path, treat
its recovery target as unmet.

- Drill each backed-up store after its setup, and again after a change to its
  backup.
- Restore into a separate environment, never over production.
- A production restore follows a drill of the same path. An incident restore
  with no proven path is a one-way door. See
  [two-way and one-way doors](../../principles/two-way-doors.md).

<!-- kickoff: The link to the latest drill issue for each backed-up store. -->

## Separate credentials

No single credential can delete both production data and its backups. The
backup store uses its own account or its own credential, and production
runtimes cannot delete from it. See [operator accounts](./operator-accounts.md).

## Encryption keys

This section applies only when the project encrypts stored data with a key that
it holds. Kickoff decides that from a stated threat. Most projects rely on the
encryption of their storage vendor and skip it.

A key that encrypts stored data has an escrow copy outside the vendor that uses
it. A drill opens the escrow copy and decrypts sample data with it. A copy that
nobody has opened is not proven. See [secret rotation](./secret-rotation.md).

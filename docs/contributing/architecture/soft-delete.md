# Soft delete

When a user deletes something, the product hides it first and removes it
later. A user can restore it during the restore window. After the window, a
purge removes it for good.

| Question                          | Answer                                                    |
| --------------------------------- | --------------------------------------------------------- |
| What does delete do?              | It sets `deleted_at`. The record stays                    |
| How long can a user restore it?   | 30 days, unless kickoff sets another window               |
| Who can read a deleted record?    | Only the repo that owns the record, for restore and purge |
| When does the record go for good? | When the purge runs after the window                      |

<!-- kickoff: The restore window, and each kind of data that skips soft delete, with the reason (for example logs, or a legal duty to erase at once). -->

This page applies
[one door for each decision](../../principles/one-door-for-each-decision.md).

## Rules

- **Every live read leaves out deleted records.** Each query on a table with
  `deleted_at` goes through one helper that adds the filter. A check rejects a
  query on such a table that skips the helper. Only the owner repo may read
  deleted records, because it owns restore and purge. No file opts out.
- **A delete reaches every client.** The server change returns a `delete`
  change, so the delta removes the record from each object pool.
- **Restore clears `deleted_at`** while the record is inside the window.
- **Purge runs in its own lane.** It removes records past the window, together
  with their data outside the database, from the
  [data inventory](./data-storage.md#data-inventory). Each purge writes an audit
  record. The first purge in production is a dry run that only reports what it
  would remove.
- **No flag.** Soft delete has one read path. A flag would create a second one.
- **A legal duty to erase wins.** When the law or the user's own request needs
  data gone now, the purge runs for that record at once, and the audit says why.

## What to read when changing it

<!-- kickoff: The helper that filters live reads, the check that enforces it, and the purge job. -->

- [Data storage](./data-storage.md)

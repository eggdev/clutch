# Two-way and one-way doors

A merge to `main` is a production write.

A change is two-way when a revert and a redeploy remove every trace of it: copy,
layout, an internal refactor, or any change still on a branch. Ship it and
change it if it is wrong.

A change is one-way when a copy outlives the deploy: a migration that ran, a
saved document on a device, a request shape that an installed build sends, a
link in a sent email, or deleted user data. A change that touches a
[hard invariant](../contributing/project-intent.md#hard-invariants) is one-way
by definition.

## One-way changes need the owner

Before a one-way change merges:

1. Add the `one-way-door` label to the PR. CI blocks the merge until the
   [owner](../contributing/project-intent.md#owner) approves.
2. Add a PR section that lists each copy that outlives the deploy and its
   recovery path.
3. Tag the owner on the issue.

## Rules for stored shapes

- Give each stored shape a version.
- Migrations only move forward.
- Add optional fields before you change a shape.
- Give readers a recovery path for a version they cannot read.
- Rehearse a one-way migration before it merges. Run it on a preview with seed
  data, and attach the difference before and after to the PR. Each difference
  is one that you expect.
- Record the no in [decision records](../contributing/decisions/index.md) when
  the next agent would otherwise propose it again.

## Move data between stores

Moving a fact from one store to another is one-way. Do it in this order:

1. Stop writes to the source for a short window.
2. Copy the data.
3. Compare row counts and a sample of records, including the owner of each
   record.
4. Switch reads and writes together, in one deploy. Never read from one store
   and write to the other.
5. Keep the source as the rollback until the comparison passes. A later
   migration deletes it.

## Example

A saved document carries `schemaVersion: 1`. The reader returns `null` for any
other version, and the session recovers with a fresh authorized read. Button
copy is two-way: edit the screen.

## Related

- [Delete what is off the common path](./delete-off-the-common-path.md)

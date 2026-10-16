# Operations

How to operate production. Open only the page you need.

| Page                                        | Open it when                                         |
| ------------------------------------------- | ---------------------------------------------------- |
| [Rollback](./rollback.md)                   | A deploy broke production                            |
| [Secret rotation](./secret-rotation.md)     | A key leaked, expires or is due for rotation         |
| [Operator accounts](./operator-accounts.md) | You need a vendor account, a token or access back    |
| [Security](../security.md)                  | You change auth, headers, logs or deploy permissions |

<!-- kickoff: One row for each project runbook, such as a data migration or a disaster recovery page. Delete this slot when there is none. -->

## Runbook shape

A runbook is a page for one operation on production. Each runbook has these
sections, in this order.

1. **Ownership.** A table: concern, owner. The owner is a service, a store or a
   job, never a person.
2. **Invariants.** Each line starts with "Never". Write the act that breaks
   production, and why. For example: "Never run the data copy a second time. It
   overwrites rows that users changed."
3. **Steps.** Numbered steps, one action each. Give the command and the result
   that shows the step worked. Check health after each step.
4. **Later deploys.** After the operation, the deploy workflow does the work.
   Merge and watch. Do not run commands by hand.

A runbook step that cannot be undone is a one-way door. Name it in the step.
See [two-way and one-way doors](../../principles/two-way-doors.md).

## Rules for all operations

- Production changes go through the deploy workflow. A hand-run command is for
  a runbook step or an incident only.
- Never cancel a running deploy. See [rollback](./rollback.md).
- Never put a secret in a chat, an issue or a command argument.
- After an incident, open an issue for each leftover: a shim, a flag or an
  extra column. See
  [delete what is off the common path](../../principles/delete-off-the-common-path.md).

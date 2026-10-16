# Feature flags

A flag turns a feature on for some users while the feature is being proven.
This page applies [one door for each decision](../../principles/one-door-for-each-decision.md).

| Question                    | Answer                                                        |
| --------------------------- | ------------------------------------------------------------- |
| Which flags exist?          | The registry in code. Nothing else creates a flag             |
| Is a flag on for a request? | The flag service holds the state. The server evaluates it     |
| What if the service fails?  | The flag is off, and the failure is reported                  |
| When does a flag go away?   | When its removal condition is true. Its cleanup issue says so |

<!-- kickoff: The flag service that holds the state (PostHog is the default), the owner module that wraps it, and the file that holds the registry. -->

## Rules

- **The registry in code is the only list of flags.** Each entry has a key, an
  owner, the metric that decides whether the feature works, and a removal
  condition. A gate takes a registry key, so an unknown key does not compile.
  Deleting an entry breaks the build at every gate that still reads it.
- **The service holds only state.** It says whether a flag is on, and for whom.
  A flag in the service with no registry entry has no effect.
- **Evaluation fails closed.** When the service cannot answer, the flag is off.
  The owner module reports the failure as an error. It never fails quietly. See
  [fail loudly](../../principles/fail-loudly.md).
- **The server decides.** The client gets the values that the server
  evaluated for its request. A client never evaluates a flag that guards data
  or money.
- **A flag is never a permission or a plan limit.** Access goes through the
  [access check](./authorization.md). A limit goes through its own check in the
  write transaction.
- **Each flag has a cleanup issue from the start.** Open it in the change that
  adds the flag. Its "Ready when" is the removal condition, such as "on for
  every user for 14 days". When the flag goes, delete the gate, the old branch
  and the registry entry in one change. See
  [delete what is off the common path](../../principles/delete-off-the-common-path.md).

## Tests

A test sets flag state through the owner module's setup builder in
`src/testing/`. It never mocks the flag service or the registry. Test both
states of a flag that a journey depends on.

## What to read when changing it

<!-- kickoff: The registry file, the owner module and its testing builder. -->

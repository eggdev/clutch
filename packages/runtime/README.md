# Review runtime

The durable native-session queue is in src/session-queue.ts. It uses Bun's real
SQLite runtime, WAL, full synchronous writes and immediate transactions. No new
dependency or running service is required.

Run its public-interface journeys from the repository root:

```sh
mise exec -- bun test packages/runtime
```

## Session lifecycle

Enqueue with owner, request ID, project, workspace and source revision. Repeating
the same request returns the original session; changing its identity conflicts.
FIFO order uses a durable sequence, including across database connections.

The trusted runtime controller calls claim with its lease and maximum runtime
policy. The queue admits one active session. A lease carries a session ID,
monotonic generation and random token. authorize checks identity and expiry;
renew never extends past maximum runtime.

finish, cancel, expire and interrupt revoke interaction and enter cleaning.
The slot remains occupied. A trusted cleanup executor supplies a cleanup ticket
and a bounded diagnostic to completeCleanup. Unverified cleanup quarantines the
slot; retryCleanup rotates the ticket so late receipts cannot complete a retry.
Only verified cleanup permits the next grant. Product outcome and cleanup state
are separate facts.

Opening another connection never interrupts a live controller. After actual
controller loss, a successor must fence the previous controller externally and
interrupt the known lease, or expire it after its deadline. Pending cleanup
survives reopening and can be resumed. No UI action is replayed.

## Integration boundary

This is a trusted internal state machine, not a public authorization service.
Do not expose its methods or SQLite file to agent code. Resolve authenticated
owners at the service boundary; caller-supplied owner strings are not credentials.
The database parent directory must be private to the controller. Queue status
omits lease and cleanup tokens; controller-only operations return those secrets.

Every real driver action must validate and enforce the current generation at its
execution boundary. Checking authorize and then launching an independently
accessible driver leaves a race and a bypass. Revocation must fence existing
commands as well as new commands before cleanup is accepted.

This package does not terminate processes, own device resources, verify actual
cleanup, check host pressure, attach T3 panels or implement owner heartbeats.
There is no installed daemon or CLI. The existing broker/T3 integration remains
to be resolved before the module can arbitrate real host access. Its verification
of a cleanup receipt is state-machine validation, not physical cleanup proof.

Schema version 1 is persisted via SQLite user_version. Unknown versions fail
closed. Sessions have no automatic deletion or evidence-retention policy.

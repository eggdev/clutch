# Local-first sync

How the local store, the transaction queue and the server stay in step. The rule
behind this page is [local first](../../principles/local-first.md).

| Question                             | Answer                                               |
| ------------------------------------ | ---------------------------------------------------- |
| Where does a screen read?            | The local store                                      |
| Where does a write go first?         | The local store, then the transaction queue          |
| Who decides if a write stands?       | The server                                           |
| What happens when the server says no | The local store rolls back and the screen says why   |
| Which writes wait for the server?    | The server-confirmed writes below                    |
| What happens on a 401 or a 403?      | The client deletes the local store and opens sign-in |
| How do updates reach the client?     | The sync engine pushes deltas to the local store     |

## Sync engine

<!-- kickoff: The sync engine (vendor or own code), the service that owns it, the device storage it uses, and its local test runtime. -->

## Rules

- A screen reads the local store. A test that renders a screen with a warm
  store sees no network request before the data paints.
- A command changes the local store in the same frame as the user action.
- Each transaction in the queue has an ID. The server applies a transaction
  once, also when the client sends it again.
- A rejected transaction rolls back its local change and shows an error on the
  record it changed.
- The queue survives a reload. A transaction made offline goes to the server
  when the device is online again.
- The local store records the schema version it came from. A store with an
  unknown version is deleted and synced again. See
  [two-way and one-way doors](../../principles/two-way-doors.md#rules-for-stored-shapes).
- A delta changes the fields it names. Components that read other fields do not
  re-render.

## Server-confirmed writes

These writes wait for the server before the screen shows them as done. The
control that sent the write shows a pending state.

<!-- kickoff: One line for each write that waits for the server: what it does and why. Start from writes that move money, give consent, change access or touch a hard invariant. -->

## Conflicts

<!-- kickoff: How two edits to the same record merge, and which one wins. Field-level last write wins is the usual default. -->

## Add a command

1. Define the command once. The client applies it to the local store. The
   server applies it to the owner record and checks access.
2. Decide if it waits for the server. If yes, add it to the list above.
3. Write one test for the accepted path and one for the rejected path. The
   rejected path asserts the rollback.

## What to read when changing it

<!-- kickoff: The files that own the local store, the command definitions, the queue and the server handler. -->

- [Decision 0003: local-first sync for every client](../decisions/0003-local-first-sync-for-every-client.md)
- [Normalized source of truth](../../principles/normalized-source-of-truth.md#client-copies)
- [Authorization](./authorization.md)
- [Client performance](./client-performance.md)

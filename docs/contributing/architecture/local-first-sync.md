# Local-first sync

How the client store, the mutation queue and the server stay in step. The rule
behind this page is [local first](../../principles/local-first.md).

| Question                             | Answer                                                    |
| ------------------------------------ | --------------------------------------------------------- |
| Where does a screen read?            | The local store                                           |
| Where does a write go first?         | The local store, then the mutation queue                  |
| Who decides if a write stands?       | The server                                                |
| What happens when the server says no | The store rolls back the write and the screen says why    |
| Which writes wait for the server?    | The server-confirmed writes below                         |
| What happens on a 401 or a 403?      | The client deletes the local store and opens sign-in      |
| How do updates reach the client?     | The sync engine pushes deltas, and the store applies them |

## Sync engine

<!-- kickoff: The sync engine (vendor or own code), the service that owns it, the device storage it uses, and its local test runtime. -->

## Rules

- A screen reads the local store. A test that renders a screen with a warm
  store sees no network request before the data paints.
- A mutation changes the local store in the same frame as the user action.
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

## Add a mutation

1. Define the mutation once. The client applies it to the local store. The
   server applies it to the owner record and checks access.
2. Decide if it waits for the server. If yes, add it to the list above.
3. Write one test for the accepted path and one for the rejected path. The
   rejected path asserts the rollback.

## What to read when changing it

<!-- kickoff: The files that own the local store, the mutation definitions, the queue and the server handler. -->

- [Normalized source of truth](../../principles/normalized-source-of-truth.md#client-copies)
- [Authorization](./authorization.md)
- [Client performance](./client-performance.md)

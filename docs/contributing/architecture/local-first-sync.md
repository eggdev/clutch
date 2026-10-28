# Local-first sync

How the object pool, the local database, the transaction queue and the server
stay in step. The rule behind this page is
[local first](../../principles/local-first.md). `packages/sync` holds the
whole engine.

| Question                              | Answer                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------- |
| Where does a screen read?             | The object pool, through `useRecords`                                  |
| How does a screen write?              | It calls a command through `useCommand`. It never starts a request.    |
| What does a write change first?       | The object pool, in the same frame. The transaction goes to the queue. |
| What does the local database hold?    | The confirmed records, the last sync ID and the waiting transactions   |
| Who decides if a write stands?        | The server change of the command                                       |
| How does the client learn the answer? | The delta for its transaction arrives on the socket                    |
| What happens when the server says no? | The object pool drops the local change, and the screen says why        |
| How do conflicts resolve?             | Last writer wins, in server order                                      |
| What ends a session?                  | The server closes the user's sockets with code 4401                    |

## Sync engine

The engine is our own code, not a vendor.

| Part           | File                                                                              | Runs on                       |
| -------------- | --------------------------------------------------------------------------------- | ----------------------------- |
| Object pool    | `packages/sync/runtime/pool.ts`                                                   | Client                        |
| Local database | `packages/sync/types/local-database.ts` (the seam), `runtime/indexed-db.ts` (web) | Client                        |
| Boot           | `packages/sync/runtime/boot.ts`                                                   | Client                        |
| Transport      | `packages/sync/runtime/transport.ts`                                              | Client, after the first paint |
| React bindings | `packages/sync/ui/sync-provider.tsx`                                              | Client                        |
| Protocol       | `packages/sync/types/protocol.ts`                                                 | Both                          |
| Event log      | `packages/sync/service/event-log.ts`, `packages/sync/repo/events.ts`              | Server                        |
| RPC server     | `packages/sync/runtime/server.server.ts`                                          | Server                        |
| Sessions       | `packages/sync/service/sessions.ts`                                               | Server                        |

The protocol has two calls over one WebSocket for each organization, through
`effect/rpc`:

- `Push` sends a batch of transactions and returns one outcome for each.
- `Pull` sends the deltas after the client's last sync ID, then each live
  delta. It fails with `SessionEnded` when the session ends. It fails with
  `ServerBehind` when the client's last sync ID is above the server's newest
  event.

Records travel as plain JSON objects. The wire form and the stored form are
the same, so loading the local database needs no decode.

## The flow of a write

1. A screen calls a command. Its local change runs on the object pool at once.
2. The transaction goes to the transaction queue. The pool writes its state,
   queue included, to the local database.
3. The transport sends the unsent transactions with `Push`, and retries with
   exponential backoff.
4. The server runs the server change. In one database transaction, it writes
   the owner records and appends one event to the log.
5. Appending an event locks the organization's row in `sync_counters`, so sync
   IDs only increase and have no gaps.
6. After the commit, the server publishes the delta to every open `Pull` of the
   organization. The sender gets it too.
7. The client applies the delta to its confirmed records, then applies each
   pending local change again on top. This is the rebase.
8. A rejected transaction leaves the queue, and the object pool drops its
   local change. `useLastRejection` gives the screen the reason.

## Rules

- A screen reads the object pool. `renderWarm` in `packages/sync/testing/`
  renders a screen with a warm pool and fails on any network call.
- A local change runs in the same frame as the user action.
- Each transaction has an ID. The server applies a transaction once, also when
  the client sends it again.
- The queue survives a reload. A transaction made offline goes to the server
  when the socket opens again.
- Only the sync package uses the network or device storage on the client. The
  [client lint rules](../setup/lint-rules.md#client-code) reject the others.
- The transport and its Effect code load after the first paint. The first
  screen holds no Effect code, and `check-bundle` proves it.
- A page with no paint still connects. A page that loads hidden connects at
  once. A background tab gets no frame callback, so it connects after 500 ms.
  Without this limit, it misses live deltas until a person opens it.
- One `Pull` element holds at most 1,000 deltas, so one decode stays short.
- Every client of an organization receives every event of that organization.
  The organization is the only sync group.
- A sign-out calls `Sessions.end` with the user. Each of the user's sockets
  closes with code 4401, and the client clears its local database.
- After a database restore, the server's log can end before a client's last
  sync ID. `Pull` then fails with `ServerBehind`. The client drops its
  confirmed records and sets its last sync ID to 0. It keeps its pending
  transactions, sends them again, and pulls again from 0.

## Server-confirmed writes

A command with `waits: 'server'` does not change the object pool before the
server confirms it. The screen shows a pending state on the control that sent
it. `check-commands` rejects a command without `waits`.

<!-- kickoff: One line for each command that waits for the server: what it does and why. Start from writes that move money, give consent, change access or touch a hard invariant. -->

## Add a command

1. Run `mise exec -- bun nx g @tools/generators:command <package> <name>
   --model=<model> --waits=local`. It writes `<name>.ts` and
   `<name>.server.ts`, and registers both halves.
2. Write the local change in `<name>.ts`, in plain TypeScript.
3. Write the server change in `<name>.server.ts`, in Effect. It checks access
   and returns the changes it wrote.
4. Write one test for the accepted path and one for the rejected path, through
   the Test Layers. See `packages/notes/commands/notes-commands.test.ts`.

## What to read when changing it

- `packages/sync/runtime/pool.ts` and `packages/sync/service/event-log.ts`
- [Server](./server.md) and [client](./client.md)
- [Normalized source of truth](../../principles/normalized-source-of-truth.md#client-copies)
- [Authorization](./authorization.md)
- [Client performance](./client-performance.md)

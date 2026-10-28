# 0003: Local-first sync for every client app

- **Status:** accepted
- **Date:** 2026-10-28

## Context

[Local first](../../principles/local-first.md) says that a user action never
waits on the network. [Local-first sync](../architecture/local-first-sync.md)
leaves the sync engine, the device storage and the conflict rule to kickoff.
Agents fill a gap like that with a request in a component.

## Decision

Every client app uses one sync model, in the style of Linear.

1. A screen reads the object pool and calls a command. It never starts a
   request.
2. A local change updates the object pool at once. The transaction goes to
   the transaction queue. The local database keeps a copy of the queue.
3. The sync engine sends the queue to the server in batches.
4. The server writes events to an append-only log. Each event gets a sync ID
   that only increases. Each client stores the last sync ID that it applied.
5. The server pushes a delta to each client in the sync group of the event.
   The sender gets its delta before the answer.
6. The client applies the delta to the local database and the object pool,
   then rebases the pending transactions.
7. A rejected transaction rolls back its local change.

Conflicts resolve as last writer wins, in server order. The local database is
IndexedDB on web and SQLite on native. Only `packages/sync` uses the network.
It uses `effect/rpc`, with one socket for each organization. Sign-out closes
the sockets with code 4401.

A result that the server computes, such as a report, is a projection. The
client keeps it as a disposable copy with a required `staleAfter` value. An
analytics project uses the same model, with more projections.

The event log is our own code. It copies these patterns from the Effect
`eventlog` module: a locked counter row for each organization, a publish after
commit, the backlog before live events, and idempotent acknowledgements. The
module itself does not fit. It does not send a change to its sender, and it
orders conflicts by client clocks.

## Consequences

- The screen never waits on the network, and a warm screen makes no request.
- `no-restricted-globals` and `no-restricted-properties` reject `fetch`,
  `WebSocket`, `XMLHttpRequest`, `EventSource`, `indexedDB`, `localStorage`
  and `sessionStorage` outside `packages/sync`. A test showed that oxlint
  catches each form, `globalThis.fetch` too.
- Screens get a read-only type for the object pool. Only a local change gets a
  writable one.
- Data-fetching libraries, such as TanStack Query, are not allowed in UI code.
- The template must ship the sync engine, so each project does not write one.
- When this record is built, the sync page and the glossary replace "local
  store" with the object pool and the local database.

**Revisit if:** the reconnect query for one organization takes more than one
second at p95. Then add a serving index next to the log.

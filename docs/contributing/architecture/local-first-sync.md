# Local-first sync

How the object pool, the local database, the transaction queue and the server
stay in step. The rule behind this page is
[local first](../../principles/local-first.md). `packages/sync` holds the
whole engine.

| Question                              | Answer                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Where does a screen read?             | The object pool, through `useRecordIds` and `useRecord`                                                   |
| How does a screen write?              | It calls a command through `useCommand`. It never starts a request.                                       |
| What does a write change first?       | The object pool, in the same frame. The transaction goes to the queue.                                    |
| What does the local database hold?    | The confirmed records with their groups, the last sync ID, the loaded groups and the waiting transactions |
| Who decides if a write stands?        | The server change of the command                                                                          |
| Which clients get a change?           | Each client that loaded one of the change's sync groups                                                   |
| How does the client learn the answer? | The delta for its transaction arrives on the socket                                                       |
| What happens when the server says no? | The object pool drops the local change, and the screen says why                                           |
| How do conflicts resolve?             | Last writer wins, in server order                                                                         |
| What ends a session?                  | The server closes the user's sockets with code 4401                                                       |

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
| Contract       | `packages/sync/contract/`: the fields, groups, records, commands and manifest     | Both                          |
| Event log      | `packages/sync/service/event-log.ts`, `packages/sync/repo/events.ts`              | Server                        |
| Feed           | `packages/sync/service/feed.ts`: the messages of one connection                   | Server                        |
| Group seam     | `packages/sync/service/sync-groups.ts`, filled by `packages/access`               | Server                        |
| RPC server     | `packages/sync/runtime/server.server.ts`                                          | Server                        |
| Sessions       | `packages/sync/service/sessions.ts`                                               | Server                        |

The protocol has three calls over one WebSocket for each organization, through
`effect/rpc`:

- `Push` sends a batch of transactions and returns one outcome for each
  write that the server tried. When the database does not answer, the list
  ends at that write. The client keeps each write with no outcome and sends
  it again. `packages/sync/runtime/transport.test.ts` holds this.
- `Pull` names the groups that the client loaded before. It streams a `Groups`
  message first, then the deltas after the client's last sync ID, then each
  live delta. Each delta holds only the changes of the loaded groups.
- `Load` asks the open `Pull` to load one more group. It fails with
  `GroupNotAllowed` when the actor may not load the group.

`Pull` fails with `SessionEnded` when the session ends. It fails with
`ServerBehind` when the client's last sync ID is above the server's newest
event.

`Pull` also sends the digest of the app's contracts. See
[the manifest and the digest](./contract.md#manifest-and-digest).

Records travel as plain JSON objects. The wire form and the stored form are
the same, so loading the local database needs no decode.

## The flow of a write

1. A screen calls a command with its input, and no ID or time. The pool fills
   each stamp, then runs the local change at once.
2. The transaction goes to the transaction queue. The pool writes its state,
   queue included, to the local database.
3. The transport sends the unsent transactions with `Push`. A failed push
   tries again after 200 ms, then twice as long each time, up to 3 seconds.
4. The server checks the input against its fields, then the access rule. Then
   it runs the server change. In one database transaction, it writes the owner
   records and appends one event to the log.
5. Appending an event locks the organization's row in `sync_counters`, so sync
   IDs only increase and have no gaps.
6. After the commit, the server publishes the delta to every open `Pull` of the
   organization. Each `Pull` sends only the changes of its loaded groups. The
   sender gets its delta too.
7. The client applies the delta to its confirmed records, then applies each
   pending local change again on top. This is the rebase.
8. A rejected transaction leaves the queue, and the object pool drops its
   local change. `usePendingCommand` gives the refused code and the reason of
   a run. `useLastRejection` gives the last rejection of the pool.

## Rules

- A screen reads the object pool. `renderWarm` in `packages/sync/testing/`
  renders a screen with a warm pool and fails on any network call.
- A local change runs in the same frame as the user action.
- Only the object pool reads the clock and makes IDs on the client. The lint
  rule `repo-determinism/no-ambient-time` rejects `Date.now()` and the other
  clock and random calls in client code outside `packages/sync`.
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
- A sign-out calls `Sessions.end` with the user. Each of the user's sockets
  closes with code 4401, and the client clears its local database.
- After a database restore, the server's log can end before a client's last
  sync ID. `Pull` then fails with `ServerBehind`. The client drops its
  confirmed records and sets its last sync ID to 0. It keeps its pending
  transactions, sends them again, and pulls again from 0.

## Sync groups

A sync group decides which clients get a change. Each record names its groups
in `groups`.

```ts
export const noteRecord = record('Note', {
  fields: {
    id: 'string',
    spaceId: 'string',
    title: 'string',
    createdAt: 'string',
    updatedAt: 'string',
  },
  groups: [spaceGroup.by('spaceId')],
});
```

`record()` takes the kind of each field from `fields`, and the record type
comes from them, so the two cannot drift. The object pool checks each copy
where it enters. A saved copy is checked when the pool loads. A record from
a server delta is checked when it arrives. A command that the app runs is
checked before it is queued. Past those checks, the pool trusts the copy.
A command declares the shape of its `input` the same way. A saved
transaction whose input does not match is refused when the pool loads.
Product code asserts no types, so these shapes replace each `as` cast. See
[the field kinds](./contract.md#field-kinds) and
[older copies recover](../../principles/older-copies-recover.md).

- A server change builds each change with `upsertChange` or `deleteChange`
  from `packages/sync/contract/change.ts`. Each takes the record declaration,
  the record and the organization, and it adds the groups of the record.
- The event log stores the groups of all changes of an event in an array
  column. A GIN index covers it. A change with no group fails the commit.
- `SyncGroups.groupsFor(actor)` names the groups that an actor may load.
  `packages/access` fills it. See [authorization](./authorization.md).
- A client loads each `eager` group when it connects: its organization and its
  user. It loads a `lazy` group, such as one space, only when a gate asks.
- A record may be in more than one group. A client keeps it while it has
  loaded one of them.

When a change lands in a user's own group, such as a membership, the server
asks access again. Each group that the actor lost leaves the loaded set. The
client then deletes each record that is in no loaded group, at once. The next
save removes them from the local database too.

## Load functions

A load function says how a screen asks for the records of one group. A
contract declares it with `load()`.

```ts
export const notesOf = load('notes/of-space', noteRecord, spaceGroup);
```

A gate calls it through `useLoad` before it navigates:

```ts
await open.load(notesOf, spaceId);
open.navigate(`/notes?space=${encodeURIComponent(spaceId)}`);
```

- A loaded group resolves at once, offline too.
- Otherwise, the engine sends `Load`. The server sends the group's past
  changes as a backfill, and the gate resumes when they are in the pool.
- A record that already holds a later change keeps it. The backfill never
  undoes a later change.
- After 3 seconds, or offline, the gate stops waiting and opens the screen
  with what the pool has.
- When the server refuses the group, the gate stops waiting at once. The pool
  reports one sentence that names the group, and does not ask again.

## Server-confirmed writes

A command with `waits: 'server'` does not change the object pool before the
server confirms it. The screen shows a pending state on the control that sent
it. `command()` requires `waits`, so a command without it does not compile.

<!-- kickoff: One line for each command that waits for the server: what it does and why. Start from writes that move money, give consent, change access or touch a hard invariant. -->

## Server data on a screen

Some data comes from the server, not from a person: a count over many rows,
or a result from a vendor. A screen never fetches it, and never computes it
from a large list. The pattern:

1. The contract declares the record, such as `spaceNoteCountRecord`.
2. A job or a server change computes the value on the server, then commits
   the record. See [jobs and the outbox](./server.md#jobs-and-the-outbox).
3. The record reaches each client of its sync group as a delta.
4. The screen reads it with `useRecord` or `useRecordIds`, like any record.

Put the record in the group of the records that it describes when every
reader loads that group anyway. Give it its own group when a reader must not
load the other records. For example, a dashboard that shows counts must not
pull every note.

`packages/notes/jobs/count-notes.ts` and the count in the notes screen header
show the pattern. The count is `undefined` until the first one arrives, so the
screen shows nothing in its place.

## Add a command

1. Run `mise exec -- bun nx g @tools/generators:command <package> <name>
   --record=<record> --waits=local --access=group`. It declares the command in
   the contract, writes `<name>.ts` and `<name>.server.ts`, and registers both
   halves. See [commands](./contract.md#commands).
2. For `waits: 'local'`, write the local change in `<name>.ts` with
   `localChange`, in plain TypeScript.
3. Write the server change in `<name>.server.ts` with `serverChange`, in
   Effect. The access check of `access` runs first, so `run` only writes and
   returns the changes it wrote. See
   [one door for each write](./authorization.md#one-door-for-each-write).
4. Write one test for the accepted path and one for the rejected path, through
   the Test Layers. See `packages/notes/commands/notes-commands.test.ts`.

## What to read when changing it

- `packages/sync/runtime/pool.ts`, `packages/sync/service/event-log.ts` and
  `packages/sync/service/feed.ts`
- [Server](./server.md) and [client](./client.md)
- [Normalized source of truth](../../principles/normalized-source-of-truth.md#client-copies)
- [Authorization](./authorization.md)
- [Client performance](./client-performance.md)

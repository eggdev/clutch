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
| What does the local database hold?    | The confirmed records with their groups, the sync position, the waiting transactions and their actor      |
| Who decides if a write stands?        | The server change of the command                                                                          |
| Which clients get a change?           | Each client that loaded one of the change's sync groups                                                   |
| How does the client learn the answer? | The delta for its transaction arrives on the socket                                                       |
| What happens when the server says no? | The object pool drops the local change, and the screen says why                                           |
| How do conflicts resolve?             | Last writer wins, in server order                                                                         |
| What ends a session?                  | The server closes the user's sockets with code 4401, or the person signs out on the device, even offline. |

## Sync engine

The engine is our own code, not a vendor.

| Part           | File                                                                              | Runs on                       |
| -------------- | --------------------------------------------------------------------------------- | ----------------------------- |
| Object pool    | `packages/sync/runtime/pool.ts`, `runtime/confirmed.ts` (the confirmed records)   | Client                        |
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
| Wake           | `packages/sync/service/wake.ts`, `packages/sync/runtime/wake.server.ts`           | Server                        |

The protocol has three calls over one WebSocket for each organization, through
`effect/rpc`:

- `Push` sends a batch of at most 100 transactions and returns one outcome
  for each write that the server tried. A longer queue goes in more pushes,
  in order, one straight after the other. When the database does not answer, the list
  ends at that write. The client keeps each write with no outcome and sends
  it again. `packages/sync/runtime/transport.test.ts` holds this.
- `Pull` names the groups that the client loaded before. It streams a `Groups`
  message first, then the deltas after the client's last sync ID, then each
  live delta. The first `Groups` message names the actor of the connection:
  its user and its organization. Each delta holds only the changes of the
  loaded groups, and a delete of each record that left them.
  A client past sync ID 0 that does not name an eager group lacks its
  records. The first `Groups` message then holds the snapshot of that group.
  With `pages`, `Page` messages come before it.
- A client at sync ID 0 holds nothing. Its `Pull` sends the snapshot of each
  loaded group in place of the deltas. Then it sends one delta with no changes
  at the head of the log. That delta moves the client's last sync ID to the head, so
  its next `Pull` asks only for the events after it.
- `Load` asks the open `Pull` to load one more group. It fails with
  `GroupNotAllowed` when the actor may not load the group. With `pages`, the
  client reads the snapshot in `Page` messages of at most 1,000 records. A
  `Groups` message that names the group then brings the last page. A build that
  does not send `pages` gets the whole snapshot in one `Groups` message.

A snapshot holds the last change of each live record of a group, from
`sync_records`, as a delta with the sync ID of that change. A deleted record
is not in it. A record that changed 1,000 times comes once, so a load costs
what the records cost, not what their history costs. The server reads the
snapshot in pages, in the order of the record keys. The `Pull` reads the head
of the log before the first page, and it sends each live delta after that
head. So a record that changes, leaves or enters the group between two pages
ends right: the pool keeps the change with the higher sync ID.
`packages/sync/service/feed-snapshot.test.ts` holds this.

`Pull` fails with `SessionEnded` when the session ends. It fails with
`ServerBehind` when the server cannot send each event after the client's last
sync ID. That happens when the last sync ID is above the server's newest
event, or below the oldest event that the log still holds, minus 1. In the
second case, the error names that oldest sync ID in `oldest`. A socket with
no session opens and closes at once with code 4401. See
[the end of a session](#the-end-of-a-session).

`Pull` also sends the digest of the app's contracts. See
[the manifest and the digest](./contract.md#manifest-and-digest).

Records travel as plain JSON objects. The wire form and the stored form are
the same, so loading the local database needs no decode.

## The flow of a write

1. A screen calls a command with its input, and no ID or time. The pool fills
   each stamp, then runs the local change at once.
2. The transaction goes to the transaction queue. The pool saves the row of
   the transaction to the local database. See
   [the local database](./client.md#local-database).
3. The transport sends the unsent transactions with `Push`. A failed push
   tries again after 200 ms, then twice as long each time, up to 3 seconds.
4. The server checks the input against its fields, then the access rule. Then
   it runs the server change. In one database transaction, it writes the owner
   records and appends one event to the log.
5. Appending an event locks the organization's row in `sync_counters`, so sync
   IDs only increase and have no gaps.
6. The same transaction wakes each other process of the server, so the wake
   goes out only when the commit holds. After the commit, the server wakes its
   own process too. In each process, one reader for each organization reads the
   new events from the log, in sync ID order. It hands them to every open `Pull`
   of the organization in that process. Each `Pull` sends only the changes of its loaded groups, and a
   delete of each record that left them. The sender gets its delta too.
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
- After a socket drops, it opens again, and the engine pulls again. The new
  `Pull` names the last sync ID and the loaded groups of the pool, so the
  client gets each change that it missed. A group that a gate asked for and
  that is not loaded yet is asked for again.
  `packages/sync/runtime/transport.test.ts` holds this.
- An ended session stops the engine: the 4401 close, or a `Pull` that fails
  with `SessionEnded`. The engine tells the app once. It then pulls and pushes
  no more, also when its socket could open again.
- When a save to the local database fails, such as on a full device, the pool
  reports one sentence, and the next change saves again.
- Only the sync package uses the network or device storage on the client. The
  [client lint rules](../setup/lint-rules.md#client-code) reject the others.
- The transport and its Effect code load after the first paint. The first
  screen holds no Effect code, and `check-bundle` proves it.
- A page with no paint still connects. A page that loads hidden connects at
  once. A background tab gets no frame callback, so it connects after 500 ms.
  Without this limit, it misses live deltas until a person opens it.
- One `Pull` element holds at most 1,000 deltas, so one decode stays short.
  A page of a snapshot holds at most 1,000 records.
- A sign-out calls `Sessions.end` with the user. Each of the user's sockets
  closes with code 4401, in each process of the server, and the client clears
  its local database. See [the end of a session](#the-end-of-a-session).
- After a database restore, the server's log can end before a client's last
  sync ID. After a trim, the log can start after it. `Pull` then fails with
  `ServerBehind`. The client drops its confirmed records and sets its last
  sync ID to 0. It keeps its pending transactions, sends them again, and
  pulls again from 0. `apps/api/src/trimmed-log.test.ts` holds this.
- The server decides when a client must load again. A saved copy has no age
  limit on the client. A copy older than the kept log gets `ServerBehind`.

## The size of the log

The log keeps every event by default. How long to keep them is the owner's
decision. Set `SYNC_LOG_KEEP_DAYS` to a whole number of days, and the hourly
job `sync/trim-log` trims the log of each organization:

- It deletes each event up to the newest one older than that many days. So the
  log keeps one run of sync IDs with no gap.
- It keeps the newest event of each organization, so the head stays right.
- It deletes each record of `sync_records` that is marked deleted, and whose
  delete is older than the oldest event kept.

With `SYNC_LOG_KEEP_DAYS` set to D, an organization that writes W events a day
keeps about D × W events, and at least one. A load reads `sync_records`, so a
trim never changes what a new client gets. A client that was away for longer
than D days loads again from 0. The `Pull` checks the oldest event again after
the backlog. So a trim that runs during a `Pull` cannot drop an event that the
client did not get.

## The end of a session

One person never sees or sends the saved work of another person on the same
device. Four rules hold this.

- The saved copy holds its actor. The position row of the local database
  holds the user and the organization that the copy belongs to. A copy from
  before this rule has none, and takes the actor of the first `Groups`
  message that names one. The local database keeps the name `app`: a browser
  cannot know its user before the server answers.
- The engine sends no `Push` on a connection before the first `Groups`
  message of its pull confirmed the actor. When that message names another
  actor, the pool drops the confirmed records, the loaded groups, the
  position and each waiting transaction. It reports one sentence, and the
  engine pulls again from 0 as the new actor. The same user in another
  organization is another actor, because sync IDs belong to one
  organization. A server that names no actor opens the gate too, and the
  copy stays. `packages/sync/runtime/transport-actor.test.ts` and
  `pool-actor.test.ts` hold this.
- A client that was offline when its session ended learns it when it
  connects. An `Actors` layer that finds no session dies with `SessionEnded`.
  The sync server then accepts the upgrade of the socket and closes it at
  once with code 4401. A browser cannot read the status of a refused
  upgrade, but it reads the close code. Each other failure of `Actors` stays a server fault, and the
  client keeps its local database. `apps/api/src/sessions.test.ts` holds
  this.
- An ended session stops the saves before the local database clears.
  `endSession` in `packages/sync/runtime/boot.ts` stops the engine, stops the
  saves of the pool and lets a save that runs finish, then clears the
  database. It needs no server. After it, no change of the old pool reaches
  the database, also on native, where no page loads again.
  `packages/sync/runtime/boot-session.test.ts` holds this.

`endSessionOnDevice` in `apps/app/lib/boot.ts` calls `endSession`, then starts
the app again with an empty pool. The app calls it on a 4401 close and on a
`Pull` that fails with `SessionEnded`. A project's sign-out screen calls it
after its identity vendor signs out, also offline.

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
- The event log keeps the last state of each record in `sync_records`: its
  groups, its last change and its data. A commit updates it in the
  transaction of the event. A change then names in `left` the groups that its
  record left, and the event is indexed under them too. Each snapshot reads
  this table.
- One function, `seenDelta` in `packages/sync/service/visible.ts`, decides
  what a connection sees, for the backlog and the live stream.
  A change in a loaded group comes as it is. A change of a record that left
  each loaded group comes as a delete with no data. `left` never leaves the
  server.
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
- Otherwise, the engine sends `Load`. The server sends the snapshot of the
  group, in pages, and the gate resumes after the last page. The server reads
  each page with its own query, so it never holds every record of a group.
- The pool applies the records of each page at once. The group is not loaded
  until its `Groups` message. No purge deletes the records of a group whose
  pages have come, until it loads or the server refuses it. A client that
  drops between two pages does not name the group in its next `Pull`, and
  the gate asks for the whole group again.
- A record that already holds a later change keeps it. The snapshot never
  undoes a later change.
- A deleted record stays deleted. The pool keeps the sync ID of the delete,
  and saves it, so an older upsert in a backfill does not bring the record
  back. The pool forgets these sync IDs only when it drops its confirmed
  records. `packages/sync/runtime/pool-groups.test.ts` holds this.
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

- `packages/sync/runtime/pool.ts`, `packages/sync/runtime/confirmed.ts`,
  `packages/sync/service/event-log.ts` and
  `packages/sync/service/feed.ts`
- [Server](./server.md) and [client](./client.md)
- [Normalized source of truth](../../principles/normalized-source-of-truth.md#client-copies)
- [Authorization](./authorization.md)
- [Client performance](./client-performance.md)

# Client

How client code is written. Client code runs in the browser or on a device:
`apps/app`, `features/`, and the `ui/`, `contract/` and client `commands/` of
each package.

| Question                                | Answer                                                  |
| --------------------------------------- | ------------------------------------------------------- |
| Which framework?                        | React 19, with React Compiler                           |
| Which profile ships in the template?    | One with Expo and React Native, in `apps/app`           |
| Where does a screen read?               | The object pool, through `useRecordIds` and `useRecord` |
| How does a screen write?                | `useCommand` with a command. Never a request.           |
| Which IDs and times does a screen pass? | None. The object pool fills each stamp of a command.    |
| Where can `useEffect` run?              | Only in `packages/sync/ui/`                             |
| How does a route open?                  | Through the feature's gate                              |
| How does client code use the contract?  | As plain TypeScript. Effect only through `import type`. |
| Where do the shared parts live?         | `packages/design-system/ui/`                            |

## React core

The React core is the same in every profile:

- React Compiler memoizes components. `apps/app/vite.config.ts` turns it on
  with `react: { compiler: true }`.
- The Ultracite React preset runs on client code, with the React Compiler
  rules as errors. A component is a function declaration.
- A hook reads the object pool through `useSyncExternalStore`, in
  `packages/sync/ui/sync-provider.tsx`. Each snapshot stays the same object
  until its data changes, so the compiler never holds an old value.

## Reading records

A change re-renders only the components that show it. Two hooks make this
work:

- `useRecordIds(model, order)` gives a list its IDs. The list re-renders only
  when a record is added or removed, or when the order changes.
- `useRecord(model, id)` gives a row its record. The row re-renders only when
  that record changes.

A list maps its IDs to rows, and each row reads its own record. Wrap a row in
`memo`, and give it only stable props, such as its ID. A list rebuilds its row
elements when a record is added or moved, and `memo` keeps the other rows from
rendering again. `features/notes/components/note-row.tsx` shows the pattern.

The pool keeps each record that did not change as the same object. It wakes
only the watchers of the models and records that changed. A test that counts
renders is in `packages/sync/ui/sync-provider.test.tsx`.

A change costs what it changed, not what the pool holds. The confirmed
records name the records that a delta or a purge changed. The waiting
changes write over the confirmed records, into a small set of writes. The
pool then compares only those records and the ones that the waiting changes
wrote the time before. A load or a reset of the confirmed records compares
every record once. With 100,000 records, one local edit or a delta of 3
records takes well under a millisecond. `packages/sync/runtime/pool-change-cost.test.ts`
holds this.

An ID list follows what changed too. When a screen reads it after a change,
it takes out the IDs of the changed records. Then it puts back each one that
still matches its filter, at its place by the sort key, with a binary search.
A change to many records sorts the list again. The list keeps the same array
when its IDs did not change, and gives a new array when they did.
`packages/sync/runtime/pool-sorted-ids.test.ts` holds this.

## Pending writes

A command with `waits: 'server'` shows a pending state on the control that
sent it. The rest of the screen stays live.

- `usePendingCommand(command)` returns `run`, `pending` and `refused`. `pending`
  is true while the last run waits for its delta or its refusal.
- `refused` holds the code and the reason of a refused run. Its `code` is one
  of the command's `refuses` codes or a built-in code. A code that the
  installed build does not know reads as `failed`.
- `usePending(transactionId)` reads one transaction. A component re-renders
  only when that transaction starts or stops waiting.
- `useLastRejection()` gives the last refusal of the whole pool, with its
  `command`, `code` and `reason`. A screen uses it for one message.

A screen passes no ID and no time. `rename({ id, title })` and
`create({ spaceId, title })` are the whole call. The object pool fills each
stamp when the command runs.

`features/notes/components/space-row.tsx` disables Join and Leave and changes
their labels while they wait.

## No effects outside the sync package

`useEffect`, `useLayoutEffect` and `useInsertionEffect` fail lint everywhere
except `packages/sync/ui/`. Use the tool that fits instead:

| You want to                        | Use                                                       |
| ---------------------------------- | --------------------------------------------------------- |
| Show a value computed from records | Derive it in render                                       |
| Respond to a click or a submit     | An event handler                                          |
| Read records                       | `useRecordIds` and `useRecord`                            |
| Write records                      | `useCommand`, or `usePendingCommand` for a server wait    |
| Load what a screen needs           | The feature's gate, through a load function and `useLoad` |

The ban covers aliased imports, namespace imports and `React.useEffect`. See
[lint rules for client code](../setup/lint-rules.md#client-code).

## No network outside the sync package

Client code never calls `fetch`, `WebSocket`, `XMLHttpRequest`, `EventSource`,
`navigator.sendBeacon`, `indexedDB`, `localStorage` or `sessionStorage`. Only
`packages/sync` does. A screen reads the object pool and calls a command. See
[local-first sync](./local-first-sync.md).

## The contract on the client

Client code reads a package's `contract/`. It holds the records, the commands
and the load functions as plain TypeScript, with no Effect, Drizzle or React
import. Client code imports `effect` only with `import type`. A value import
would put Effect code in the first screen. A constant that the UI needs, such
as a length limit, lives in `contract/`. See `maxTitleLength` in
`packages/notes/contract/notes.ts`.

## Routes and gates

- One's file routing makes each file under `apps/app/app/` a route. A route
  file default-exports a component that renders a feature's screen, as
  `apps/app/app/notes.tsx` does.
- A route has no loader. A feature's gate settles its needs, then navigates
  once. See [one gate into each feature](../../principles/one-gate-per-feature.md).
- The `one-gate` lint rule rejects a navigation to a gated route from any file
  other than its gate.

## Profiles

Kickoff picks one profile for each client app. The React core stays the same.
A profile changes only the routing, the paths that generators write to, and
the subscriptions that the sync hooks wrap.

| Platform          | Profile                        | In the template |
| ----------------- | ------------------------------ | --------------- |
| Web, iOS, Android | One with Expo and React Native | `apps/app`      |
| Web               | Vite with TanStack Router      | No              |
| Web               | Next.js                        | No              |

One is the usual choice for native. A project with no client deletes
`apps/app`, `features/` and the React language entry at kickoff.

## Local database

The sync engine keeps its state on the device through one seam,
`LocalDatabase` in `packages/sync/types/local-database.ts`. It keeps three
kinds of rows: one for each confirmed record, one for each waiting
transaction, and one for the sync position. A deleted record keeps a row
with no record, so the pool remembers the sync ID of the delete. The sync position is the last
sync ID, the loaded groups, `leftOutBy` and the actor that the copy belongs
to. `read` joins the rows into one state. `save` writes one change in one database transaction. `clear` removes
every row, and writes a new generation of the database. See
[the end of a session](#the-end-of-a-session).

A save holds the records that changed since the last save, the records that
were deleted, and the sync position. So one delta writes only the records
that it changed. After the pool drops its confirmed records, or after a save
fails, the next save replaces every record. See
[a device that cannot save](#a-device-that-cannot-save).

A save writes no record that is in no loaded group, such as a record of a
page whose group is still loading. It removes the row of such a record, and
writes the record once its group loads. So the device never keeps part of a
load that was cut off. See
[load functions](./local-first-sync.md#load-functions).

### A device that cannot save

The waiting transactions are what a device must never lose. The confirmed
records are a cache of the server. `loadPool` in
`packages/sync/runtime/boot.ts` holds this rule:

- A save that fails is reported once. The next attempt waits 200 ms, then
  twice as long each time, up to 10 seconds. A change while it waits starts
  no other attempt: the next attempt saves the newest state. A save that works ends the run of failures. So a single failure costs one wait, and the save after it works.
- A save that fails with a full device, or the third save that fails in a
  row, makes room. `makeRoom` drops every confirmed record and sets the saved
  position to sync ID 0 in one database transaction. It keeps each waiting
  transaction, the actor, the generation and the mark of a session end.
- When that cannot be written either, the IndexedDB adapter deletes the
  database, creates it again, and writes the waiting transactions into it.
  Between the delete and the write, a copy of them waits in `localStorage`
  under a key of its own that starts with `local-database:<name>:rescue:`.
  The next open writes the copy back when the write did not happen. Each
  other tab lets the old database go before the delete, and keeps its own
  queue in a copy too, as [a lost database](#older-layouts) does. The SQLite file holds other names too,
  so the SQLite adapter deletes the records in small steps instead. It first commits the emptied position and the count of the room made. So a delete that stops part way leaves sync ID 0 with some records. The next start
  loads again from 0, and the first `Groups` message of that pull drops each
  record that the pull did not send. It never touches the waiting rows.
- After it makes room, the pool saves only its waiting transactions for the
  rest of the session, so it cannot fill the device again. The records in
  memory stay, and the screen keeps working. The pool reports one sentence
  that says what happened and that nothing the person did is lost.
- Any tab can make room, also a tab that does not write the confirmed
  records. So `makeRoom` also raises a count of the room made, in the same
  database transaction. Each handle reads the count when it opens, and each
  save compares it in its own database transaction. When the count changed,
  the save writes only its waiting rows, with no record and no position. So
  no tab writes a position above 0 over the emptied records before the next
  start. A clear sets the count back, with the new generation.
- At the next start, the device holds its waiting transactions at sync ID 0.
  The pool loads again from the server and sends what waits.

`packages/sync/runtime/boot-room.test.ts` holds the rule, and the cases in
`packages/sync/testing/local-database-room-cases.ts` hold `makeRoom` for
each adapter. `packages/sync/runtime/indexed-db-loss.browser.test.ts` holds
the recreate of the IndexedDB database and the copy in `localStorage`.

### Two tabs

Each tab has its own pool. Two tabs can hold different groups and positions,
so only one tab writes the confirmed records and the sync position. On the
web, it is the tab that holds the Web Lock of the database name. When that
tab closes, the next tab gets the lock and writes its whole confirmed state
once. A browser with no Web Locks lets each tab write. A native app has one
process, so its pool always writes.

Each tab writes its own waiting transactions:

- A tab adds the row of a transaction when the person runs the command.
- A tab deletes the row when the transaction leaves its queue: its delta
  arrived, or the server refused it. A tab never deletes a row that it does
  not hold.
- At its start, a tab loads every waiting row, also the rows of another open
  tab, and sends them. The server applies a transaction once, so a second
  send is safe.
- No tab tells another tab about a new transaction. The other tab gets the
  change from the server.

`packages/sync/runtime/boot.test.ts` holds these rules.

### The end of a session

`loadPool` gives the pool a `stop`. It detaches the save listener and waits
for a save that runs, so no later change of the pool reaches the database.
`connectAfterPaint` returns the stop of the engine. `endSession` calls both,
then clears the database. `endSessionOnDevice` in `apps/app/lib/boot.ts`
calls it, then starts the app again: native starts it in place, and the web
loads the page again. A project's sign-out calls
`endSessionOnDevice`. The Web Lock stays with the page, so the next start in
the same page stays the writer. See
[the end of a session](./local-first-sync.md#the-end-of-a-session).

A saved copy of another actor is dropped when the server names the actor of
the connection. A position with an actor of another shape makes the read
unreadable, like any other position of another shape. Each waiting row holds
the actor that ran it, and a row of another actor is dropped and never sent.
A waiting row with an actor of another shape is left out of the read. A row
that is saved already keeps its place when a save writes it again, and takes
the new value. So a row that took the confirmed actor is written again with it.

`clear` leaves the mark of a session end, in the same database transaction.
It is the key `ended` of the IndexedDB store `position`, or a row of the
SQLite table `pool_ended`. A read gives it as `ended` while any other row is
there, until the first save of the next start spends it. So only the first
start after a session end drops the waiting rows with no actor. The first save
after a `Groups` message removes the mark, also when the server named no actor.
When the save names an actor, it also removes each waiting row with no actor
that it does not write. `markAfter` in `packages/sync/runtime/pool-doors.ts`
holds the rule for each adapter.

`clear` tells each other tab of the database on the device first. On the
web, it posts a message on a `BroadcastChannel` with the name of the
database. `onLost` wakes in each other tab, and `followLostDatabase` then
stops that tab's engine and saves and starts the app again.

The message can come late. A socket message of the other tab can start a
save after the clear and before the tab hears the message. So the local
database keeps a generation: a random value that each clear writes anew,
in the same database transaction. Each handle reads the generation when it
opens. `save` compares it in its own database transaction. When it differs,
the save writes nothing and gives `cleared`, and `onLost` wakes once. The
pool of that tab then never saves again, and the app starts again. So a late save never writes the records, the position or a waiting row of the person who left. The mark of the session end stays. A database from
before the generation gets one at its first open. The generation is the
key `generation` of the IndexedDB store `position`, or a row of the SQLite
table `pool_generation`. SQLite on native has one process, so only a
second handle, as in a test, finds another generation.

### Older layouts

Version 1 kept the whole state as one value. On the web, it was under the
key `state` in the IndexedDB store `pool`. On native, it was one JSON row in
the SQLite table `pool`. The open moves its waiting transactions into rows,
so no unsent work is lost. It moves the records and the position too when
each record names its groups. Otherwise it drops them, and the pool loads
again from the server.

A tab of an older build that holds the IndexedDB database open blocks this
move. The open then fails with a sentence that says to close that tab. A tab
closes its own handle when a newer build asks for a new version, so it never
blocks that build. The handle cannot save after that, so `onLost` wakes. `followLostDatabase` then stops the engine and the saves of the tab. It starts the app again, with no clear. On the web the page loads again at once, with the newer build,
and opens the new layout. It does not start the app in the old page first,
since the old build cannot open the newer layout.

A waiting transaction whose save had not started, or that waits after a
failed save, is only in the memory of the tab. So before the tab lets the
database go, and again before it starts again, `followLostDatabase` calls
`keep` with the whole queue of the tab. The IndexedDB adapter writes it to `localStorage`, under a key that starts with `local-database:<name>:rescue:`. Each handle has its own key, so two tabs never write over each other.
Each open writes back every copy, then removes each copy that no tab wrote
again. A row that the database holds already is not added again, so a crash
between the two adds no row twice. A copy of another generation is the work
of a session that ended, so the open drops it. The same happens in each
other tab when one tab deletes the database to make room.
`packages/sync/runtime/indexed-db-loss.browser.test.ts` and
`packages/sync/runtime/indexed-db-keep.browser.test.ts` hold this.

`openLocalDatabase` in `packages/sync/runtime/local-database.ts` opens IndexedDB
on the web. `packages/sync/runtime/local-database.native.ts` replaces it on a
device and opens SQLite through op-sqlite. The composition root,
`apps/app/lib/boot.ts`, calls it once.

| Adapter   | File                                      | Platform |
| --------- | ----------------------------------------- | -------- |
| IndexedDB | `packages/sync/runtime/indexed-db.ts`     | Web      |
| SQLite    | `packages/sync/runtime/sqlite.ts`         | A device |
| Memory    | `packages/sync/testing/local-database.ts` | Tests    |

The pool takes its ID source and its clock through `Stamps` in
`packages/sync/contract/fields.ts`. Its records and commands come from the
contracts of the app, and each copy is checked against them.

A copy that does not fit its contract is dropped or refused where it enters,
and the pool reports it in one sentence. The rules are in
[older copies recover](../../principles/older-copies-recover.md). The checks
are in `packages/sync/runtime/pool-doors.ts`.

The app tells the person too. `apps/app/lib/boot.ts` gives the pool a report
function, and its store keeps each sentence. The root layout shows a notice
while the list holds one, so a build that is older than its data is never
quiet.

A start that throws does not leave an empty page. The store in
`apps/app/lib/boot-store.ts` keeps the reason as one sentence, and the layout
shows it with a button that starts again. `apps/app/lib/boot-store.test.ts`
holds that rule.

The object pool has three files. `packages/sync/runtime/confirmed.ts` holds the
confirmed records: what the server sent, the groups and sync ID of each record,
and the loaded groups. `packages/sync/runtime/pool.ts` puts each waiting
transaction on top of them. `packages/sync/runtime/tables.ts` holds the
tables that screens see, with their ID lists and watchers.

The object pool is checked against a plain reference model in
`packages/sync/runtime/pool-conformance.test.ts`.

Both adapters pass the same cases. Each one runs every case in
`localDatabaseCases`, from `packages/sync/testing/local-database-conformance.ts`:
`packages/sync/runtime/indexed-db.browser.test.ts` for IndexedDB, and
`packages/sync/runtime/sqlite.test.ts` for SQLite. A new adapter runs the same
cases.

## Design system

`packages/design-system/ui/` holds the shared components, such as `Button` and
`TextField`, and `theme.css` holds the tokens. See [styling](./styling.md).

## What to read when changing it

- `apps/app/app/_layout+ssg.tsx`, `apps/app/app/notes.tsx` and `apps/app/lib/boot.ts`
- `packages/sync/ui/sync-provider.tsx`
- [Client performance](./client-performance.md)
- [Lint rules for client code](../setup/lint-rules.md#client-code)

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
`LocalDatabase` in `packages/sync/types/local-database.ts`. It has three
operations: `read`, `write` and `clear`. Each one takes or gives the whole
pool state: the confirmed records, the last sync ID and the transaction queue.

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

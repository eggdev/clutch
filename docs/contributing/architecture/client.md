# Client

How client code is written. Client code runs in the browser or on a device:
`apps/web`, `features/`, and the `ui/`, `models/` and client `commands/` of
each package.

| Question                             | Answer                                                          |
| ------------------------------------ | --------------------------------------------------------------- |
| Which framework?                     | React 19, with React Compiler                                   |
| Which profile ships in the template? | Vite with TanStack Router, in `apps/web`                        |
| Where does a screen read?            | The object pool, through `useRecords` or a package's `ui/` hook |
| How does a screen write?             | `useCommand` with a command. Never a request.                   |
| Where can `useEffect` run?           | Only in `packages/sync/ui/`                                     |
| How does a route open?               | Through the feature's gate                                      |
| How does client code use a schema?   | As a type only, through `import type`                           |
| Where do the shared parts live?      | `packages/design-system/ui/`                                    |

## React core

The React core is the same in every profile:

- React Compiler memoizes components. `apps/web/vite.config.ts` runs it
  through `@rolldown/plugin-babel` with `reactCompilerPreset()`.
- The Ultracite React preset runs on client code, with the React Compiler
  rules as errors. A component is a function declaration.
- A hook reads the object pool through `useSyncExternalStore`, in
  `packages/sync/ui/sync-provider.tsx`. The pool keeps one list for each model
  until the next change, so the compiler never holds an old list.

## No effects outside the sync package

`useEffect`, `useLayoutEffect` and `useInsertionEffect` fail lint everywhere
except `packages/sync/ui/`. Use the tool that fits instead:

| You want to                        | Use                                       |
| ---------------------------------- | ----------------------------------------- |
| Show a value computed from records | Derive it in render                       |
| Respond to a click or a submit     | An event handler                          |
| Read records                       | `useRecords`, or the package's `ui/` hook |
| Write records                      | `useCommand`                              |
| Load what a screen needs           | The feature's gate                        |

The ban covers aliased imports, namespace imports and `React.useEffect`. See
[lint rules for client code](../setup/lint-rules.md#client-code).

## No network outside the sync package

Client code never calls `fetch`, `WebSocket`, `XMLHttpRequest`, `EventSource`,
`navigator.sendBeacon`, `indexedDB`, `localStorage` or `sessionStorage`. Only
`packages/sync` does. A screen reads the object pool and calls a command. See
[local-first sync](./local-first-sync.md).

## Types only from schemas

Client code imports from `effect` and from a package's `types/` with
`import type` only. A value import would put Effect code in the first screen.
A constant that the UI needs, such as a length limit, lives in plain
TypeScript in `models/`. `types/` builds its schema from that constant. See
`maxTitleLength` in `packages/notes/models/note.ts`.

## Routes and gates

- `apps/web/src/router.ts` holds the TanStack Router route tree. Each route
  file in `apps/web/src/routes/` renders a feature's screen.
- A route has no loader. A feature's gate settles its needs, then navigates
  once. See [one gate into each feature](../../principles/one-gate-per-feature.md).
- The `one-gate` lint rule rejects a navigation to a gated route from any file
  other than its gate.

## Profiles

Kickoff picks one profile for each client app. The React core stays the same.
A profile changes only the routing, the paths that generators write to, and
the subscriptions that the sync hooks wrap.

| Platform | Profile                   | In the template |
| -------- | ------------------------- | --------------- |
| Web      | Vite with TanStack Router | `apps/web`      |
| Web      | Next.js                   | No              |
| Native   | One                       | No              |
| Native   | Expo                      | No              |

One is the usual choice for native. A project with no client deletes
`apps/web`, `features/` and the React language entry at kickoff.

## Local database

The sync engine keeps its state on the device through one seam,
`LocalDatabase` in `packages/sync/types/local-database.ts`. It has three
operations: `read`, `write` and `clear`. Each one takes or gives the whole
pool state: the confirmed records, the last sync ID and the transaction queue.

| Adapter   | File                                      | Platform           |
| --------- | ----------------------------------------- | ------------------ |
| IndexedDB | `packages/sync/runtime/indexed-db.ts`     | Web                |
| SQLite    | `runtime/sqlite.ts` in `packages/sync`    | Native, at kickoff |
| Memory    | `packages/sync/testing/local-database.ts` | Tests              |

The template has no native app, so it has no SQLite adapter. When kickoff
picks a native profile, it adds one:

1. Add the SQLite driver of the profile to `packages/sync`, at an exact
   version. Expo uses `expo-sqlite`. One or a bare React Native app uses
   `@op-engineering/op-sqlite`. Check the current version with `npm view`.
2. Add the driver as a vendor of the `sync` primitive in the registry.
3. Write `runtime/sqlite.ts` in `packages/sync`. It opens one table with a key
   column and a JSON column, and keeps the pool state in one row, as the
   IndexedDB adapter does.
4. Run the memory fake's tests against it, on a simulator or device. Start the
   simulator with `mise exec -- bun run dev`, never directly.
5. In the native app's composition root, open the SQLite adapter and pass it
   to `loadPool`.

## Design system

`packages/design-system/ui/` holds the shared components, such as `Button` and
`TextField`, and `theme.css` holds the tokens. See [styling](./styling.md).

## What to read when changing it

- `apps/web/src/main.tsx` and `apps/web/src/router.ts`
- `packages/sync/ui/sync-provider.tsx`
- [Client performance](./client-performance.md)
- [Lint rules for client code](../setup/lint-rules.md#client-code)

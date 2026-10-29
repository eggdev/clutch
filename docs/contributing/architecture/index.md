# Architecture

This folder describes how the system works. Read
[project intent](../project-intent.md) for what the product is. Read
[decision records](../decisions/index.md) before you propose a new primitive,
surface or storage home.

## Runtime map

<!-- kickoff: A table: Unit, Public surface, Owns, Binds. One row for each deployed thing (app, API, worker, queue) and each store (database, object storage, cache). Binds names the other units and stores that this unit calls. -->

## Modules

The [primitives registry](./primitives.yaml) is the list of primitives. Each
entry names its group, its kind (package, feature, app or tool), the folders
it owns, its docs and, for a package, its vendors. `check-primitives` rejects a
registry entry that names a missing path, and an Nx project that no primitive
owns. The import policy reads the vendor owners and the languages from it.

The registry never records dependencies between primitives. Nx derives them
from the imports. Run `mise exec -- bun nx graph` to see them.

<!-- kickoff: Two or three sentences: the primitives of the product and how they fit together. The registry holds the full list. -->

The import rules are in [import boundaries](../import-boundaries.md).

## Tiers

The workspace has three tiers. Imports go in one direction: an app imports
features and packages, a feature imports packages, and a package imports only
other packages.

| Tier        | Holds                                                       | Nx tag                        |
| ----------- | ----------------------------------------------------------- | ----------------------------- |
| `apps/`     | Routes, the composition root and runtime configuration      | `platform:server` for an API  |
| `features/` | The gate, screens and components of one area of the product | `type:feature`                |
| `packages/` | One capability, with its records and vendors                | `type:package` or `type:tool` |

- Nothing imports an app. An app imports its own files through `@/`.
- A feature never imports another feature.
- A package of kind `tool` is template tooling, such as `packages/runtime`.
  The product rules for Effect do not apply to it.
- `tools/` holds repository automation, checks and the generators.

## Feature layout

```
features/<name>/
  gate.ts        the one way into the feature
  screens/       what a route renders
  components/    parts used by this feature only
```

When two features need the same part, it moves into a package: the design
system, or the `ui/` of the package that owns the records.

## Package sections

A package has no `src/` folder. It has only the sections that it needs. Each
section is a folder, never a single file.

| Section     | Access     | Holds                                                        |
| ----------- | ---------- | ------------------------------------------------------------ |
| `types/`    | Public     | Effect Schemas for records, IDs, command inputs and errors   |
| `config/`   | Private    | Environment keys, read through Effect `Config`               |
| `models/`   | Public     | Models: the kinds of record that the object pool holds       |
| `commands/` | Public     | Commands, as `<name>.ts` and `<name>.server.ts` files        |
| `repo/`     | Private    | Drizzle tables, queries and `migrations/`                    |
| `service/`  | Public     | Effect services: invariants, access checks and the event log |
| `jobs/`     | Public     | Jobs that run after a commit, for slow or outside work       |
| `runtime/`  | Apps only  | Live Layers, registrations and client boot code              |
| `ui/`       | Public     | Hooks and components                                         |
| `testing/`  | Tests only | Fakes and Test Layers                                        |

- **Public** sections are the interface of the package. Any code may import
  them, subject to the server rule below.
- **Private** sections are imported only inside their own package.
- **`runtime/`** is imported only by an app, by its own package, or by a test.
- **`testing/`** is imported only by a test or by another `testing/` file.
- **Server code** is `config/`, `repo/`, `service/`, `jobs/`, `testing/` and
  each `.server.ts` file. Only server code, a server app or a test imports it.

`check-structure` rejects a package folder that is not a section, and a
feature folder with other parts. The
[generators](../setup/nx.md#generators) make each shape.

## Module design

- Prefer deep modules: a small interface that hides real complexity. Avoid
  pass-through modules and speculative packages.
- Add a package when ownership, lifecycle or callers need independent
  behavior.
- Test through the interface. See
  [test the workflow](../../principles/test-the-workflow.md).

## Source of truth in code

| File                       | Starts                                                              |
| -------------------------- | ------------------------------------------------------------------- |
| `apps/web/src/main.tsx`    | The web composition root: local database, object pool, render, sync |
| `apps/web/src/router.ts`   | The TanStack Router route tree                                      |
| `apps/web/src/commands.ts` | The client half of each command that the web app runs               |
| `apps/api/src/main.ts`     | The API composition root: database driver, actor, HTTP server       |
| `apps/api/src/packages.ts` | The server change and migrations of each package                    |

<!-- kickoff: One line for each other entry point, router and composition root: the file and what it starts. -->

## Pages

- [Server](./server.md): Effect services, Layers, edges, errors, SQL and the
  event log
- [Client](./client.md): the React core, the router, the effect-hook ban and
  the stack profiles
- [Local-first sync](./local-first-sync.md): the object pool, the transaction
  queue, events, deltas and the commands that wait for the server
- [Request context](./request-context.md): how a request becomes a tenant and
  an actor
- [Authorization](./authorization.md): the access check, and the permission
  each surface declares
- [Data storage](./data-storage.md): tenant isolation, the data inventory and
  frozen storage contracts
- [Feature flags](./feature-flags.md): the registry in code, the flag service,
  and when a flag goes away
- [API errors](./api-errors.md): one error shape, and the code for each status
- [Soft delete](./soft-delete.md): the restore window, live reads and the purge
- [MCP server](./mcp.md): the tools that agents call, and how to add one
- [Client performance](./client-performance.md): the speed budgets and the
  check for each one
- [Styling](./styling.md): the token roles, the theme, the platforms and the
  styling checks

<!-- kickoff: One link for each other system page, with when to open it. Each user journey from kickoff gets a page, and so does each package with real rules (authentication, jobs). -->

## Page shape

Each page here follows one shape, so readers know where a fact lives:

1. A table that answers the page's core questions.
2. The rules, each one a sentence that a test or a check can prove.
3. A recipe for the common extension, such as a new entry point or a new
   store, when one exists.
4. "What to read when changing it": the files and pages to open first.

A runbook for a one-time operation lives in
[operations](../operations/index.md).

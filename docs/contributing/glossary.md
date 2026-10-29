# Glossary

Each term has one meaning in this repository. Use the term in the first
column. Do not use the words in the last column for the same idea.

[`check-terms`](./setup/checks.md#checks) reads the
[rejected words](#rejected-words) table and rejects those words in
contributor docs. The other columns guide the writer, and no check reads them.

## Writing

Docs follow ASD-STE100 Simplified Technical English, but not every rule.

- Use one word for one idea. Use the term from this page every time.
- Use active voice and the simple present tense.
- Write one idea in each sentence. Keep a sentence in `docs/` to 25 words or
  fewer. `check-sentences` rejects a longer one.
- Keep a technical term when it is the right one. Define it once, here.
- Do not use an em dash.

## Workspace

| Term             | Meaning                                                                                                                                          | Do not use                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Primitive        | One part of the system in the [primitives registry](./architecture/primitives.yaml). Its kind is package, feature, app or tool.                  | component, unit                    |
| Registry         | A file that lists every instance of one thing, such as the primitives registry. A check reads it.                                                | manifest, index (for this)         |
| Tier             | One of the three top folders: `apps/`, `features/` and `packages/`. See [architecture](./architecture/index.md#tiers).                           | layer, level                       |
| App              | A runnable program in `apps/`. It holds routes, the composition root and runtime configuration. Nothing imports an app.                          | application package                |
| Feature          | One folder in `features/` with the gate, the screens and the components of one area of the product.                                              | page module                        |
| Package          | One folder in `packages/` that owns one capability, with its records and vendors.                                                                | library, domain, module (for this) |
| Tool             | A package or an app that is template tooling, such as `packages/runtime`. The product rules for Effect do not apply to it.                       | utility package                    |
| Section          | One folder in a package, such as `types/` or `repo/`, with a fixed role. See [package sections](./architecture/index.md#package-sections).       | layer                              |
| Public section   | A section that code outside its package can import.                                                                                              | exported layer                     |
| Private section  | A section that only its own package can import.                                                                                                  | internal layer                     |
| Server code      | `config/`, `repo/`, `service/`, `testing/` and each `.server.ts` file. Only server code, a server app or a test imports it.                      | backend code                       |
| Composition root | The one place in an app that selects each Layer and starts the program.                                                                          | bootstrap, setup file              |
| Vendor           | A third-party service or library that exactly one package owns.                                                                                  | provider (for a vendor)            |
| Vendor owner     | The package that imports a vendor. Its public sections do not show the vendor.                                                                   | wrapper                            |
| Language         | A dependency that many folders use, such as a query builder or a UI framework. Its registry entry lists the folders that may import it.          | layer                              |
| Invariant        | A rule about the product that must always hold. The project intent page lists the hard invariants.                                               | constraint (for this)              |
| Profile          | The stack of one client app: Vite with TanStack Router, Next.js, One or Expo. Kickoff picks it. See [client](./architecture/client.md#profiles). | stack choice                       |

## Module design

These terms come from the
[codebase-design skill](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/SKILL.md).

| Term          | Meaning                                                                                                  | Do not use                       |
| ------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Module        | Anything with an interface and an implementation: a function, a file or a package.                       | unit                             |
| Interface     | Everything that a caller must know to use a module: types, invariants, error modes and limits.           | API (for this), surface          |
| Seam          | The place where the interface of a module lives. Behavior changes there with no edits at the call sites. | boundary                         |
| Adapter       | A thing that satisfies an interface at a seam.                                                           | implementation (for this)        |
| Fake          | An adapter for tests that keeps its state in memory. It lives in the `testing/` folder of its owner.     | mock, stub (for our own modules) |
| Deep module   | A module with a small interface and a large implementation.                                              | rich module                      |
| Deletion test | Delete the module in your head. If complexity comes back at many call sites, the module earns its place. |                                  |

## Client data

| Term                   | Meaning                                                                                                                                       | Do not use                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Local store            | The client copy of the records: the object pool and the local database together.                                                              | cache (for records)             |
| Object pool            | The in-memory map of records, keyed by model and ID. Screens read it.                                                                         | state, cache                    |
| Local database         | Device storage for the confirmed records, the last sync ID and the transaction queue. It is IndexedDB on the web and SQLite on native.        | offline cache                   |
| Sync engine            | The code in `packages/sync` that moves transactions to the server and deltas to the client. It is the only client code that uses the network. | API client, data layer          |
| Model                  | The definition of one kind of record, in `models/`.                                                                                           | entity, schema (for this)       |
| Record                 | One instance of a model, with one ID. Each fact has exactly one owner record.                                                                 | entity, row (on the client)     |
| Derived state          | A value that a screen computes from records, such as a filtered list. Nothing stores it.                                                      | computed copy                   |
| Command                | The one definition of a change: its input, its local change, its server change and whether it waits for the server.                           | action, handler (for the whole) |
| Local change           | The part of a command that changes the object pool at once, in plain TypeScript.                                                              | reducer                         |
| Server change          | The `.server.ts` part of a command. It changes the owner record on the server and checks access.                                              | resolver                        |
| Transaction            | One run of a command. It waits in the transaction queue until the server accepts or rejects it.                                               | request, job                    |
| Transaction queue      | The transactions that the server has not settled yet. The local database keeps a copy, so the queue survives a reload.                        | outbox, mutation queue          |
| Optimistic update      | The screen shows a local change at once. A rejected transaction rolls it back.                                                                | instant update                  |
| Server-confirmed write | A command with `waits: 'server'`. The screen shows it as done only after the server confirms it.                                              | blocking write                  |
| Event                  | One entry in the server's append-only log. Each event has a sync ID.                                                                          | action, log row                 |
| Sync ID                | The number that the server gives each event. It only increases. Each client stores the last sync ID that it applied.                          | version, cursor, offset         |
| Delta                  | One event with its changed records, as the server pushes it to each client of the organization.                                               | patch, diff                     |
| Rebase                 | Apply the pending local changes again on top of the confirmed records after a delta arrives.                                                  | replay                          |
| Sync group             | A label on a record, such as `space:<id>`, that decides which clients get it. A client gets a change when it has loaded one of its groups.    | channel, room, topic            |
| Load function          | A function from `defineLoad` that names the group holding the records a screen asks for. A gate calls it through `useLoad`.                   | loader, fetcher                 |
| Gate                   | The one function that opens a feature. It settles the needs of the feature, then navigates once.                                              | guard, wrapper                  |

## Server

| Term                     | Meaning                                                                                                           | Do not use                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Effect                   | The server language and standard library. See [server](./architecture/server.md).                                 |                             |
| Service                  | An Effect `Context.Service` and the operations that it declares. It lives in `service/`.                          | manager, helper             |
| Layer                    | An Effect value that builds a service. Write it with a capital L, and use it only for Effect.                     | module, tier, section       |
| Live Layer               | The Layer that uses the real vendor.                                                                              | prod adapter                |
| Test Layer               | The Layer that uses a fake.                                                                                       | mock layer                  |
| Edge                     | The code that runs an Effect: `runtime/`, an app or a test.                                                       | entry point (for this)      |
| Repo                     | The private section with the Drizzle tables, queries and migrations of one package.                               | DAO, db folder              |
| Tagged error             | An error class from `Schema.TaggedError`. Server code fails with one and never throws.                            | exception                   |
| Transaction-safe service | A service that reads and writes only the transaction it is given. Only such a service may run in a server change. | pure service                |
| Job                      | Work that runs after a commit, such as a vendor call. A server change asks for one through the outbox.            | background task, worker     |
| Outbox                   | The `sync_jobs` table. A server change writes its jobs there in its own transaction.                              | queue (for this)            |
| Schedule                 | A job that the job runner asks for at each interval.                                                              | cron                        |
| System actor             | The actor of a write that no person makes, such as a job or a webhook. No access rule runs for it.                | admin, root                 |
| Access rule              | The required `access` field of a server change. It decides who may run the change, before the change runs.        | permission check (for this) |

## Checks and process

| Term               | Meaning                                                                                                                                             | Do not use                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Check              | A script in `tools/check-*.ts` that rejects a problem in the repository.                                                                            | validator                                |
| Lint rule          | A rule that oxlint or Stylelint runs on one file.                                                                                                   | check (for a lint rule)                  |
| Validate           | The one command that runs every check: `mise exec -- bun run validate`.                                                                             | gate (for this command)                  |
| Generator          | An Nx generator in `tools/generators/` that makes a package, feature, command or model in its one shape.                                            | scaffold script                          |
| ---------------    | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Journey            | A test that proves one user goal through the real app: a Playwright `.pw.ts` file or a Maestro `.maestro.yaml` file in `features/<name>/journeys/`. | end-to-end test (for one file), scenario |
| Verify flow        | A flow in `.agents/skills/verify/verification.json` that `verify.py` runs and keeps evidence for. Each journey is one.                              | test suite (for this)                    |
| Agent hook         | A script in `.agents/hooks/` that Claude Code and Codex run before or after a tool call, or at the end of a turn.                                   | plugin (for this)                        |
| Guardrail file     | A file that configures a check, a lint rule, a hook or a budget. `tools/guardrail-files.json` lists them.                                           | config (alone)                           |
| Decision record    | A short page in `decisions/` that states one project decision, its reason and when to revisit it.                                                   | ADR (in prose), design doc               |
| One-way door       | A change that a later change cannot undo, such as a stored shape. See [two-way doors](../principles/two-way-doors.md).                              | irreversible change                      |
| Kickoff slot       | An HTML comment that kickoff replaces with a fact about one project.                                                                                | placeholder, TODO                        |
| Device host        | The one adapter that drives a simulator, an emulator or a native build. `DEVICE_HOST` names it. See [native builds](./setup/native.md#device-host). | device runner                            |
| Native fingerprint | A hash of each input that goes into a native binary. `native:build` builds only when it changes.                                                    | build hash                               |

## Words with one meaning only

| Word      | Use it only for                                  | Use instead for other meanings           |
| --------- | ------------------------------------------------ | ---------------------------------------- |
| Layer     | An Effect Layer                                  | section, tier, language, module          |
| Service   | An Effect service                                | package, for a folder in `packages/`     |
| Gate      | A feature gate                                   | validate, check                          |
| Hydration | React attaching to HTML that the server rendered | load, for the local store                |
| Provider  | A React context provider                         | vendor, for a third party                |
| Store     | Never alone. Name which one                      | local store, object pool, local database |
| View      | Nothing. It has too many meanings                | screen, component                        |

## Rejected words

`check-terms` rejects each word in the first column, as a whole word and in
any case. Inline code and code blocks are skipped.

| Word          | Use instead                                             |
| ------------- | ------------------------------------------------------- |
| `mutation`    | command (the definition) or transaction (one run of it) |
| `mutations`   | commands or transactions                                |
| `hydrate`     | load                                                    |
| `hydrates`    | loads                                                   |
| `hydrated`    | loaded                                                  |
| `via`         | through                                                 |
| `e.g.`        | for example                                             |
| `i.e.`        | that is                                                 |
| `etc.`        | the full list                                           |
| `utilize`     | use                                                     |
| `in order to` | to                                                      |
| `—`           | a period or a comma                                     |

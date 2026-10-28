# Glossary

Each term has one meaning in this repository. Use the term in the first
column. Do not use the words in the last column for the same idea. A term from
a decision record links to that record.

[`check-terms`](./setup/checks.md#checks) reads the
[rejected words](#rejected-words) table and rejects those words in
contributor docs. The other columns guide the writer, and no check reads them.

## Writing

Docs follow ASD-STE100 Simplified Technical English, but not every rule.

- Use one word for one idea. Use the term from this page every time.
- Use active voice and the simple present tense.
- Write one idea in each sentence. Keep a sentence to 25 words or fewer.
- Keep a technical term when it is the right one. Define it once, here.
- Do not use an em dash.

## Workspace

| Term             | Meaning                                                                                                                                                                | Do not use                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Primitive        | One part of the system in the [primitives registry](./architecture/primitives.yaml): a package, an app or a tool.                                                      | component, unit            |
| Registry         | A file that lists every instance of one thing, such as the primitives registry. A check reads it.                                                                      | manifest, index (for this) |
| Vendor           | A third-party service or library that exactly one package owns.                                                                                                        | provider (for a vendor)    |
| Vendor owner     | The package that imports a vendor. Its interface does not show the vendor.                                                                                             | wrapper                    |
| Language         | A dependency that many folders use, such as a query builder or a UI framework. Its registry entry lists the folders that may import it.                                | layer                      |
| Invariant        | A rule about the product that must always hold. The project intent page lists the hard invariants.                                                                     | constraint (for this)      |
| Tier             | One of the three top folders: `apps/`, `features/` and `packages/`. See [0001](./decisions/0001-three-tiers-and-package-sections.md).                                  | layer, level               |
| Feature          | One folder in `features/` with the screens, the gate and the components for one area of the product. See [0001](./decisions/0001-three-tiers-and-package-sections.md). | page module                |
| Section          | One folder in a package, such as `types/` or `repo/`, with a fixed role. See [0001](./decisions/0001-three-tiers-and-package-sections.md).                             | layer                      |
| Public section   | A section that code outside its package can import.                                                                                                                    | exported layer             |
| Private section  | A section that only its own package can import.                                                                                                                        | internal layer             |
| Composition root | The one place in an app that selects each adapter and starts the program.                                                                                              | bootstrap, setup file      |

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

| Term                   | Meaning                                                                                                                                                                | Do not use                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Local store            | The device copy of the records that screens read. [0003](./decisions/0003-local-first-sync-for-every-client.md) splits it into the object pool and the local database. | cache (for records)             |
| Object pool            | The in-memory map of records, keyed by ID. Screens read it.                                                                                                            | state, cache                    |
| Local database         | Device storage for records and pending transactions: IndexedDB on web, SQLite on native.                                                                               | offline cache                   |
| Sync engine            | The code that moves transactions to the server and deltas to the client. It is the only client code that uses the network.                                             | API client, data layer          |
| Model                  | The definition of one kind of record: fields, relations, sync groups and its load function.                                                                            | entity, schema (for this)       |
| Record                 | One instance of a model, with one ID. Each fact has exactly one owner record.                                                                                          | entity, row (on the client)     |
| Derived state          | A value that a screen computes from records, such as a filtered list. Nothing stores it.                                                                               | computed copy                   |
| Command                | The one definition of a change: its input, its local change, its server change and whether it waits for the server.                                                    | action, handler (for the whole) |
| Local change           | The part of a command that changes the client copy at once, in plain TypeScript.                                                                                       | reducer                         |
| Server change          | The part of a command that changes the owner record on the server and checks access.                                                                                   | resolver                        |
| Transaction            | One run of a command. It waits in the transaction queue until the server accepts or rejects it.                                                                        | request, job                    |
| Optimistic update      | The screen shows a local change at once. A rejected transaction rolls it back.                                                                                         | instant update                  |
| Server-confirmed write | A command that waits for the server before the screen shows it as done.                                                                                                | blocking write                  |
| Event                  | One entry in the server's append-only log. Each event has a sync ID.                                                                                                   | action, log row                 |
| Sync ID                | The number that the server gives each event. It only increases. Each client stores the last sync ID that it applied.                                                   | version, cursor, offset         |
| Delta                  | The events, with their data, that the server pushes to each client that may see them.                                                                                  | patch, diff                     |
| Rebase                 | Apply the pending transactions again on top of a delta that arrives.                                                                                                   | replay                          |
| Sync group             | The routing data on an event. It decides which clients receive the event.                                                                                              | channel, room, topic            |
| Load function          | A function in `models/` that asks the sync engine for the records that a screen needs. Only a gate calls it.                                                           | loader, fetcher                 |
| Projection             | A result that the server computes, keyed by query and parameters. The client keeps it as a disposable copy.                                                            | view, report cache              |
| Gate                   | The one function that opens a feature. It settles the needs of the feature, then navigates once.                                                                       | guard, wrapper                  |

## Server

| Term       | Meaning                                                                                                  | Do not use             |
| ---------- | -------------------------------------------------------------------------------------------------------- | ---------------------- |
| Effect     | The server language and standard library. See [0005](./decisions/0005-effect-is-the-server-language.md). |                        |
| Service    | An Effect `Context.Tag` and the operations that it declares. It lives in `service/`.                     | manager, helper        |
| Layer      | An Effect value that builds a service. Write it with a capital L, and use it only for Effect.            | module, tier, section  |
| Live Layer | The Layer that uses the real vendor.                                                                     | prod adapter           |
| Test Layer | The Layer that uses a fake.                                                                              | mock layer             |
| Edge       | The code that runs an Effect: the composition root and `runtime/`.                                       | entry point (for this) |
| Repo       | The private section with the Drizzle tables, queries and migrations of one package.                      | DAO, db folder         |

## Checks and process

| Term            | Meaning                                                                                                                | Do not use                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Check           | A script in `tools/check-*.ts` that rejects a problem in the repository.                                               | validator                  |
| Lint rule       | A rule that oxlint or Stylelint runs on one file.                                                                      | check (for a lint rule)    |
| Validate        | The one command that runs every check: `mise exec -- bun run validate`.                                                | gate (for this command)    |
| Guardrail file  | A file that configures a check, a lint rule or a budget.                                                               | config (alone)             |
| Decision record | A short page in `decisions/` that states a decision, its reason and when to revisit it.                                | ADR (in prose), design doc |
| One-way door    | A change that a later change cannot undo, such as a stored shape. See [two-way doors](../principles/two-way-doors.md). | irreversible change        |
| Kickoff slot    | An HTML comment that kickoff replaces with a fact about one project.                                                   | placeholder, TODO          |

## Words with one meaning only

| Word      | Use it only for                                  | Use instead for other meanings           |
| --------- | ------------------------------------------------ | ---------------------------------------- |
| Layer     | An Effect Layer                                  | section, tier, language, module          |
| Gate      | A feature gate                                   | validate, check                          |
| Hydration | React attaching to HTML that the server rendered | load, for the local store                |
| Provider  | A React context provider                         | vendor, for a third party                |
| Store     | Never alone. Name which one                      | local store, object pool, local database |
| View      | Nothing. It has too many meanings                | screen, projection, component            |

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

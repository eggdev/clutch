# Server

How server code is written. All server code uses Effect 4. The API app,
`apps/api`, runs on Bun and serves the sync protocol over one WebSocket.

| Question                             | Answer                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Which language does server code use? | Effect, from the `effect` package, version 4.0.7                                                  |
| How is a service declared?           | `Context.Service<Self, Shape>()('package/Name')`, in `service/`                                   |
| How is a service built?              | A Layer: `Layer.succeed(Tag)(value)` or `Layer.effect(Tag)(effect)`                               |
| Who selects each Layer?              | The composition root, `apps/api/src/main.ts`                                                      |
| Who runs an Effect?                  | Only an edge: `runtime/`, an app or a test                                                        |
| How does code fail?                  | With a tagged error, `Schema.TaggedError`                                                         |
| How does code read configuration?    | Effect `Config`, in `config/`                                                                     |
| Which database runs?                 | Postgres through Effect SQL and Drizzle. PGlite runs it in the process for development and tests. |

## Services and Layers

A service is the interface of one area of the product. Its Live Layer uses the real
vendor, and its Test Layer uses a fake. Both satisfy the same service, so a
change of vendor is a new Layer and one line in the composition root. See
[generic platform](../../principles/generic-platform.md).

```ts
export class Actors extends Context.Service<
  Actors,
  { readonly fromHeaders: (headers: RequestHeaders) => Effect.Effect<Actor> }
>()('identity/Actors') {}
```

`packages/identity` shows the pattern. `service/actors.ts` declares the
service. `runtime/dev.server.ts` builds it from `config/dev.ts`, and
`testing/actor.ts` builds it for tests. The sync server asks it for the actor
of each socket and each call. A Layer that finds no session dies with
`SessionEnded`, from `packages/sync/types/session-ended.ts`. The sync server
then closes the socket with code 4401, at the upgrade and at each later call
on the open socket. Each other failure is a server fault.

## Services in a server change

A server change may use a service only if the service is transaction-safe.
Such a service reads and writes only the transaction that it is given, so a
rollback undoes all of its work.

- A transaction-safe service has `[transactionSafe]: true` in its shape. The
  mark is in `packages/sync/service/transaction-safe.ts`.
- The registry grants the mark. List the service key under `transactionSafe`
  of its package in
  [`primitives.yaml`](./primitives.yaml). `check-transaction-safe` rejects a
  marked service that the registry does not list. A grant is a new escape
  hatch, so agent review gives it an `owner` finding.
- `serverChange` accepts only marked services. A vendor service has no
  mark, so a server change that uses one fails the typecheck.
  `packages/sync/commands/server-change.server.test.ts` proves it.
- `SyncServer` needs the services of every server change, so the composition
  root must provide each one. A missing one fails the typecheck of the app.
- A vendor call goes in a job, which runs after the commit. See
  [jobs and the outbox](#jobs-and-the-outbox).

Each server change also declares its access rule. See
[one door for each write](./authorization.md#one-door-for-each-write).

## Edges and errors

- Only an edge calls `Effect.runPromise`, `runSync`, `runFork` or their
  relatives. The `repo-effect/run-at-edges` lint rule enforces it.
- `service/` and `.server.ts` files in a `type:package` package never `throw`,
  use `async` or call `new Promise`. The `repo-effect/tagged-errors` rule
  enforces it.
- An error is a `Schema.TaggedError`. Handle one with `Effect.catchTag` or
  `Effect.matchEffect`.
- A server half refuses a transaction with `refuse(code, reason)` from its run
  context. The code must be one that its command declares, or a built-in one. The sync
  server rolls the database transaction back and tells the client the code and
  the reason. See [refusal codes](./contract.md#refusal-codes).

## Configuration

Effect `Config` reads each environment variable. A `Config` is an Effect, so a
Layer reads it when it builds. Use `Config.String`, `Config.Port`,
`Config.option` and `Config.withDefault`. Each package reads its own keys in
`config/`. See [environment variables](../setup/environment-variables.md).

## Database

| Part       | Where                                                     |
| ---------- | --------------------------------------------------------- |
| Service    | `Database` in `packages/sync/service/database.ts`         |
| Drivers    | `packages/sync/runtime/database.server.ts`                |
| Tables     | `repo/schema.ts` of each package                          |
| Queries    | `repo/` of each package                                   |
| Migrations | `repo/migrations/` of each package, run in order at start |

- Drizzle `1.0.0-rc.5` defines the tables and writes the queries. It runs
  through the Effect drivers `drizzle-orm/effect-pglite` and
  `drizzle-orm/effect-postgres`.
- `DatabasePglite` keeps Postgres in the process, in `.data/pglite`. Local
  development needs no database server.
- `DatabasePostgres` connects to a Postgres server. The composition root uses
  it when `DATABASE_URL` is set.
- No repo knows which driver runs. Both give the same `Database` service.
- A repo maps each row to its public record. A record type comes from the
  contract, never from a table. A round-trip test proves the mapping.
- A write returns the row that the database holds. It ends with
  `.returning()` and `storedRow` from `packages/sync/service/stored-row.ts`.
  When no row comes back, it fails with `RowNotStored`. It never returns its
  input. The `no-made-up-rows` ratchet fails a new `?? row` in a repo.
- `apps/api/src/server.ts` runs each package's migrations before the server
  takes a request. See [migrations](../setup/migrations.md).

## Sync server

`SyncServer` in `packages/sync/runtime/server.server.ts` serves `SyncRpcs`
over a WebSocket at `/sync`. It uses `RpcServer.layerHttp` with the websocket
protocol, inside `HttpRouter.serve`, with `RpcSerialization.layerJson`.
`BunHttpServer.layer` gives the HTTP server, and `BunHttpServer.layerTest`
gives one for tests.

`SyncServer(serverChanges, contracts)` takes the server change of each command,
and the contracts that the app serves. It stops at start when a command of a
listed contract has no server change. `serverOf(packages)` gives both lists from
`apps/api/src/packages.ts`. Each package lists its server changes in
`runtime/server.server.ts`. The event log and the flow of a write are on the
[local-first sync page](./local-first-sync.md).

## The event log

`eventLog(contracts)` in `packages/sync/service/event-log.ts` is the door that every change passes before a client gets it. Each commit checks its changes against the contracts that the server serves. A change of a model that no contract declares stops the commit. An upsert whose data does not fit its record also stops it, and the error names the fields that do not fit. A delete checks only its model. A failed check dies inside the transaction, so no event is appended. `packages/sync/service/event-log.test.ts` tests each rule.

A commit first looks for its transaction ID, so a transaction that a client sends again applies once. `findTransaction` in `packages/sync/repo/events.ts` reads the log and `sync_transactions` in one statement. The trim moves the transaction ID of each event that it deletes to `sync_transactions`, so the proof outlives the event. Those rows are never dropped; see [the size of the log](./local-first-sync.md#the-size-of-the-log). `packages/sync/jobs/trim-log.test.ts` and `apps/api/src/trimmed-log.test.ts` hold this.

`Push` refuses a list of more than `transactionsPerPush` (100) transactions before it runs any of them. The client sends at most that many, so only a broken or hostile client meets the refusal. `apps/api/src/push-limit.test.ts` holds this.

A load reads the snapshot of a group from `sync_records`, not the history of the log. The snapshot holds the last change of each live record, in pages by the record key. See [the protocol](./local-first-sync.md).

## More than one process

A server can run as more than one process over one Postgres database, such as two API processes and a job runner. `Wake` in `packages/sync/service/wake.ts` connects them, and the database driver gives it.

- The event log sends `commit` with the organization ID to the other processes inside the transaction of the commit, with `pg_notify`. Postgres delivers it when the transaction commits, and drops it on a rollback. So a commit that holds always wakes the others, and a failed one never does. After the commit, the event log wakes the reader of the organization in its own process.
- The signals go on the channel `sync_wake`, and each process hears the others with `LISTEN`. A process drops its own signals.
- Each process keeps one reader for each organization that a connection follows. A wake makes the reader read the events after its mark from the log, in sync ID order. So a client gets each delta in order, whichever process wrote it, and none is dropped.
- A new reader reads the head of the log first, and its mark starts there. A connection gets the reader only after that read, so the head that the connection reads next is at or after the mark. Its backlog sends each event up to its own head. The reader sends each event after the mark. So no event falls between the two. A reader whose head read fails leaves the process, each connection that waited for it fails, and its client connects again. `packages/sync/service/live-start.test.ts` holds this.
- `Sessions.end` closes the user's sockets in its own process, then sends `end` with the user ID. Each other process closes that user's sockets too. An end has no transaction to send with, so a failed send is tried three more times, 100 ms apart. When it still fails, `end` logs an error and returns `othersTold: false`, because other processes may still hold sockets of the user. The sockets of its own process close in each case.
- When the listener loses its connection, it listens again after a second. Then each reader with a connection reads the log from its mark, because a signal sent in between is lost.
- Each reader with a connection also reads the log every 30 seconds (`rereadInterval` in `packages/sync/service/event-log.ts`). So a lost signal leaves a connection behind for at most 30 seconds. When this timed read finds events that no wake announced, the server logs a warning before it sends them. The warning names the organization, the number of events, and the first and last sync ID. So each lost wake shows in the logs. A wake that comes while the timed read runs also counts as an announcement, so a late wake seldom makes a warning. The root fix is [CL-920](../../../.clutch/issues/CL-920.md): tests of `WakePostgres` on a real Postgres server, which run in CI. See below.
- `DatabasePglite` runs in one process, so its wake reaches only that process. A server on PGlite runs as one process.

`packages/sync/service/live.test.ts` runs two event logs over one database. `apps/api/src/processes.test.ts` runs two API processes over one database, for the live delta and for a sign-out. They also cover a signal lost while a process does not listen, and the read every 30 seconds with its warning. `packages/sync/runtime/wake.server.test.ts` shows that a signal sent in a transaction goes out on commit and not on rollback. These use PGlite, whose `LISTEN` reaches each listener of the same database.

The same paths also run on a real Postgres server, with `DatabasePostgres` and `WakePostgres` as in production. Each process has its own pool of connections. Each file is a `*.postgres.test.ts` next to the code it tests:

- `packages/sync/runtime/wake.postgres.test.ts`: a signal sent in a transaction reaches another process on commit, and not on rollback.
- `packages/sync/service/event-log.postgres.test.ts`: 300 commits, 30 at a time, through one process reach a subscriber of another in sync ID order, each once. A `LISTEN` connection that `pg_terminate_backend` ends listens again. The event committed while it was down then reaches the subscriber. The timed read runs once an hour in that test, and no lost-wake warning shows, so the listener that listened again made the reader read.
- `apps/api/src/processes.postgres.test.ts`: a sign-out on one API process closes the user's socket on another.
- `packages/sync/repo/repo.postgres.test.ts`: the migrations, `fillRecords` and `trimLog` on the real server. Four processes that start at once each migrate a new database, and each migration applies once.

CI runs them in the job `validate`, against a Postgres service. See [testing](../testing.md#real-postgres).

One limit stays. `fillRecords` in `packages/sync/repo/events.ts` fills `sync_records` from the log only while the table is empty. During a rolling deploy from a build before that table, an older process can still write events without their record state. The fill then never sees those events. Deploy that change with every process stopped, or run the fill again by hand.

## Jobs and the outbox

A job does slow or outside work after a commit, such as a vendor call or a
count over many rows. `packages/sync/service/jobs.ts` defines the parts.

| Part             | What it does                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `job`            | Declares a job in the package contract: its name and the fields of its payload                 |
| `defineJob`      | Gives the code of a declared job: its `run`, with the payload type of the declaration          |
| `Outbox.enqueue` | Writes a job in the transaction it is given, so the job exists only if the transaction commits |
| `JobRunner`      | Claims due jobs after the commit and runs them. The server app starts it                       |
| `defineSchedule` | Asks for a job at each interval                                                                |

- `Outbox` is transaction-safe, so a server change may use it.
- A job may use any service, a vendor service too. It runs outside the
  transaction of the change that asked for it.
- The job ID makes a repeated request do nothing new. Choose an ID from the
  thing that the job is about, such as `notes/count:<note ID>`.
- A failed job runs again after 1 s, 2 s, 4 s and so on, up to five minutes.
  After five attempts it stays `failed`, with its error in `last_error`.
- The runner claims jobs with `FOR UPDATE SKIP LOCKED`, so two servers never
  run one job at once. A claimed job stays locked for five minutes. A server
  that stops frees its jobs when the lock ends.
- `run` must be safe to repeat, because a job can run again after a failure.
- `context.commit` writes records as the system actor, keyed by the job ID.
  Each client of their sync groups gets a delta.
- Each package declares its jobs in its contract, and lists their code in the
  `jobs` of `runtime/server.server.ts`. `serverOf` gives the list to `JobRunner`,
  with the contracts.
- `JobRunner` stops at start when a contract declares a job that no list
  lists. `packages/sync/runtime/job-runner.test.ts` tests it.
- Each interval of a schedule has one job ID, so two servers run it once.
  `sync/sweep-jobs` deletes done jobs after seven days, once an hour.
  `sync/trim-log` trims the event log once an hour, when
  `SYNC_LOG_KEEP_DAYS` is set. Without it, the job does nothing. See
  [the size of the log](./local-first-sync.md#the-size-of-the-log).

`packages/notes/jobs/count-notes.ts` shows the pattern. `create-note.server.ts`
asks for it in its transaction, and the job commits the note count of the
space.

## System writes, routes and webhooks

Code that is not a command writes through `commitAsSystem` in
`packages/sync/service/system-write.ts`. No person acts, so no access rule
runs. The `key` must be the same for each repeat of one outside event, so the
event log commits it once.

A package declares its HTTP routes in its contract, with `route` from
`packages/sync/contract/route.ts`. Its code is `defineRoute` in
`runtime/routes.server.ts`, and the `routes` of `runtime/server.server.ts` list the
code. `HttpRoutes` adds the list to the router of the server app, with the contracts. A route that fails
answers 500. `HttpRoutes` stops at start when a contract declares a route that
no list lists. `packages/sync/runtime/http-routes.server.test.ts` tests it.

A webhook follows four steps. `packages/notes/runtime/routes.server.ts` shows
them in the note import route.

1. Check the signature of the raw body through a service, such as
   `WebhookSignature`.
2. Decode the body with a schema. A body that does not decode gets 400.
3. Commit with `commitAsSystem`, keyed by the sender's event ID.
4. Ask for a job for slow or outside work, in the same transaction.

## Add a package with server code

1. Run `mise exec -- bun nx g @tools/generators:package <name>
   --sections=contract,commands,repo,runtime --record=<record>
   --group=<group>`. It declares the first record in the contract, and it
   writes `runtime/server.server.ts` with the migrations. `nx sync` then adds
   the package to each app's list.
2. Add a command with the `command` generator. It declares the command in the
   contract and registers the server change. See the
   [contract page](./contract.md#change-a-contract).
   Add a job with `mise exec -- bun nx g @tools/generators:job <name> <job>`.
   It registers the job in the package's `runtime/server.server.ts`.
3. Run `mise exec -- bun nx run @repo/<name>:db-generate` after each table
   change.
   Only drizzle-kit writes migrations.

## What to read when changing it

- `apps/api/src/main.ts` and `apps/api/src/server.ts`
- `packages/sync/service/event-log.ts` and `packages/sync/runtime/server.server.ts`
- `packages/sync/commands/server-change.server.ts`, which builds each server half
- [Contract](./contract.md)
- [Lint rules for Effect code](../setup/lint-rules.md#effect-code)
- [API errors](./api-errors.md)

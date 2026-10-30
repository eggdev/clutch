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
of each socket and each call.

## Services in a server change

A server change may use a service only if the service is transaction-safe.
Such a service reads and writes only the transaction that it is given, so a
rollback undoes all of its work.

- A transaction-safe service has `[transactionSafe]: true` in its shape. The
  mark is in `packages/sync/service/transaction-safe.ts`.
- The registry grants the mark. List the service key under `transactionSafe`
  of its package in
  [`primitives.yaml`](./primitives.yaml). `check-transaction-safe` rejects a
  marked service that the registry does not list, so a person reviews each
  grant.
- `defineServerChange` accepts only marked services. A vendor service has no
  mark, so a server change that uses one fails the typecheck.
  `packages/sync/commands/define.server.test.ts` proves both cases.
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
- A server change refuses a transaction with `CommandRejected`. The sync
  server rolls the database transaction back and tells the client why.

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
- A repo maps each row to its public record. A record type comes from
  `types/`, never from a table. A round-trip test proves the mapping.
- `apps/api/src/server.ts` runs each package's migrations before the server
  takes a request. See [migrations](../setup/migrations.md).

## Sync server

`SyncServer` in `packages/sync/runtime/server.server.ts` serves `SyncRpcs`
over a WebSocket at `/sync`. It uses `RpcServer.layerHttp` with the websocket
protocol, inside `HttpRouter.serve`, with `RpcSerialization.layerJson`.
`BunHttpServer.layer` gives the HTTP server, and `BunHttpServer.layerTest`
gives one for tests.

The server changes come from `apps/api/src/packages.ts`. Each package
registers its server changes in `runtime/handlers.server.ts`. The event log
and the flow of a write are on the
[local-first sync page](./local-first-sync.md).

## Jobs and the outbox

A job does slow or outside work after a commit, such as a vendor call or a
count over many rows. `packages/sync/service/jobs.ts` defines the parts.

| Part             | What it does                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `defineJob`      | Defines a job: a name, a payload schema and `run`. It lives in the `jobs/` section of a package |
| `Outbox.enqueue` | Writes a job in the transaction it is given, so the job exists only if the transaction commits  |
| `JobRunner`      | Claims due jobs after the commit and runs them. The server app starts it                        |
| `defineSchedule` | Asks for a job at each interval                                                                 |

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
- Each package lists its jobs and schedules in `runtime/jobs.server.ts`.
  `apps/api/src/packages.ts` passes them to `JobRunner`.
- Each interval of a schedule has one job ID, so two servers run it once.
  `sync/sweep-jobs` deletes done jobs after seven days, once an hour.

`packages/notes/jobs/count-notes.ts` shows the pattern. `create-note.server.ts`
asks for it in its transaction, and the job commits the note count of the
space.

## System writes, routes and webhooks

Code that is not a command writes through `commitAsSystem` in
`packages/sync/service/system-write.ts`. No person acts, so no access rule
runs. The `key` must be the same for each repeat of one outside event, so the
event log commits it once.

A package lists its HTTP routes in `runtime/routes.server.ts`, with
`defineRoute` from `packages/sync/service/routes.ts`. `HttpRoutes` adds them to
the router of the server app. A route that fails answers 500.

A webhook follows four steps. `packages/notes/runtime/routes.server.ts` shows
them in the note import route.

1. Check the signature of the raw body through a service, such as
   `WebhookSignature`.
2. Decode the body with a schema. A body that does not decode gets 400.
3. Commit with `commitAsSystem`, keyed by the sender's event ID.
4. Ask for a job for slow or outside work, in the same transaction.

## Add a package with server code

1. Run `mise exec -- bun nx g @tools/generators:package <name>
   --sections=types,models,commands,repo,runtime --record=<record>
   --group=<group>`. It registers the package's migrations in
   `apps/api/src/packages.ts`.
2. Add a command with the `command` generator. It registers the server change.
   Add a job with `mise exec -- bun nx g @tools/generators:job <name> <job>`.
   It registers the job in the package and in the server app.
3. Run `mise exec -- bun nx run @repo/<name>:db-generate` after each table
   change.
   Only drizzle-kit writes migrations.

## What to read when changing it

- `apps/api/src/main.ts` and `apps/api/src/server.ts`
- `packages/sync/service/event-log.ts` and `packages/sync/runtime/server.server.ts`
- [Lint rules for Effect code](../setup/lint-rules.md#effect-code)
- [API errors](./api-errors.md)

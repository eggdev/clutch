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

A service is the interface of a capability. Its Live Layer uses the real
vendor, and its Test Layer uses a fake. Both satisfy the same service, so a
change of vendor is a new Layer and one line in the composition root. See
[generic platform](../../principles/generic-platform.md).

```ts
export class CurrentActor extends Context.Service<CurrentActor, Actor>()('identity/CurrentActor') {}
```

`packages/identity` shows the pattern. `service/current-actor.ts` declares the
service. `runtime/dev.server.ts` builds it from `config/dev.ts`, and
`testing/actor.ts` builds it for tests.

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

## Add a package with server code

1. Run `mise exec -- bun nx g @tools/generators:package <name>
   --sections=types,models,commands,repo,runtime --record=<record>`. It
   registers the package's migrations in `apps/api/src/packages.ts`.
2. Add a command with the `command` generator. It registers the server change.
3. Run `mise exec -- bun nx run <name>:db-generate` after each table change.
   Only drizzle-kit writes migrations.

## What to read when changing it

- `apps/api/src/main.ts` and `apps/api/src/server.ts`
- `packages/sync/service/event-log.ts` and `packages/sync/runtime/server.server.ts`
- [Lint rules for Effect code](../setup/lint-rules.md#effect-code)
- [API errors](./api-errors.md)

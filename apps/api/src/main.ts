import { mkdirSync } from 'node:fs';

import { BunHttpServer, BunRuntime } from '@effect/platform-bun';
import { CurrentActorDev } from '@repo/identity/runtime/dev.server';
import { DatabasePglite, DatabasePostgres } from '@repo/sync/runtime/database.server';
import { Config, Effect, Layer, Option } from 'effect';

import { api } from '@/server';

/**
 * The composition root of the API. It selects each Layer: Postgres when
 * `DATABASE_URL` is set, otherwise PGlite in `.data/pglite`, so local
 * development needs no database server.
 */
const database = Layer.unwrap(
  Effect.gen(function* () {
    const url = yield* Config.option(Config.String('DATABASE_URL'));
    const dataDir = yield* Config.String('PGLITE_DIR').pipe(Config.withDefault('.data/pglite'));
    if (Option.isSome(url)) {
      return DatabasePostgres(url.value);
    }
    // PGlite creates its folder but not the folders above it.
    mkdirSync(dataDir, { recursive: true });
    return DatabasePglite(dataDir);
  }),
);

const http = Layer.unwrap(
  Effect.map(Config.Port('PORT').pipe(Config.withDefault(4000)), (port) =>
    BunHttpServer.layer({ port }),
  ),
);

BunRuntime.runMain(
  Layer.launch(api(database).pipe(Layer.provide(CurrentActorDev), Layer.provide(http))),
);

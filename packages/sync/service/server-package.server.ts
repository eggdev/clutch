import type { ServerChange } from '@repo/sync/commands/server-change.server';
import type { Complete, Contract, Undeclared } from '@repo/sync/contract/define';
import { checkHalves } from '@repo/sync/contract/halves';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import type { RunnableJob } from '@repo/sync/service/jobs';
import type { Route } from '@repo/sync/service/routes';
import type { Effect } from 'effect';

/** The migration of one package's tables. The server app runs each one at its start. */
export type Migration = (db: DrizzleDatabase) => Effect.Effect<void, unknown>;

/**
 * The server half of one package: its contract, and the server change, job and
 * HTTP route of each name that the contract declares. The server app lists it
 * in `runtime/server.server.ts`, and `serverOf` gives the sync server its parts.
 */
export type ServerPackage<
  Changes extends ReadonlyArray<ServerChange<unknown>> = ReadonlyArray<ServerChange<unknown>>,
  Jobs extends ReadonlyArray<RunnableJob<unknown>> = ReadonlyArray<RunnableJob<unknown>>,
  Routes extends ReadonlyArray<Route<unknown>> = ReadonlyArray<Route<unknown>>,
> = {
  readonly kind: 'server-package';
  readonly contract: Contract;
  readonly changes: Changes;
  readonly jobs: Jobs;
  readonly routes: Routes;
  readonly migrate: Migration | null;
};

/** The names that one list of a contract declares, such as its commands. */
type Named<List extends ReadonlyArray<{ readonly name: string }>> = List[number]['name'];

const noParts: readonly [] = [];

/**
 * The jobs list of a package. The list is required when the contract declares a
 * job, so a missing job fails to compile. A contract with no job may leave it out.
 */
type JobsPart<Declared extends Contract, Jobs extends ReadonlyArray<RunnableJob<unknown>>> = [
  Named<Declared['jobs']>,
] extends [never]
  ? { readonly jobs?: Jobs & Undeclared<never, Jobs> }
  : {
      readonly jobs: Jobs &
        Complete<Named<Declared['jobs']>, Jobs> &
        Undeclared<Named<Declared['jobs']>, Jobs>;
    };

/**
 * The routes list of a package. The list is required when the contract declares
 * a route, so a missing route fails to compile. A contract with no route may
 * leave it out.
 */
type RoutesPart<Declared extends Contract, Routes extends ReadonlyArray<Route<unknown>>> = [
  Named<Declared['routes']>,
] extends [never]
  ? { readonly routes?: Routes & Undeclared<never, Routes> }
  : {
      readonly routes: Routes &
        Complete<Named<Declared['routes']>, Routes> &
        Undeclared<Named<Declared['routes']>, Routes>;
    };

/**
 * Defines the server half of a package. Each command of the contract needs a
 * server change, each job a runner and each route its code. An entry that the
 * contract does not declare is refused too. Each mismatch fails to compile, and
 * also throws when the module loads. `migrate` runs the package's migrations
 * and may be left out when the package has no tables.
 */
export function serverPackage<
  const Declared extends Contract,
  const Changes extends ReadonlyArray<ServerChange<unknown>>,
  const Jobs extends ReadonlyArray<RunnableJob<unknown>> = readonly [],
  const Routes extends ReadonlyArray<Route<unknown>> = readonly [],
>(
  contract: Declared,
  parts: {
    readonly changes: Changes &
      Complete<Named<Declared['commands']>, Changes> &
      Undeclared<Named<Declared['commands']>, Changes>;
    readonly migrate?: Migration;
  } & JobsPart<Declared, Jobs> &
    RoutesPart<Declared, Routes>,
): ServerPackage<Changes, Jobs | readonly [], Routes | readonly []> {
  checkHalves(
    contract.name,
    'server change',
    contract.commands.map((declared) => declared.name),
    parts.changes.map((change) => change.name),
  );
  const jobs = parts.jobs ?? noParts;
  checkHalves(
    contract.name,
    'job',
    contract.jobs.map((declared) => declared.name),
    jobs.map((job) => job.name),
  );
  const routes = parts.routes ?? noParts;
  checkHalves(
    contract.name,
    'route',
    contract.routes.map((declared) => declared.name),
    routes.map((route) => route.name),
  );
  return {
    kind: 'server-package',
    contract,
    changes: parts.changes,
    jobs,
    routes,
    migrate: parts.migrate ?? null,
  };
}

/**
 * The parts of a list of server packages that the server app passes to the sync
 * server, the job runner and the HTTP router. Each type keeps the services of
 * its parts, so a server app that does not provide one fails to compile.
 */
export function serverOf<const Packages extends ReadonlyArray<ServerPackage>>(
  packages: Packages,
): {
  readonly contracts: Array<Contract>;
  readonly serverChanges: Array<Packages[number]['changes'][number]>;
  readonly jobs: Array<Packages[number]['jobs'][number]>;
  readonly routes: Array<Packages[number]['routes'][number]>;
  readonly migrations: Array<Migration>;
} {
  return {
    contracts: packages.map((entry) => entry.contract),
    serverChanges: packages.flatMap((entry) => entry.changes),
    jobs: packages.flatMap((entry) => entry.jobs),
    routes: packages.flatMap((entry) => entry.routes),
    migrations: packages.flatMap((entry) => (entry.migrate ? [entry.migrate] : [])),
  };
}

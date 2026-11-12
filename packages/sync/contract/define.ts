import type { CommandDeclaration, Replayable } from '@repo/sync/contract/command';
import type { JobDeclaration } from '@repo/sync/contract/job';
import type { Load, RecordDeclaration } from '@repo/sync/contract/record';
import type { RouteDeclaration } from '@repo/sync/contract/route';

type AnyCommand = CommandDeclaration;

/**
 * The contract of one package: each record it owns, each command that changes
 * them, each load function, and each job and HTTP route it declares. It is
 * the one declaration of what the package offers. The object pool, the
 * server, the manifest and each tool read it.
 */
export type Contract<
  Name extends string = string,
  Records extends ReadonlyArray<RecordDeclaration> = ReadonlyArray<RecordDeclaration>,
  Commands extends ReadonlyArray<AnyCommand> = ReadonlyArray<AnyCommand>,
  Loads extends ReadonlyArray<Load> = ReadonlyArray<Load>,
  Jobs extends ReadonlyArray<JobDeclaration> = ReadonlyArray<JobDeclaration>,
  Routes extends ReadonlyArray<RouteDeclaration> = ReadonlyArray<RouteDeclaration>,
> = {
  readonly kind: 'contract';
  readonly name: Name;
  readonly records: Records;
  readonly commands: Commands;
  readonly loads: Loads;
  readonly jobs: Jobs;
  readonly routes: Routes;
};

const contractName = /^[a-z][a-z0-9-]*$/u;

/** What a contract with no jobs or no routes holds: nothing. */
const noParts: readonly [] = [];

/** Each name that a list holds more than once, named once. */
function repeated(names: ReadonlyArray<string>): Array<string> {
  return [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
}

/**
 * Defines the contract of a package. Each command name starts with the name
 * of the contract, and no name repeats. A contract that breaks a rule fails
 * when its module loads. The error lists each problem of the contract with
 * its fix, so one run shows them all.
 */
export function defineContract<
  const Name extends string,
  const Records extends ReadonlyArray<RecordDeclaration>,
  const Commands extends ReadonlyArray<AnyCommand>,
  const Loads extends ReadonlyArray<Load>,
  const Jobs extends ReadonlyArray<JobDeclaration> = readonly [],
  const Routes extends ReadonlyArray<RouteDeclaration> = readonly [],
>(
  name: Name,
  parts: {
    readonly records: Records;
    readonly commands: Commands;
    readonly loads: Loads;
    readonly jobs?: Jobs;
    readonly routes?: Routes;
  },
): Contract<Name, Records, Commands, Loads, Jobs | readonly [], Routes | readonly []> {
  const problems: Array<string> = [];
  if (!contractName.test(name)) {
    problems.push(`The contract name "${name}" is not kebab case, such as \`notes\`.`);
  }
  const jobs: ReadonlyArray<JobDeclaration> = parts.jobs ?? [];
  const routes: ReadonlyArray<RouteDeclaration> = parts.routes ?? [];
  const named = [
    ...parts.commands.map((declared) => ({ noun: 'command', name: declared.name })),
    ...jobs.map((declared) => ({ noun: 'job', name: declared.name })),
    ...routes.map((declared) => ({ noun: 'route', name: declared.name })),
  ];
  for (const outside of named.filter((declared) => !declared.name.startsWith(`${name}/`))) {
    problems.push(
      `The ${outside.noun} ${outside.name} is in the contract ${name}, so its name starts with \`${name}/\`.`,
    );
  }
  const lists = [parts.commands, parts.records, parts.loads, jobs, routes];
  for (const twice of lists.flatMap((list) => repeated(list.map((declared) => declared.name)))) {
    problems.push(`The contract ${name} declares ${twice} twice. Each name is declared once.`);
  }
  const twins = routes.filter(
    (declared, index) =>
      routes.findIndex(
        (other) => other.method === declared.method && other.path === declared.path,
      ) !== index,
  );
  for (const twin of twins) {
    problems.push(
      `The route ${twin.name} has the method ${twin.method} and the path ${twin.path}, which another route of ${name} has. Give one of them another path.`,
    );
  }
  const records = new Set(parts.records.map((declared) => declared.name));
  for (const stray of parts.loads.filter((declared) => !records.has(declared.record))) {
    problems.push(
      `The load function ${stray.name} loads ${stray.record}, which the contract ${name} does not declare. Add the record to \`records\`.`,
    );
  }
  if (problems.length) {
    // A part that is listed twice breaks one rule twice. Each sentence shows once.
    throw new Error([...new Set(problems)].join('\n'));
  }
  return {
    kind: 'contract',
    name,
    ...parts,
    jobs: parts.jobs ?? noParts,
    routes: parts.routes ?? noParts,
  };
}

/** Whether a value is a contract. The manifest uses it to find the contracts that a module exports. */
export function isContract(value: unknown): value is Contract {
  return typeof value === 'object' && value !== null && Reflect.get(value, 'kind') === 'contract';
}

/** The list of a contract that holds each kind of declared part. */
const listOf = {
  record: 'records',
  command: 'commands',
  load: 'loads',
  job: 'jobs',
  route: 'routes',
} as const;

type PartKind = keyof typeof listOf;

/** One declared part: what `record`, `command`, `load`, `job` or `route` returns. */
type Part = { readonly kind: PartKind; readonly name: string };

function isPart(value: unknown): value is Part {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.hasOwn(listOf, String(Reflect.get(value, 'kind'))) &&
    typeof Reflect.get(value, 'name') === 'string'
  );
}

/**
 * The declared parts among the exports of a package's contract files that
 * its contract does not list. Such a part is in no manifest, so nothing
 * checks it. Each one names the list of the contract that it belongs in. A
 * contract file may also export plain values, such as a limit: they are not
 * parts.
 */
export function unlistedParts(
  exported: ReadonlyArray<unknown>,
  contract?: Contract,
): Array<{ readonly kind: PartKind; readonly name: string; readonly list: string }> {
  const listed = new Set<unknown>(
    contract
      ? [
          ...contract.records,
          ...contract.commands,
          ...contract.loads,
          ...contract.jobs,
          ...contract.routes,
        ]
      : [],
  );
  return exported
    .filter((value) => isPart(value))
    .filter((part) => !listed.has(part))
    .map((part) => ({ kind: part.kind, name: part.name, list: listOf[part.kind] }));
}

/** The names of the commands of a contract that show at once, so each needs a local change. */
type LocalName<Commands extends ReadonlyArray<AnyCommand>> = Extract<
  Commands[number],
  { readonly waits: 'local' }
>['name'];

/**
 * What a list of halves lacks. When each name has its half, this adds
 * nothing. Otherwise the list fails to compile, and the error names the
 * commands with no half.
 */
export type Complete<
  Needed extends string,
  Halves extends ReadonlyArray<{ readonly name: string }>,
> = [Exclude<Needed, Halves[number]['name']>] extends [never]
  ? unknown
  : { readonly missingHalfOf: Exclude<Needed, Halves[number]['name']> };

/**
 * The names in a list of halves that the contract does not declare. When each
 * name is declared, this adds nothing. Otherwise the list fails to compile.
 */
export type Undeclared<
  Declared extends string,
  Halves extends ReadonlyArray<{ readonly name: string }>,
> = [Exclude<Halves[number]['name'], Declared>] extends [never]
  ? unknown
  : { readonly notDeclaredBy: Exclude<Halves[number]['name'], Declared> };

/** The names in `needed` that `halves` lacks, and the names in `halves` that `needed` lacks. */
export function unmatched(needed: ReadonlyArray<string>, halves: ReadonlyArray<string>) {
  return {
    missing: needed.filter((name) => !halves.includes(name)),
    extra: halves.filter((name) => !needed.includes(name)),
  };
}

/**
 * The client half of one package: its contract, and the local change of each
 * command of the contract that shows at once. The client app lists it in
 * `runtime/client.ts`, and `clientOf` gives the object pool its parts.
 */
export type ClientPackage<
  C extends Contract = Contract,
  Halves extends ReadonlyArray<Replayable> = ReadonlyArray<Replayable>,
> = {
  readonly kind: 'client-package';
  readonly contract: C;
  readonly localChanges: Halves;
};

/**
 * Defines the client half of a package from its contract and the local change
 * of each command that shows at once. A command with `waits: 'local'` and no
 * local change does not compile, and the mismatch also throws when the module
 * loads.
 */
export function clientPackage<
  const C extends Contract,
  const Halves extends ReadonlyArray<Replayable>,
>(
  contract: C,
  halves: Halves & Complete<LocalName<C['commands']>, Halves>,
): ClientPackage<C, Halves> {
  const needed = contract.commands
    .filter((declared) => declared.waits === 'local')
    .map((declared) => declared.name);
  const { missing, extra } = unmatched(
    needed,
    halves.map((half) => half.name),
  );
  if (missing.length || extra.length) {
    throw new Error(
      [
        `The local changes of the contract ${contract.name} do not match its commands.`,
        ...missing.map((name) => `${name} shows at once and has no local change. Add it.`),
        ...extra.map(
          (name) => `${name} is not a command of this contract that shows at once. Remove it.`,
        ),
      ].join(' '),
    );
  }
  return { kind: 'client-package', contract, localChanges: halves };
}

/**
 * The parts of a list of client packages that the object pool and the sync
 * client take: each contract, and the local change of each command.
 */
export function clientOf(packages: ReadonlyArray<ClientPackage>): {
  readonly contracts: Array<Contract>;
  readonly commands: Array<Replayable>;
} {
  return {
    contracts: packages.map((entry) => entry.contract),
    commands: packages.flatMap((entry) => entry.localChanges),
  };
}

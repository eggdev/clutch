import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ManifestChange } from '@repo/sync/contract/change-doors';
import type { compareManifests } from '@repo/sync/contract/compatibility';
import type { Contract, isContract, unlistedParts } from '@repo/sync/contract/define';
import type { Manifest, manifestOf } from '@repo/sync/contract/manifest';
import { findBase } from '@tools/check-base';

/**
 * The contract check. It loads the contract of each package, builds the
 * manifest, and holds the committed `contract.json` to it, so a change to
 * what the app offers on the wire is a reviewed diff. A one-way change from
 * the base branch passes only when the snapshot names it under `breaks`. See
 * docs/contributing/architecture/contract.md.
 *
 * The engine is `packages/sync/contract/`. This file loads it at run time, and
 * takes its types from it, so the check reads the same code as the app and
 * holds no second copy of a rule or a shape. A repository with no contract
 * engine has nothing to check.
 */

/** The committed snapshot: the manifest, the digest of its base, and each one-way change since. */
export type Snapshot = Manifest & {
  readonly since: string | null;
  readonly breaks: ReadonlyArray<string>;
};

/** The functions of the engine that the check calls, with the engine's own types. */
type Engine = {
  readonly isContract: typeof isContract;
  readonly unlistedParts: typeof unlistedParts;
  readonly manifestOf: typeof manifestOf;
  readonly compareManifests: typeof compareManifests;
};

const snapshotFile = 'contract.json';
const write = 'mise exec -- bun tools/check-contract.ts --write';

/** Loads the contract engine from `packages/sync/contract/`, or nothing when the repository has none. */
async function loadEngine(root: string): Promise<Engine | null> {
  const folder = path.join(root, 'packages/sync/contract');
  if (!existsSync(path.join(folder, 'manifest.ts'))) {
    return null;
  }
  const [define, manifest, compatibility] = await Promise.all([
    import(path.join(folder, 'define.ts')),
    import(path.join(folder, 'manifest.ts')),
    import(path.join(folder, 'compatibility.ts')),
  ]);
  return {
    isContract: define.isContract,
    unlistedParts: define.unlistedParts,
    manifestOf: manifest.manifestOf,
    compareManifests: compatibility.compareManifests,
  };
}

/** The folders under `parent` in `root`, by name. A missing parent has none. */
function folders(root: string, parent: string): Array<string> {
  try {
    return readdirSync(path.join(root, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
      .map((entry) => entry.name)
      .toSorted();
  } catch {
    return [];
  }
}

/** The contract modules of one package: each `.ts` file of its `contract/`, but no test and no server file. */
function contractFiles(root: string, name: string): Array<string> {
  const folder = path.join(root, 'packages', name, 'contract');
  if (!existsSync(folder)) {
    return [];
  }
  return readdirSync(folder)
    .filter((file) => file.endsWith('.ts') && !/\.(?:test|server)\.ts$/u.test(file))
    .toSorted()
    .map((file) => path.join(folder, file));
}

/** The lines of the message of an error from a module that failed to load. */
const errorLines = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split('\n');

/** Each value that the module at `file` exports. */
async function exportsOf(file: string): Promise<Array<unknown>> {
  return Object.values(await import(file));
}

/**
 * The contract of each package, with the problems of its declaration. The
 * engine in `packages/sync` declares none: its `contract/` holds the helpers.
 */
async function loadContracts(root: string, engine: Engine) {
  const contracts: Array<Contract> = [];
  const problems: Array<string> = [];
  for (const name of folders(root, 'packages')) {
    const files = name === 'sync' ? [] : contractFiles(root, name);
    const exported: Array<unknown> = [];
    for (const file of files) {
      try {
        exported.push(...(await exportsOf(file)));
      } catch (error) {
        // A contract that breaks a rule fails as it loads, and its message lists each problem.
        problems.push(...errorLines(error).map((line) => `${path.relative(root, file)}: ${line}`));
      }
    }
    const found = exported.filter((value) => engine.isContract(value));
    const folder = `packages/${name}/contract/`;
    if (found.length > 1) {
      problems.push(
        `${folder}: exports ${found.length} contracts. A package has one. Export it from \`contract/${name}.ts\` with \`defineContract('${name}', ...)\`.`,
      );
    }
    // A part outside the contract is in no manifest. A folder of plain values alone declares nothing.
    for (const part of engine.unlistedParts(exported, found[0])) {
      problems.push(
        found.length
          ? `${folder}: the ${part.kind} \`${part.name}\` is not in the contract. Add it to \`${part.list}\`.`
          : `${folder}: declares the ${part.kind} \`${part.name}\` and exports no contract. Export \`defineContract('${name}', ...)\` from \`contract/${name}.ts\`, and add it to \`${part.list}\`.`,
      );
    }
    for (const contract of found) {
      if (contract.name !== name) {
        problems.push(
          `${folder}: the contract is named \`${contract.name}\`. Name it \`${name}\`, after its package, so each command name starts with the package.`,
        );
      }
    }
    contracts.push(...found);
  }
  return { contracts, problems };
}

/**
 * The app files that list the packages: where an app gives them to the object
 * pool or to the sync server. A web app and a server app keep code in `src/`,
 * and a native app keeps it in `lib/`. `nx sync` writes each list.
 */
const appLists = ['src/packages.ts', 'lib/packages.ts'];

/** An app that lists packages must list each contract, or it cannot run or serve the commands of the rest. */
async function appProblems(root: string, engine: Engine, contracts: ReadonlyArray<Contract>) {
  const problems: Array<string> = [];
  for (const app of folders(root, 'apps')) {
    for (const list of appLists) {
      const file = path.join(root, 'apps', app, list);
      if (existsSync(file)) {
        // An app list imports each package, so a broken contract stops it as it loads.
        const loaded = await import(file).catch((error: unknown) => errorLines(error)[0]);
        if (typeof loaded === 'string') {
          problems.push(
            `apps/${app}/${list}: did not load, so its lists are not checked. ${loaded}`,
          );
          continue;
        }
        const { packages: listed } = loaded;
        if (Array.isArray(listed)) {
          const names = new Set(
            listed
              .filter((entry) => engine.isContract(entry?.contract))
              .map((entry) => entry.contract.name),
          );
          problems.push(
            ...contracts
              .filter((contract) => !names.has(contract.name))
              .map(
                (contract) =>
                  `apps/${app}/${list}: \`packages\` does not list the contract \`${contract.name}\`. Run \`nx sync\`, which writes the list from each package's runtime/client.ts or runtime/server.server.ts.`,
              ),
          );
        } else if (contracts.length) {
          problems.push(
            `apps/${app}/${list}: exports no \`packages\` list. Run \`nx sync\`, which writes it.`,
          );
        }
      }
    }
  }
  return problems;
}

/** The body of a manifest, as the snapshot holds it. */
const bodyOf = (manifest: Manifest) =>
  JSON.stringify([
    manifest.records,
    manifest.commands,
    manifest.loads,
    manifest.jobs,
    manifest.routes,
  ]);

/**
 * The problems of the committed snapshot. `base` is the manifest of the base
 * branch, or nothing when there is none to compare with. `changes` are the
 * differences from `base` to `manifest`.
 */
export function snapshotProblems(
  manifest: Manifest,
  committed: Snapshot | null,
  base: Manifest | null,
  changes: ReadonlyArray<ManifestChange>,
): Array<string> {
  if (!committed) {
    return [`${snapshotFile}: is missing. Run \`${write}\`, and commit it.`];
  }
  if (bodyOf(committed) !== bodyOf(manifest) || committed.digest !== manifest.digest) {
    return [
      `${snapshotFile}: does not match the contracts. Run \`${write}\`, read the diff, and commit it.`,
    ];
  }
  if (!base || base.digest === manifest.digest) {
    return [];
  }
  const oneWay = changes.filter((change) => change.door === 'one-way');
  const named = new Set(committed.breaks);
  const unnamed = oneWay.filter((change) => !named.has(change.id));
  if (unnamed.length) {
    return [
      `${snapshotFile}: this change is a one-way door for installed builds. See docs/principles/two-way-doors.md.`,
      ...unnamed.map((change) => `  ${change.id}: ${change.says}`),
      `  Keep the old shape, or add the new one beside it. When the owner agreed to the break, run \`${write} --accept-breaks\`.`,
    ];
  }
  const ids = new Set(oneWay.map((change) => change.id));
  if (committed.since !== base.digest || committed.breaks.some((id) => !ids.has(id))) {
    return [
      `${snapshotFile}: \`since\` and \`breaks\` do not describe the change from the base branch. Run \`${write}\`.`,
    ];
  }
  return [];
}

/** The snapshot that `git` holds at `base`, or nothing when the base has none. */
function snapshotAt(root: string, base: string): Snapshot | null {
  const run = Bun.spawnSync(['git', '-C', root, 'show', `${base}:${snapshotFile}`]);
  return run.exitCode === 0 ? JSON.parse(run.stdout.toString()) : null;
}

function committedSnapshot(root: string): Snapshot | null {
  const file = path.join(root, snapshotFile);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : null;
}

/**
 * Where a run reads from: the repository that holds the contract engine, and
 * the commit to compare with. A test of a scratch repository gives both.
 * Without them, the engine is in `root` and the base comes from `findBase`.
 */
export type Options = { readonly engineRoot?: string; readonly baseCommit?: string | null };

/** What the check reads of one repository: the manifest, the base and the changes between them. */
async function inspect(root: string, options: Options) {
  const engine = await loadEngine(options.engineRoot ?? root);
  if (!engine) {
    return null;
  }
  const { contracts, problems } = await loadContracts(root, engine);
  if (problems.length) {
    // The manifest of wrong contracts is wrong, so the snapshot waits. The apps
    // are still read, so one run reports each problem that it can.
    return {
      problems: [...problems, ...(await appProblems(root, engine, contracts))],
      manifest: null,
      base: null,
      changes: [],
    };
  }
  const manifest = engine.manifestOf(contracts);
  const baseCommit =
    options.baseCommit === undefined ? findBase(root, process.env.CHECK_BASE) : options.baseCommit;
  const base = baseCommit ? snapshotAt(root, baseCommit) : null;
  return {
    problems: await appProblems(root, engine, contracts),
    manifest,
    base,
    changes: base ? engine.compareManifests(base, manifest) : [],
  };
}

/** Whether a manifest lists nothing: no package of the repository declares a contract yet. */
const isEmpty = (manifest: Manifest) =>
  manifest.records.length +
    manifest.commands.length +
    manifest.loads.length +
    manifest.jobs.length +
    manifest.routes.length ===
  0;

/**
 * The problems of the contracts at `root`. A repository with the engine and
 * no contract yet has no snapshot to hold, so it passes until its first
 * package declares one.
 */
export async function checkContract(root: string, options: Options = {}): Promise<Array<string>> {
  const found = await inspect(root, options);
  if (!found) {
    return [];
  }
  if (!found.manifest) {
    return found.problems;
  }
  const committed = committedSnapshot(root);
  if (committed === null && isEmpty(found.manifest)) {
    return found.problems;
  }
  return [
    ...found.problems,
    ...snapshotProblems(found.manifest, committed, found.base, found.changes),
  ];
}

/**
 * Writes the snapshot. A one-way change is written only with `acceptBreaks`,
 * so the break is a choice that the diff shows. Returns the problems that
 * stopped the write.
 */
export async function writeSnapshot(
  root: string,
  acceptBreaks: boolean,
  options: Options = {},
): Promise<Array<string>> {
  const found = await inspect(root, options);
  if (!found?.manifest) {
    return found?.problems ?? [];
  }
  const oneWay = found.changes.filter((change) => change.door === 'one-way');
  if (oneWay.length && !acceptBreaks) {
    return [
      'This change is a one-way door for installed builds. See docs/principles/two-way-doors.md.',
      ...oneWay.map((change) => `  ${change.id}: ${change.says}`),
      `  Keep the old shape, or add the new one beside it. When the owner agreed to the break, run \`${write} --accept-breaks\`.`,
    ];
  }
  const { version, digest, records, commands, loads, jobs, routes } = found.manifest;
  const snapshot: Snapshot = {
    version,
    digest,
    since: found.base?.digest ?? null,
    breaks: oneWay.map((change) => change.id),
    records,
    commands,
    loads,
    jobs,
    routes,
  };
  const file = path.join(root, snapshotFile);
  writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
  // The repository formatter decides the layout, so `format-check` passes on the file as written.
  Bun.spawnSync([path.join(options.engineRoot ?? root, 'node_modules/.bin/oxfmt'), file]);
  for (const change of found.changes) {
    console.log(`${change.door}  ${change.id}: ${change.says}`);
  }
  return found.problems;
}

if (import.meta.main) {
  const root = process.cwd();
  const problems = process.argv.includes('--write')
    ? await writeSnapshot(root, process.argv.includes('--accept-breaks'))
    : await checkContract(root);
  if (problems.length) {
    console.error(
      [
        `Contract check failed (${problems.length}).`,
        `\`${snapshotFile}\` is what the app offers on the wire. Change a contract, then run \`${write}\`.`,
        'See docs/contributing/architecture/contract.md.',
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('The contract snapshot matches the contracts, and each app lists each contract.');
  }
}

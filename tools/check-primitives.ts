import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { parseRegistry, registryFile } from '@tools/lint/import-policy.mjs';
import { parse } from 'yaml';

/**
 * Checks the primitives registry: unique ids, known groups and kinds, real
 * paths, short summaries, vendors only on services, docs for each invariant,
 * and a primitive for each Nx project folder. See
 * docs/contributing/architecture/index.md#modules.
 */
const kinds = new Set(['service', 'domain', 'app', 'tool']);
const maxSummary = 120;

type Entry = {
  id?: string;
  group?: string;
  name?: string;
  kind?: string;
  summary?: string;
  code?: Array<string>;
  docs?: Array<string>;
  vendors?: Array<unknown>;
  primitives?: Array<string>;
};
type Registry = {
  groups?: Array<Entry>;
  primitives?: Array<Entry>;
  layers?: Array<Entry>;
  invariants?: Array<Entry>;
};

/** The duplicate ids in a list, each named once. */
function duplicates(entries: Array<Entry>): Array<string> {
  const ids = entries.map((entry) => String(entry.id));
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
}

/** A one-line summary of at most 120 characters, or the problem with it. */
function summaryProblem(summary: string | undefined): string | null {
  if (!summary?.trim()) {
    return 'has no `summary`. Add one line that says what it is.';
  }
  if (summary.trim().includes('\n')) {
    return 'has a `summary` over one line. Keep one line, and move the detail into its docs.';
  }
  if (summary.length > maxSummary) {
    return `has a \`summary\` of ${summary.length} characters. Keep it at ${maxSummary} or less, and move the detail into its docs.`;
  }
  return null;
}

/** Each folder under `apps/` and `packages/` that has a package.json. */
function projectFolders(root: string): Array<string> {
  return ['apps', 'packages'].flatMap((parent) =>
    existsSync(path.join(root, parent))
      ? readdirSync(path.join(root, parent), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => `${parent}/${entry.name}/`)
          .filter((folder) => existsSync(path.join(root, folder, 'package.json')))
      : [],
  );
}

/** The problems with the paths that do not exist under `root`. A `#anchor` is ignored. */
function missingPaths(root: string, targets: Array<string>): Array<string> {
  return targets
    .filter((target) => !existsSync(path.join(root, target.replace(/#.*$/u, ''))))
    .map((target) => `names \`${target}\`, which does not exist. Fix the path, or remove it.`);
}

/** The problems with one primitive. */
function primitiveProblems(root: string, primitive: Entry, groups: Set<unknown>): Array<string> {
  return [
    !groups.has(primitive.group) &&
      `names the unknown group \`${primitive.group}\`. Add it under \`groups\`, or use one there.`,
    !kinds.has(String(primitive.kind)) &&
      `has the kind \`${primitive.kind}\`. Use one of ${[...kinds].join(', ')}.`,
    summaryProblem(primitive.summary),
    !primitive.code?.length && 'has no `code` roots. Name the folders it owns.',
    ...missingPaths(root, [...(primitive.code ?? []), ...(primitive.docs ?? [])]),
    !!primitive.vendors?.length &&
      primitive.kind !== 'service' &&
      'lists vendors, but only a service owns a vendor. Move each vendor into a service.',
  ].filter((problem): problem is string => typeof problem === 'string');
}

/** The problems with one invariant. */
function invariantProblems(root: string, invariant: Entry): Array<string> {
  return [
    summaryProblem(invariant.summary),
    !invariant.docs?.length &&
      'has no `docs`. Link the page that states it, such as docs/contributing/project-intent.md#hard-invariants.',
    ...missingPaths(root, invariant.docs ?? []),
  ].filter((problem): problem is string => typeof problem === 'string');
}

/** Each error in the registry, after its exceptions and patterns parse. */
function registryProblems(root: string, registry: Registry): Array<string> {
  const groups = registry.groups ?? [];
  const primitives = registry.primitives ?? [];
  const invariants = registry.invariants ?? [];
  const problems = (['group', 'primitive', 'invariant'] as const).flatMap((list, index) =>
    duplicates([groups, primitives, invariants][index]).map((id): [string, string] => [
      `${list} \`${id}\``,
      'appears more than once. Give each entry its own id.',
    ]),
  );
  const groupIds = new Set<unknown>(groups.map((group) => group.id));
  for (const primitive of primitives) {
    for (const problem of primitiveProblems(root, primitive, groupIds)) {
      problems.push([`primitive \`${primitive.id}\``, problem]);
    }
  }
  const primitiveIds = new Set(primitives.map((primitive) => primitive.id));
  for (const [index, layer] of (registry.layers ?? []).entries()) {
    for (const id of (layer.primitives ?? []).filter((name) => !primitiveIds.has(name))) {
      problems.push([
        `layers[${index}]`,
        `names the unknown primitive \`${id}\`. Use an id under \`primitives\`.`,
      ]);
    }
  }
  for (const invariant of invariants) {
    for (const problem of invariantProblems(root, invariant)) {
      problems.push([`invariant \`${invariant.id}\``, problem]);
    }
  }
  const roots = primitives.flatMap((primitive) => primitive.code ?? []);
  for (const folder of projectFolders(root)) {
    if (!roots.some((code) => folder.startsWith(code) || code.startsWith(folder))) {
      problems.push([
        `no primitive owns the Nx project \`${folder}\`.`,
        `Add a primitive with \`${folder}\` in its \`code\`.`,
      ]);
    }
  }
  return problems.map(([entry, problem]) => `${registryFile}: ${entry} ${problem}`);
}

export async function checkPrimitives(root: string): Promise<Array<string>> {
  const file = path.join(root, registryFile);
  if (!existsSync(file)) {
    return [`${registryFile}: the file is missing. Restore it from the project template.`];
  }
  const registry: Registry = parse(await Bun.file(file).text()) ?? {};
  const errors: Array<string> = [];
  try {
    parseRegistry(registry);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return [...errors, ...registryProblems(root, registry)];
}

if (import.meta.main) {
  const errors = await checkPrimitives(process.cwd());
  if (errors.length) {
    console.error(
      [
        `Primitives check failed (${errors.length}).`,
        `Fix each entry below in ${registryFile}. See docs/contributing/architecture/index.md#modules.`,
        '',
        ...errors,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('Each primitive has a known group and kind, real paths and a short summary.');
  }
}

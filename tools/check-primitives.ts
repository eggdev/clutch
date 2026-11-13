import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { journeys } from '@tools/journeys/journeys';
import { parseRegistry, readRegistry, registryFile } from '@tools/lint/import-policy.mjs';

/**
 * Checks the primitives registry: unique ids, known groups and kinds, real
 * paths, short summaries, vendors only on packages, docs and a journey for
 * each invariant, and a primitive for each Nx project folder. See
 * docs/contributing/architecture/index.md#modules.
 */
const kinds = new Set(['package', 'feature', 'app', 'tool']);
const maxSummary = 120;

/** The `journey` of an invariant whose journey is not written yet. */
export const notWritten = 'not-written';
/** The ratchet in `.clutch/ratchets.json` that counts the invariants with no journey yet. */
export const journeyRatchet = 'invariants-without-journey';
const ratchetsFile = '.clutch/ratchets.json';
const countCommand = 'bun tools/check-primitives.ts --count';
const addRatchet = `mise exec -- bun run clutch ratchet add ${journeyRatchet} --command '${countCommand}' --files ${registryFile}`;

type Entry = {
  id?: string;
  group?: string;
  name?: string;
  kind?: string;
  summary?: string;
  code?: Array<string>;
  docs?: Array<string>;
  journey?: unknown;
  vendors?: Array<unknown>;
  primitives?: Array<string>;
};
type Registry = {
  groups?: Array<Entry>;
  primitives?: Array<Entry>;
  languages?: Array<Entry>;
  layers?: unknown;
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

/** Each folder under `apps/`, `features/` and `packages/` that has a package.json. */
function projectFolders(root: string): Array<string> {
  return ['apps', 'features', 'packages'].flatMap((parent) =>
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
      primitive.kind !== 'package' &&
      'lists vendors, but only a package owns a vendor. Move each vendor into a package.',
  ].filter((problem): problem is string => typeof problem === 'string');
}

/** The problem with the `journey` of one invariant, given the ids of the journeys on disk. */
function journeyProblem(invariant: Entry, journeyIds: Set<string>): string | null {
  const { journey } = invariant;
  if (typeof journey !== 'string' || !journey.trim()) {
    return `has no \`journey\`. Name the journey that proves it, or write \`journey: ${notWritten}\` until that journey exists.`;
  }
  if (journey !== notWritten && !journeyIds.has(journey)) {
    return `names the journey \`${journey}\`, which does not exist. Name the id of a journey in features/<feature>/journeys/, or write \`journey: ${notWritten}\`.`;
  }
  return null;
}

/** The problems with one invariant. */
function invariantProblems(root: string, invariant: Entry, journeyIds: Set<string>): Array<string> {
  return [
    summaryProblem(invariant.summary),
    !invariant.docs?.length &&
      'has no `docs`. Link the page that states it, such as docs/contributing/project-intent.md#hard-invariants.',
    ...missingPaths(root, invariant.docs ?? []),
    journeyProblem(invariant, journeyIds),
  ].filter((problem): problem is string => typeof problem === 'string');
}

/** How many invariants say that their journey is not written yet. */
function countNotWritten(registry: Registry): number {
  return (registry.invariants ?? []).filter((invariant) => invariant.journey === notWritten).length;
}

/** The start of a count problem, such as "has 2 entries with `journey: not-written`". */
const entries = (count: number) =>
  `has ${count} ${count === 1 ? 'entry' : 'entries'} with \`journey: ${notWritten}\``;

/**
 * The problem with the count of invariants that have no journey yet. The
 * ratchet `invariants-without-journey` in `.clutch/ratchets.json` holds the
 * count, and `clutch ratchet check` lets it go down but never up. This check
 * asks for the ratchet once the count is above 0, and fails a count above its
 * baseline. See docs/contributing/capabilities/ratchets.md.
 */
function countProblem(root: string, count: number): string | null {
  if (count === 0) {
    return null;
  }
  const file = path.join(root, ratchetsFile);
  const ratchets = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf-8')) as {
        ratchets?: Record<string, { counts?: Record<string, number> }>;
      })
    : {};
  const ratchet = ratchets.ratchets?.[journeyRatchet];
  if (!ratchet) {
    return `${entries(count)}, and ${ratchetsFile} has no \`${journeyRatchet}\` ratchet to hold that count. Add it: ${addRatchet}`;
  }
  const baseline = ratchet.counts?.[registryFile] ?? 0;
  if (count > baseline) {
    return `${entries(count)}, but the \`${journeyRatchet}\` ratchet allows ${baseline}. The count only goes down. Write the journey of each new invariant first.`;
  }
  return null;
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
  if (registry.layers !== undefined) {
    problems.push([
      '`layers`',
      'is the old name of `languages`. Rename the key. In Effect code, "Layer" means an Effect Layer only.',
    ]);
  }
  for (const [index, language] of (registry.languages ?? []).entries()) {
    for (const id of (language.primitives ?? []).filter((name) => !primitiveIds.has(name))) {
      problems.push([
        `languages[${index}]`,
        `names the unknown primitive \`${id}\`. Use an id under \`primitives\`.`,
      ]);
    }
  }
  const journeyIds = new Set(journeys(root).map((journey) => journey.id));
  for (const invariant of invariants) {
    for (const problem of invariantProblems(root, invariant, journeyIds)) {
      problems.push([`invariant \`${invariant.id}\``, problem]);
    }
  }
  const count = countProblem(root, countNotWritten(registry));
  if (count) {
    problems.push(['`invariants`', count]);
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

export function checkPrimitives(root: string): Array<string> {
  const registry: Registry | null = readRegistry(root);
  if (!registry) {
    return [`${registryFile}: the file is missing. Restore it from Clutch.`];
  }
  const errors: Array<string> = [];
  try {
    parseRegistry(registry);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return [...errors, ...registryProblems(root, registry)];
}

/**
 * Prints `path:count` for the ratchet `invariants-without-journey`: the
 * registry and how many of its invariants have no journey yet. It prints
 * nothing when the count is 0.
 */
export function journeyCount(root: string): Array<string> {
  const registry: Registry | null = readRegistry(root);
  const count = registry ? countNotWritten(registry) : 0;
  return count > 0 ? [`${registryFile}:${count}`] : [];
}

if (import.meta.main && process.argv.includes('--count')) {
  const lines = journeyCount(process.cwd());
  if (lines.length > 0) {
    console.log(lines.join('\n'));
  }
} else if (import.meta.main) {
  const errors = checkPrimitives(process.cwd());
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
    console.log(
      'Each primitive has a known group and kind, real paths and a short summary. Each invariant names its journey.',
    );
  }
}

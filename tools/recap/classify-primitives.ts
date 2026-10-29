import { parseArgs } from 'node:util';

import { readRegistry, registryFile } from '@tools/lint/import-policy.mjs';

/**
 * Maps each changed path to the primitive in the registry whose `code` root is
 * the longest prefix of the path. The pr-recap skill reads the result. See
 * .agents/skills/pr-recap/SKILL.md.
 *
 * Usage: bun tools/recap/classify-primitives.ts --base <ref> [--head <ref>] [--json]
 */
type Primitive = { id: string; group?: string; code?: Array<string> };
type Invariant = { id: string; summary?: string };
type Registry = { primitives?: Array<Primitive>; invariants?: Array<Invariant> };

export type Touched = { id: string; group: string | null; files: Array<string> };
export type Classification = {
  touched: Array<Touched>;
  unmapped: Array<string>;
  invariants: Array<Invariant>;
};

/** A folder root owns the files under it. Any other root owns only itself. */
function owns(root: string, file: string): boolean {
  return root.endsWith('/') ? file.startsWith(root) : file === root;
}

/** The primitive with the longest root that owns the file, or null. */
function ownerOf(file: string, primitives: Array<Primitive>): Primitive | null {
  let owner: Primitive | null = null;
  let longest = 0;
  for (const primitive of primitives) {
    for (const root of primitive.code ?? []) {
      if (owns(root, file) && root.length > longest) {
        owner = primitive;
        longest = root.length;
      }
    }
  }
  return owner;
}

/** Reads the registry under `root` and maps each path to the primitive that owns it. */
export function classify(root: string, paths: Array<string>): Classification {
  const registry: Registry | null = readRegistry(root);
  if (!registry) {
    throw new Error(`${registryFile} is missing. Restore it from Clutch.`);
  }
  const primitives = registry.primitives ?? [];
  const touched = new Map<string, Touched>();
  const unmapped: Array<string> = [];
  for (const changed of paths) {
    const owner = ownerOf(changed, primitives);
    if (!owner) {
      unmapped.push(changed);
      continue;
    }
    const entry = touched.get(owner.id) ?? { id: owner.id, group: owner.group ?? null, files: [] };
    entry.files.push(changed);
    touched.set(owner.id, entry);
  }
  return { touched: [...touched.values()], unmapped, invariants: registry.invariants ?? [] };
}

/** The standard output of a command, or an error that names the command and its message. */
function run(command: Array<string>): string {
  const result = Bun.spawnSync(command);
  if (result.exitCode !== 0) {
    throw new Error(`\`${command.join(' ')}\` failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

/** The Nx projects that the change affects, or null when Nx cannot tell. */
function affectedProjects(base: string, head: string): Array<string> | null {
  try {
    const output = run([
      process.execPath,
      'x',
      'nx',
      'show',
      'projects',
      '--affected',
      '--base',
      base,
      '--head',
      head,
      '--json',
    ]);
    return JSON.parse(output);
  } catch {
    return null;
  }
}

/** The report for a person or an agent to read. */
function format(range: string, result: Classification, projects: Array<string> | null): string {
  const touched = result.touched.length
    ? result.touched.flatMap((entry) => [
        `- ${entry.id} (${entry.group ?? 'no group'}): ${entry.files.length} file(s)`,
        ...entry.files.map((file) => `    ${file}`),
      ])
    : ['- No primitive owns a changed path.'];
  return [
    `Changed paths in ${range}, by primitive:`,
    '',
    ...touched,
    '',
    `Unmapped paths (${result.unmapped.length}):`,
    ...result.unmapped.map((file) => `    ${file}`),
    '',
    `Nx affected projects: ${projects?.join(', ') || 'Nx did not answer'}`,
    '',
    `Registry invariants (${result.invariants.length}):`,
    ...result.invariants.map((invariant) => `- ${invariant.id}: ${invariant.summary}`),
  ].join('\n');
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      base: { type: 'string', default: 'origin/main' },
      head: { type: 'string', default: 'HEAD' },
      json: { type: 'boolean', default: false },
    },
  });
  const range = `${values.base}...${values.head}`;
  const paths = run(['git', 'diff', '--name-only', range]).split('\n').filter(Boolean);
  const result = classify(process.cwd(), paths);
  const projects = affectedProjects(values.base, values.head);
  console.log(
    values.json
      ? JSON.stringify({ range, ...result, affectedProjects: projects }, null, 2)
      : format(range, result, projects),
  );
}

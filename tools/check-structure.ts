import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { ignoredByGit } from '@tools/check-file-size';
import { sections } from '@tools/lint/import-policy.mjs';

/**
 * The shape of each package and feature. A package has only section folders
 * and a few config files at its top. A feature has its gate, `screens/` and
 * `components/`. The generators make these shapes; this check rejects any
 * other. `check-primitives` checks that each one has a primitive. See
 * docs/contributing/architecture/index.md.
 */
const projectFiles = new Set([
  'package.json',
  'tsconfig.json',
  'tsconfig.lib.json',
  'tsconfig.spec.json',
  'README.md',
]);
const packageFiles = new Set([...projectFiles, 'drizzle.config.ts']);
const featureFolders = new Set(['screens', 'components']);
const skipped = new Set(['node_modules', 'out-tsc', 'dist']);

/** Each folder under `parent` with a package.json, as a repository path. */
function projects(root: string, parent: string): Array<string> {
  try {
    return readdirSync(path.join(root, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`)
      .filter((folder) => {
        try {
          return statSync(path.join(root, folder, 'package.json')).isFile();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

/** The top-level entries of a project that Git tracks or would track. */
function entries(root: string, folder: string) {
  const all = readdirSync(path.join(root, folder), { withFileTypes: true }).filter(
    (entry) => !skipped.has(entry.name) && entry.name !== '.gitkeep',
  );
  const ignored = ignoredByGit(
    root,
    all.map((entry) => `${folder}/${entry.name}`),
  );
  return all.filter((entry) => !ignored.has(`${folder}/${entry.name}`));
}

function packageProblems(root: string, folder: string): Array<string> {
  const names = Object.keys(sections).join(', ');
  return entries(root, folder)
    .filter((entry) =>
      entry.isDirectory() ? !Object.hasOwn(sections, entry.name) : !packageFiles.has(entry.name),
    )
    .map((entry) =>
      entry.isDirectory()
        ? `${folder}/${entry.name}/: not a section. Move the code into one of: ${names}.`
        : `${folder}/${entry.name}: a package keeps code in sections. Move the file into the section that owns it.`,
    );
}

function featureProblems(root: string, folder: string): Array<string> {
  const found = entries(root, folder);
  const problems = found
    .filter((entry) =>
      entry.isDirectory()
        ? !featureFolders.has(entry.name)
        : entry.name !== 'gate.ts' && !projectFiles.has(entry.name),
    )
    .map(
      (entry) =>
        `${folder}/${entry.name}${entry.isDirectory() ? '/' : ''}: a feature has only \`gate.ts\`, \`screens/\` and \`components/\`. Move shared code into a package.`,
    );
  if (!found.some((entry) => entry.name === 'gate.ts' && entry.isFile())) {
    problems.push(
      `${folder}: has no \`gate.ts\`. Each feature has one gate. See docs/principles/one-gate-per-feature.md.`,
    );
  }
  return problems;
}

export function checkStructure(root: string): Array<string> {
  return [
    ...projects(root, 'packages').flatMap((folder) => packageProblems(root, folder)),
    ...projects(root, 'features').flatMap((folder) => featureProblems(root, folder)),
  ].toSorted();
}

if (import.meta.main) {
  const problems = checkStructure(process.cwd());
  if (problems.length) {
    console.error(
      [
        `Structure check failed (${problems.length}).`,
        'A generator makes each shape: `nx g @tools/generators:package` or `:feature`.',
        'See docs/contributing/architecture/index.md.',
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('Each package has only sections, and each feature has its gate.');
  }
}

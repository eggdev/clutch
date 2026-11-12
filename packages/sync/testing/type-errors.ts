import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../../..');
const folders: Array<string> = [];

/**
 * Typechecks one source file against the real code of the repository, and
 * lists the output of each error. A test uses it to prove that a wrong call
 * does not compile, with no suppression comment in the test itself. The file
 * sits in `.data/`, so it reads the repository's aliases and never reaches a
 * commit. Call `removeTypeFixtures` after the tests.
 */
export async function typeErrors(source: string): Promise<Array<string>> {
  // A fresh checkout has no `.data/` yet.
  await mkdir(path.join(root, '.data'), { recursive: true });
  const folder = await mkdtemp(path.join(root, '.data', 'type-test-'));
  folders.push(folder);
  await writeFile(path.join(folder, 'fixture.ts'), source);
  await writeFile(
    path.join(folder, 'tsconfig.json'),
    JSON.stringify({
      extends: path.join(root, 'tsconfig.base.json'),
      compilerOptions: {
        noEmit: true,
        composite: false,
        emitDeclarationOnly: false,
        declarationMap: false,
      },
      files: ['fixture.ts'],
    }),
  );
  const run = Bun.spawnSync([
    path.join(root, 'node_modules/.bin/tsgo'),
    '-p',
    path.join(folder, 'tsconfig.json'),
    // Plain output: a terminal or a task runner can turn on colors, which
    // split the `error TS` text that this helper reads.
    '--pretty',
    'false',
  ]);
  return run.stdout
    .toString()
    .split(/\n(?=\S)/u)
    .filter((block) => block.includes('error TS'));
}

/** Removes each folder that `typeErrors` made. */
export async function removeTypeFixtures(): Promise<void> {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
}

/**
 * Takes the screenshots of a PR's CI run as the baselines:
 *
 *   mise exec -- bun run visual pull <pr>
 *
 * CI is the only renderer. The `journeys` job uploads each changed or new
 * screenshot as the `visual-screenshots` artifact, at its baseline path. This
 * copies them into the checkout. Commit them, and give the reason in the PR
 * body. See docs/contributing/setup/verification.md#screenshots.
 */
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { retrying } from '@tools/github/command';
import { must } from '@tools/github/github';
import type { Run } from '@tools/github/stack';

export const artifactName = 'visual-screenshots';

const usage = 'Usage: mise exec -- bun run visual pull <pr number>';

/** Each file under `folder`, as a path relative to it. */
async function filesIn(folder: string): Promise<Array<string>> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)))
    .toSorted();
  return files;
}

/** A baseline path: a PNG in a `__screenshots__` folder, inside the repository. */
export const isBaseline = (file: string) =>
  /(?:^|\/)__screenshots__\/[^/]+\.png$/u.test(file) && !file.split('/').includes('..');

/** Copies each baseline in `from` to `root`. Returns the paths it added and changed. */
export async function copyShots(from: string, root: string) {
  const added: Array<string> = [];
  const changed: Array<string> = [];
  const files = await filesIn(from);
  for (const file of files.map((item) => item.split(path.sep).join('/'))) {
    if (!isBaseline(file)) {
      continue;
    }
    const shot = await readFile(path.join(from, file));
    const target = path.join(root, file);
    const current = await readFile(target).catch(() => null);
    if (current?.equals(shot)) {
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, shot);
    (current ? changed : added).push(file);
  }
  return { added, changed };
}

/** The ID of the latest CI run on the PR's head commit. */
async function ciRun(run: Run, pr: string) {
  const head = await must(run, [
    'gh',
    'pr',
    'view',
    pr,
    '--json',
    'headRefOid',
    '-q',
    '.headRefOid',
  ]);
  const id = await must(run, [
    'gh',
    'run',
    'list',
    '--workflow',
    'ci.yml',
    '--commit',
    head,
    '--limit',
    '1',
    '--json',
    'databaseId',
    '-q',
    '.[0].databaseId // ""',
  ]);
  if (!id) {
    throw new Error(`No CI run exists for the head of PR ${pr} (${head.slice(0, 7)}) yet.`);
  }
  return id;
}

export async function pull(run: Run, root: string, pr: string, log = console.log) {
  const id = await ciRun(run, pr);
  const folder = await mkdtemp(path.join(tmpdir(), 'visual-pull-'));
  try {
    const download = await run(['gh', 'run', 'download', id, '-n', artifactName, '-D', folder]);
    if (!download.ok) {
      log(
        `CI run ${id} has no ${artifactName} artifact: no screenshot changed, or the run is not finished. Wait for the journeys job.`,
      );
      return 1;
    }
    const { added, changed } = await copyShots(folder, root);
    for (const file of added) {
      log(`added    ${file}`);
    }
    for (const file of changed) {
      log(`changed  ${file}`);
    }
    log(
      added.length + changed.length === 0
        ? 'The baselines already match CI.'
        : `${added.length} added, ${changed.length} changed. Look at each one, commit them, and give the reason in the PR body.`,
    );
    return 0;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [action, pr] = process.argv.slice(2);
  if (action !== 'pull' || !pr || !/^\d+$/u.test(pr)) {
    console.error(usage);
    process.exit(2);
  }
  try {
    process.exitCode = await pull(retrying, path.resolve(import.meta.dir, '../..'), pr);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

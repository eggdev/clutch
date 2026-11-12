import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { gitOrThrow } from '@/git';

async function writeFiles(root: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.join(root, path.dirname(name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
}

/**
 * The identity of a test repo, and no commit signing. One write to the config
 * file of the repo sets all three, where three `git config` processes did.
 * A test file calls `gitRepo` many times, and each process costs more on a
 * busy machine.
 */
const repoConfig =
  '[user]\n\tname = Test\n\temail = test@example.com\n[commit]\n\tgpgsign = false\n';

/**
 * Makes a temporary folder that holds a git repo with one commit of `files` on
 * `main`. The folder can also hold siblings of the repo. The
 * repo has its own identity and no commit signing, so the user's git config
 * does not change the result. Pass `git: false` for a plain folder.
 */
export async function gitRepo(
  files: Record<string, string>,
  options: { git?: boolean; name?: string } = {},
) {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), 'cli-repo-')));
  const root = path.join(parent, options.name ?? 'project');
  await mkdir(root);
  await writeFiles(root, files);
  if (options.git !== false) {
    await gitOrThrow(root, 'init', '--quiet', '--initial-branch=main');
    await appendFile(path.join(root, '.git/config'), repoConfig);
    // A repo with no file has nothing to add, so the commit alone makes it.
    if (Object.keys(files).length > 0) {
      await gitOrThrow(root, 'add', '--all');
    }
    await gitOrThrow(root, 'commit', '--quiet', '--allow-empty', '--message', 'Initial commit');
  }
  return {
    root,
    parent,
    write: (more: Record<string, string>) => writeFiles(root, more),
    [Symbol.asyncDispose]: () => rm(parent, { recursive: true, force: true }),
  };
}

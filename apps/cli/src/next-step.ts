import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { git, gitOrThrow } from '@apps/cli/src/git';
import { branch, manifestPath, worktreePath } from '@apps/cli/src/install-template';

export type Stage = 'survey' | 'interview' | 'migrate' | 'done';
export type Step = { step: 'install' } | { step: Stage; worktree: string };

/** The folder of the worktree that has the install branch checked out, if one exists. */
async function findWorktree(root: string) {
  const list = await gitOrThrow(root, 'worktree', 'list', '--porcelain');
  const lines = list
    .split('\n\n')
    .map((block) => block.split('\n'))
    .find((block) => block.includes(`branch refs/heads/${branch}`));
  return lines?.find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
}

/**
 * Decides what a run of the CLI does next. Without the install branch, it
 * installs. With it, the `stage` in the manifest names the next stage. When
 * the worktree was removed, it adds the worktree back from the branch. The
 * migration deletes the manifest when it ends, so no manifest means done.
 */
export async function nextStep(root: string): Promise<Step> {
  const exists = await git(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  if (!exists.ok) {
    return { step: 'install' };
  }
  let worktree = await findWorktree(root);
  if (!worktree) {
    worktree = worktreePath(root);
    await gitOrThrow(root, 'worktree', 'add', '--quiet', worktree, branch);
  }
  const file = path.join(worktree, manifestPath);
  if (!existsSync(file)) {
    return { step: 'done', worktree };
  }
  const manifest = JSON.parse(await readFile(file, 'utf-8'));
  return { step: manifest.stage, worktree };
}

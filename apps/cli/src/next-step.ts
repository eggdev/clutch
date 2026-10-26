import { git, gitOrThrow } from '@apps/cli/src/git';
import { branch, manifestPath } from '@apps/cli/src/install-template';

export type Stage = 'survey' | 'interview' | 'migrate' | 'done';
export type Step = { step: 'install' } | { step: Stage };

/**
 * Decides what a run of the CLI does next. Without the install branch, it
 * installs. With it, the run switches the checkout to the branch, and the
 * `stage` in the manifest names the next stage. The migration deletes the
 * manifest when it ends, so no manifest means done.
 */
export async function nextStep(root: string): Promise<Step> {
  const exists = await git(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  if (!exists.ok) {
    return { step: 'install' };
  }
  if ((await gitOrThrow(root, 'branch', '--show-current')) !== branch) {
    await gitOrThrow(root, 'switch', '--quiet', branch);
  }
  const manifest = await git(root, 'show', `${branch}:${manifestPath}`);
  if (!manifest.ok) {
    return { step: 'done' };
  }
  return { step: JSON.parse(manifest.out).stage };
}

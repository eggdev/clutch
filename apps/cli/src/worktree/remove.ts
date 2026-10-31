import path from 'node:path';

import type { WorktreeBackend } from '@/worktree/backend';
import { checkSlug } from '@/worktree/names';
import type { WorktreeSettings } from '@/worktree/settings';

/** The side effects of `clutch worktree rm`, so a test can replace each one. */
export type RemoveWorktreeSteps = {
  readonly backend: WorktreeBackend;
  /** Stops the dev servers that a run in the checkout at `cwd` started. True when it stopped some. */
  readonly stopServers: (cwd: string) => Promise<boolean>;
  readonly log: (line: string) => void;
};

/**
 * `clutch worktree rm`: removes one task checkout. It refuses a dirty tree or
 * commits that no remote holds, unless `force`. It stops that checkout's dev
 * servers first, and no others. It deletes the branch only when the branch is
 * merged into `base`.
 */
export async function removeWorktree(
  options: {
    readonly slug: string | undefined;
    readonly force: boolean;
    readonly base: string;
    readonly settings: WorktreeSettings;
  },
  steps: RemoveWorktreeSteps,
) {
  const slug = checkSlug(options.slug);
  const target = path.join(options.settings.root, slug);
  const records = await steps.backend.list();
  const found = records.find((record) => record.path === target);
  if (!found) {
    throw new Error(`No checkout at ${target}. clutch worktree list shows each one.`);
  }
  const { branch } = found;
  const state = branch
    ? await steps.backend.state({ path: target, branch, base: options.base })
    : { unpushed: 0, merged: false };
  if (!options.force) {
    if (found.dirty) {
      throw new Error(
        `${target} has uncommitted changes. Commit or remove them, or pass --force to lose them.`,
      );
    }
    if (state.unpushed > 0) {
      throw new Error(
        `${branch} has ${state.unpushed} commit(s) that no remote holds. Push them, or pass --force to lose them.`,
      );
    }
  }
  if (await steps.stopServers(target)) {
    steps.log(`Stopped the dev servers of ${target}.`);
  }
  await steps.backend.remove({ path: target, force: options.force });
  steps.log(`Removed ${target}.`);
  if (branch && state.merged) {
    await steps.backend.deleteBranch(branch);
    steps.log(`Deleted ${branch}, which is merged into ${options.base}.`);
  } else if (branch) {
    steps.log(`Kept ${branch}, which is not merged into ${options.base}.`);
  }
}

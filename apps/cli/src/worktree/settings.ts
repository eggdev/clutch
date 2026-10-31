import path from 'node:path';

import { loadClutchConfig } from '@/clutch-config/load';

/**
 * The setup that a new checkout runs when `clutch.yaml` has no `worktree`
 * block. mise refuses a config file in a folder it has not seen, and the new
 * checkout's `mise.toml` comes from the same repository, so it is trusted
 * first. The install also installs the git hooks.
 */
export const defaultSetup = ['mise trust --quiet', 'mise exec -- bun install'];

export type WorktreeSettings = {
  /** The absolute folder that holds the task checkouts. */
  readonly root: string;
  readonly copy: ReadonlyArray<string>;
  readonly setup: ReadonlyArray<string>;
};

/**
 * The `worktree` block of `clutch.yaml` at `repoRoot`, with its paths resolved.
 * Without a block, the checkouts go in `../<repo>.worktrees`, nothing is
 * copied, and the setup installs the dependencies.
 */
export async function worktreeSettings(repoRoot: string): Promise<WorktreeSettings> {
  const loaded = await loadClutchConfig(repoRoot);
  if (loaded.kind === 'invalid') {
    throw new Error(
      `clutch.yaml is not valid: ${loaded.errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`,
    );
  }
  const block = loaded.kind === 'loaded' ? loaded.config.worktree : undefined;
  if (!block) {
    return {
      root: path.resolve(repoRoot, '..', `${path.basename(repoRoot)}.worktrees`),
      copy: [],
      setup: defaultSetup,
    };
  }
  return { root: path.resolve(repoRoot, block.root), copy: block.copy, setup: block.setup };
}

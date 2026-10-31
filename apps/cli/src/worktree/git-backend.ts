import { git, gitOrThrow } from '@/git';
import type { WorktreeBackend, WorktreeRecord } from '@/worktree/backend';

/** True when the checkout at `path` has uncommitted or untracked changes. */
async function isDirty(path: string) {
  const status = await git(path, 'status', '--porcelain');
  return status.ok && status.out.length > 0;
}

/** Parses `git worktree list --porcelain`: one block of `key value` lines per checkout. */
export function parsePorcelain(text: string) {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const fields = new Map(
        block.split('\n').map((line) => {
          const space = line.indexOf(' ');
          return space === -1 ? [line, ''] : [line.slice(0, space), line.slice(space + 1)];
        }),
      );
      const branch = fields.get('branch');
      return {
        path: fields.get('worktree') ?? '',
        head: fields.get('HEAD') ?? '',
        branch: branch ? branch.replace(/^refs\/heads\//u, '') : null,
        bare: fields.has('bare'),
      };
    })
    .filter((entry) => entry.path && !entry.bare);
}

/** The worktree backend on plain `git worktree`, for the repository at `root`. */
export function gitBackend(root: string): WorktreeBackend {
  const list = async (): Promise<Array<WorktreeRecord>> => {
    const entries = parsePorcelain(await gitOrThrow(root, 'worktree', 'list', '--porcelain'));
    return Promise.all(
      entries.map(async ({ path, head, branch }) => ({
        path,
        head,
        branch,
        dirty: await isDirty(path),
      })),
    );
  };
  return {
    async create({ branch, base, path }) {
      await gitOrThrow(root, 'worktree', 'add', '--quiet', '-b', branch, path, base);
      const head = await gitOrThrow(path, 'rev-parse', 'HEAD');
      return { path, branch, head, dirty: false };
    },
    list,
    async remove({ path, force }) {
      await gitOrThrow(root, 'worktree', 'remove', ...(force ? ['--force'] : []), path);
    },
    async state({ path, branch, base }) {
      // Commits that neither the base nor any remote branch holds.
      const ahead = await gitOrThrow(
        path,
        'rev-list',
        '--count',
        'HEAD',
        '--not',
        base,
        '--remotes',
      );
      const merged = await git(root, 'merge-base', '--is-ancestor', branch, base);
      return { unpushed: Number(ahead), merged: merged.ok };
    },
    async deleteBranch(branch) {
      // The caller checked that the branch is merged into its base, which -D does not re-check.
      await gitOrThrow(root, 'branch', '-D', branch);
    },
  };
}

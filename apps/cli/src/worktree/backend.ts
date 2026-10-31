/** One checkout of the repository: the main one, or a task worktree. */
export type WorktreeRecord = {
  readonly path: string;
  /** The branch name, such as `clutch/cl-201-worktree`, or null for a detached HEAD. */
  readonly branch: string | null;
  readonly head: string;
  /** True when the checkout has uncommitted or untracked changes. */
  readonly dirty: boolean;
};

/**
 * Creates, lists and removes task checkouts. The `clutch worktree` commands
 * call only this interface, so another backend can replace git later without
 * a change to the commands. `git-backend.ts` is the only implementation.
 */
export type WorktreeBackend = {
  readonly create: (options: {
    readonly slug: string;
    readonly branch: string;
    readonly base: string;
    readonly path: string;
  }) => Promise<WorktreeRecord>;
  readonly list: () => Promise<Array<WorktreeRecord>>;
  readonly remove: (options: { readonly path: string; readonly force: boolean }) => Promise<void>;
};

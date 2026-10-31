import type { WorktreeBackend } from '@/worktree/backend';
import { issueOf } from '@/worktree/names';

export type ListedWorktree = {
  readonly path: string;
  readonly branch: string | null;
  readonly head: string;
  readonly dirty: boolean;
  /** True for the main checkout, the one that holds the `.git` folder. */
  readonly main: boolean;
  readonly issue: string | null;
  readonly pr: { readonly number: number; readonly url: string; readonly state: string } | null;
};

/** Looks up the PR of a branch, or null when gh is missing or the branch has none. */
export type FindPr = (branch: string) => Promise<ListedWorktree['pr']>;

/** `clutch worktree list`: each checkout with its branch, dirty state, linked issue and PR. */
export async function listWorktrees(
  backend: WorktreeBackend,
  findPr: FindPr,
): Promise<Array<ListedWorktree>> {
  const records = await backend.list();
  return Promise.all(
    records.map(async (record, index) => ({
      ...record,
      main: index === 0,
      issue: issueOf(record.branch),
      pr: record.branch && index > 0 ? await findPr(record.branch) : null,
    })),
  );
}

/** One line for each checkout, for a person. */
export function formatWorktrees(worktrees: ReadonlyArray<ListedWorktree>): string {
  return worktrees
    .map((item) =>
      [
        item.path,
        item.branch ?? `(detached ${item.head.slice(0, 7)})`,
        item.dirty ? 'dirty' : 'clean',
        item.main ? 'main checkout' : (item.issue ?? '-'),
        item.pr ? `PR #${item.pr.number} ${item.pr.state.toLowerCase()}` : '',
      ]
        .filter(Boolean)
        .join('  '),
    )
    .join('\n');
}

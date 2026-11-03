import path from 'node:path';

import type { WorktreeBackend, WorktreeRecord } from '@/worktree/backend';
import type { FindPr } from '@/worktree/list';

/** The side effects of `clutch worktree prune`, so a test can replace each one. */
export type PruneSteps = {
  readonly backend: WorktreeBackend;
  readonly findPr: FindPr;
  /** Stops the dev servers that a run in the checkout at `cwd` started. True when it stopped some. */
  readonly stopServers: (cwd: string) => Promise<boolean>;
  readonly log: (line: string) => void;
};

export type PruneResult = {
  readonly path: string;
  readonly branch: string | null;
  readonly action: 'removed' | 'kept' | 'failed';
  readonly reason: string;
};

/** True when `inner` is `outer` or a folder inside it. */
function holds(outer: string, inner: string) {
  const relative = path.relative(outer, inner);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Why the checkout must stay, or null when nothing in it would be lost and its
 * PR is finished. Only a merged or closed PR finishes a checkout: a branch with
 * no PR yet may be new work, and a new branch is always merged into its base.
 */
async function keepReason(
  record: WorktreeRecord,
  options: { readonly base: string; readonly cwd: string },
  steps: PruneSteps,
): Promise<{ readonly keep: string } | { readonly merged: boolean; readonly pr: number }> {
  if (holds(record.path, options.cwd)) {
    return { keep: 'this command runs inside it' };
  }
  if (!record.branch) {
    return { keep: 'its HEAD is detached, so no PR finishes it' };
  }
  const pr = await steps.findPr(record.branch);
  if (!pr) {
    return { keep: 'its branch has no PR' };
  }
  if (pr.state !== 'MERGED' && pr.state !== 'CLOSED') {
    return { keep: `PR #${pr.number} is ${pr.state.toLowerCase()}` };
  }
  if (record.dirty) {
    return { keep: 'it has uncommitted changes' };
  }
  const state = await steps.backend.state({
    path: record.path,
    branch: record.branch,
    base: options.base,
  });
  const finished = { merged: pr.state === 'MERGED' || state.merged, pr: pr.number };
  // GitHub keeps a PR's head commit after it deletes the branch, so a checkout
  // at that commit loses nothing, even when no remote branch holds it.
  if (record.head === pr.head || state.merged) {
    return finished;
  }
  if (state.unpushed > 0) {
    return { keep: `it has ${state.unpushed} commit(s) that no remote holds` };
  }
  return { keep: `it has commits after PR #${pr.number}` };
}

/**
 * `clutch worktree prune`: removes each task checkout whose PR is merged or
 * closed, when nothing in it would be lost. It keeps the main checkout, the
 * one it runs in, a detached one, one without a PR or with an open PR, one
 * with uncommitted changes or unpushed commits, and one with commits after its
 * PR. It covers every checkout of the repository, wherever it lives. It
 * deletes the branch of a merged PR, a squash merge included, and keeps the
 * branch of a closed one.
 */
export async function pruneWorktrees(
  options: { readonly base: string; readonly cwd: string; readonly dryRun: boolean },
  steps: PruneSteps,
): Promise<Array<PruneResult>> {
  const [, ...tasks] = await steps.backend.list();
  const results: Array<PruneResult> = [];
  for (const record of tasks) {
    const { path: where, branch } = record;
    const verdict = await keepReason(record, options, steps);
    if ('keep' in verdict) {
      steps.log(`Kept ${where}: ${verdict.keep}.`);
      results.push({ path: where, branch, action: 'kept', reason: verdict.keep });
      continue;
    }
    const done = `PR #${verdict.pr} is ${verdict.merged ? 'merged' : 'closed'}`;
    if (options.dryRun) {
      steps.log(`Would remove ${where}: ${done}.`);
      results.push({ path: where, branch, action: 'removed', reason: done });
      continue;
    }
    try {
      if (await steps.stopServers(where)) {
        steps.log(`Stopped the dev servers of ${where}.`);
      }
      await steps.backend.remove({ path: where, force: false });
      if (branch && verdict.merged) {
        await steps.backend.deleteBranch(branch);
      }
      const kept = branch && !verdict.merged ? `, kept ${branch}` : '';
      steps.log(`Removed ${where}: ${done}${kept}.`);
      results.push({ path: where, branch, action: 'removed', reason: done });
    } catch (error) {
      const reason = (error as Error).message;
      steps.log(`Failed to remove ${where}: ${reason}`);
      results.push({ path: where, branch, action: 'failed', reason });
    }
  }
  return results;
}

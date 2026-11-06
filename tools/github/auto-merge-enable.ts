import { enabledMarker } from '@tools/github/auto-merge-rules';
import type { Step } from '@tools/github/auto-merge-rules';
import type { Run } from '@tools/github/stack';

/** The output of a command that must succeed, trimmed. A failure throws with its output. */
export async function must(run: Run, command: Array<string>) {
  const result = await run(command);
  if (!result.ok) {
    throw new Error(`${command.join(' ')} failed: ${result.err || result.out}`);
  }
  return result.out.trim();
}

/** One `gh` call that must succeed. */
export const gh = (run: Run, ...args: Array<string>) => must(run, ['gh', ...args]);

/** Whether a comment on the PR holds `text`, such as a verdict marker. */
export async function hasMarker(run: Run, repo: string, pr: string, text: string) {
  const out = await gh(
    run,
    'api',
    '--paginate',
    `repos/${repo}/issues/${pr}/comments`,
    '--jq',
    '.[].body',
  );
  return out.includes(text);
}

/** What GitHub answers when a PR is in a stack, which only the asynchronous merge API merges. */
const stackRefusal = /part of a stack/u;

/**
 * Enables GitHub's auto-merge for `sha`, the commit that was judged, and says
 * so once in a comment with the step. `--match-head-commit` makes GitHub
 * refuse when the head moved since the decision. GitHub queues no auto-merge
 * for a PR in a stack, and merges a stack only through the asynchronous merge
 * API, which merges at once. The verdict already found every required check
 * green, so such a PR merges through that API, still only at `sha`.
 */
export async function enableAutoMerge(run: Run, repo: string, pr: string, sha: string, step: Step) {
  const queued = await run([
    'gh',
    'pr',
    'merge',
    pr,
    '--auto',
    '--merge',
    '--match-head-commit',
    sha,
  ]);
  if (!queued.ok) {
    if (!stackRefusal.test(queued.err || queued.out)) {
      throw new Error(`gh pr merge ${pr} failed: ${queued.err || queued.out}`);
    }
    await gh(
      run,
      'api',
      '--method',
      'PUT',
      `repos/${repo}/pulls/${pr}/merge-async`,
      '-f',
      'merge_method=merge',
      '-f',
      `sha=${sha}`,
    );
  }
  if (!(await hasMarker(run, repo, pr, enabledMarker(step, sha)))) {
    const body = `${enabledMarker(step, sha)}\n**Auto-merge:** queued at ${sha.slice(0, 7)}, at the step \`${step}\`. GitHub merges it with a merge commit once the required checks pass. To stop it, run \`gh pr merge --disable-auto ${pr}\`.`;
    await gh(run, 'pr', 'comment', pr, '--body', body);
  }
}

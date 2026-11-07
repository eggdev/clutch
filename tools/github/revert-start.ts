import { defaultBranch, must } from '@tools/github/github';
import type { Clock } from '@tools/github/github';
import type { Run } from '@tools/github/stack';

/**
 * `pr revert <number>`: starts the Revert workflow for a merged PR, from the
 * default branch, and waits for its revert PR. The workflow opens the PR as
 * the release bot, so CI and agent review run on it. The session then drives
 * that PR to the merge like any other. See
 * docs/contributing/operations/rollback.md#revert-a-merged-pull-request.
 */
export async function revert(
  run: Run,
  number: string,
  clock: Clock,
  timing: { timeout: number; interval: number },
) {
  const trunk = await defaultBranch(run);
  const branch = `revert/${number}`;
  await must(run, ['gh', 'workflow', 'run', 'revert.yml', '--ref', trunk, '-f', `pr=${number}`]);
  console.log(`Started the Revert workflow for #${number}. Waiting for ${branch}.`);
  const end = clock.now() + timing.timeout;
  for (;;) {
    const out = await must(run, [
      'gh',
      'pr',
      'list',
      '--state',
      'all',
      '--head',
      branch,
      '--json',
      'number,url',
    ]);
    const [found] = JSON.parse(out || '[]') as Array<{ number: number; url: string }>;
    if (found) {
      console.log(
        `The revert PR is #${found.number}: ${found.url}. Babysit it, then run \`bun run pr merge ${found.number}\`.`,
      );
      return 0;
    }
    if (clock.now() >= end) {
      console.log(
        `No revert PR from ${branch} before the timeout. Read the run: gh run list --workflow revert.yml`,
      );
      return 1;
    }
    await clock.sleep(timing.interval);
  }
}

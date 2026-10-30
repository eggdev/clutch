import { defaultBranch, must } from '@tools/github/github';
import type { Clock } from '@tools/github/github';
import type { Run } from '@tools/github/stack';

type ReleaseRun = { headSha: string; status: string; conclusion: string; url: string };

/**
 * Waits for the release workflow's run on the merge commit and returns what
 * it did. A project without `release.yml` has no release to wait for.
 */
async function awaitRelease(
  run: Run,
  options: { sha: string; trunk: string; clock: Clock; timeout: number; interval: number },
) {
  const { clock } = options;
  const end = clock.now() + options.timeout;
  for (;;) {
    const list = await run([
      'gh',
      'run',
      'list',
      '--workflow',
      'release.yml',
      '--branch',
      options.trunk,
      '--limit',
      '20',
      '--json',
      'headSha,status,conclusion,url',
    ]);
    if (!list.ok) {
      return { code: 0, message: `No release workflow to wait for: ${list.err.trim()}` };
    }
    const found = (JSON.parse(list.out || '[]') as Array<ReleaseRun>).find(
      (item) => item.headSha === options.sha,
    );
    if (found?.status === 'completed') {
      if (found.conclusion !== 'success') {
        return {
          code: 1,
          message: `The release run ended ${found.conclusion}: ${found.url}. Read it with: gh run view --log-failed ${found.url.split('/').at(-1)}`,
        };
      }
      await must(run, ['git', 'fetch', '--quiet', '--tags', 'origin']);
      const manifest = await must(run, ['git', 'show', `origin/${options.trunk}:package.json`]);
      const { version } = JSON.parse(manifest) as { version?: string };
      return { code: 0, message: `Released v${version ?? '?'}: ${found.url}` };
    }
    if (clock.now() >= end) {
      return {
        code: 1,
        message: found
          ? `The release run is still ${found.status} after the timeout: ${found.url}`
          : `No release run started for ${options.sha.slice(0, 7)} before the timeout.`,
      };
    }
    await clock.sleep(options.interval);
  }
}

/**
 * Merges a PR with a merge commit. A PR in a stack merges with `gh stack
 * merge`, bottom up. GitHub can still count a PR as stacked after the PRs
 * below it merged, so a plain merge that GitHub refuses for its stack retries
 * through the stack. Then it waits for the release of the merge.
 */
export async function merge(
  run: Run,
  number: string,
  clock: Clock,
  timing: { timeout: number; interval: number },
) {
  const out = await must(run, ['gh', 'pr', 'view', number, '--json', 'baseRefName,headRefName']);
  const { baseRefName, headRefName } = JSON.parse(out) as {
    baseRefName: string;
    headRefName: string;
  };
  const trunk = await defaultBranch(run);
  const above = await must(run, [
    'gh',
    'pr',
    'list',
    '--state',
    'open',
    '--base',
    headRefName,
    '--json',
    'number',
  ]);
  const viaStack = () =>
    must(run, ['gh', 'stack', 'merge', number, '--merge', '--yes'], { inherit: true });
  if (baseRefName !== trunk || (JSON.parse(above || '[]') as Array<unknown>).length > 0) {
    await viaStack();
  } else {
    const plain = await run(['gh', 'pr', 'merge', number, '--merge']);
    if (!plain.ok && /stack/iu.test(`${plain.err}${plain.out}`)) {
      console.log(`GitHub counts #${number} as part of a stack. Merging through gh stack.`);
      await viaStack();
    } else if (!plain.ok) {
      throw new Error(`gh pr merge ${number} failed: ${plain.err || plain.out}`);
    }
  }
  await must(run, ['git', 'fetch', '--prune', 'origin']);
  const sha = await must(run, [
    'gh',
    'pr',
    'view',
    number,
    '--json',
    'mergeCommit',
    '--jq',
    '.mergeCommit.oid',
  ]);
  console.log(`Merged #${number} as ${sha.slice(0, 7)}. Waiting for the release.`);
  const release = await awaitRelease(run, { sha, trunk, clock, ...timing });
  console.log(release.message);
  return release.code;
}

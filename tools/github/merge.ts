import path from 'node:path';

import { readWatch } from '@tools/github/auto-revert';
import { prFindings, unanswered } from '@tools/github/findings';
import { defaultBranch, must } from '@tools/github/github';
import type { Clock } from '@tools/github/github';
import { autoMerge, watchMain } from '@tools/github/main-watch';
import type { Run } from '@tools/github/stack';
import { waitForChecks } from '@tools/github/status';

const root = path.resolve(import.meta.dir, '../..');

/** The exit code of `pr merge` when the PR waits for the owner. */
const heldCode = 3;

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
      // Only a missing workflow means no release. Auth, network or rate limits fail the wait.
      return /HTTP 404|workflow .* not found/iu.test(list.err)
        ? { code: 0, message: 'This repository has no release.yml, so no release to wait for.' }
        : { code: 1, message: `Could not read the release runs: ${list.err.trim()}` };
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

type Review = {
  reviewDecision: string | null;
  mergeStateStatus: string;
  reviewRequests: Array<{ login?: string; slug?: string; name?: string }>;
  latestReviews: Array<{ author: { login: string }; state: string }>;
};

/**
 * Why GitHub still wants a person's review, or nothing. `pr merge` checks
 * this first, so a PR that needs a code owner's approval names the reviewer.
 */
function reviewProblem(number: string, pr: Review) {
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    const who = pr.latestReviews
      .filter((review) => review.state === 'CHANGES_REQUESTED')
      .map((review) => `@${review.author.login}`);
    return `#${number} has changes requested by ${who.join(', ') || 'a reviewer'}. Address them, and ask in this session's thread for a new approval.`;
  }
  // A ruleset's code owner review leaves reviewDecision empty. GitHub then
  // reports the PR as blocked, with the code owners still requested.
  const blockedOnReview =
    pr.reviewDecision === null && pr.mergeStateStatus === 'BLOCKED' && pr.reviewRequests.length > 0;
  if (pr.reviewDecision === 'REVIEW_REQUIRED' || blockedOnReview) {
    const who = pr.reviewRequests.map((request) =>
      request.login ? `@${request.login}` : `the ${request.slug ?? request.name} team`,
    );
    return `#${number} needs an approving review from ${who.join(', ') || 'a code owner'} before it merges. Ask them in this session's thread.`;
  }
  return null;
}

/**
 * Merges PR `number` with the session's own token, on the owner's word. A PR
 * in a stack merges through `gh stack merge`. Returns the merge commit.
 */
async function mergeAsOwner(
  run: Run,
  number: string,
  pr: { baseRefName: string; headRefName: string; trunk: string },
) {
  const { baseRefName, headRefName, trunk } = pr;
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
  return must(run, [
    'gh',
    'pr',
    'view',
    number,
    '--json',
    'mergeCommit',
    '--jq',
    '.mergeCommit.oid',
  ]);
}

type OpenPr = Review & {
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  url?: string;
};

/**
 * The checks before the merge of an open PR, then the merge. Returns the merge
 * commit, or `heldCode` when the judge holds the PR.
 */
async function mergeOpen(
  run: Run,
  number: string,
  pr: OpenPr,
  clock: Clock,
  timing: { timeout: number; interval: number },
  options: { owner?: boolean },
): Promise<string | typeof heldCode> {
  const { baseRefName, headRefName } = pr;
  const problem = reviewProblem(number, {
    // gh prints an empty reviewDecision as an empty string.
    reviewDecision: pr.reviewDecision || null,
    mergeStateStatus: pr.mergeStateStatus ?? '',
    reviewRequests: pr.reviewRequests ?? [],
    latestReviews: pr.latestReviews ?? [],
  });
  const link = pr.url ? ` The approve link: ${pr.url}/files` : '';
  if (problem) {
    throw new Error(`${problem}${link}`);
  }
  // Each finding of every head has a fix or a reason, so none drops out unseen.
  const open = unanswered(await prFindings(run, number));
  if (open.length > 0) {
    throw new Error(
      `#${number} has ${open.length} agent review finding(s) with no disposition: ${open.map((finding) => `${finding.level} ${finding.path}`).join(', ')}. Run \`bun run pr findings ${number}\`, fix each one or say why not in a "## Review disposition" comment, then merge.`,
    );
  }
  const trunk = await defaultBranch(run);
  if (!options.owner && baseRefName !== trunk) {
    throw new Error(
      `#${number} is stacked on ${baseRefName}. Merge the PR below it first, or merge the stack with --owner once the owner tells you to.`,
    );
  }
  // The owner's word skips the judge, never the checks.
  const { status, code } = await waitForChecks(run, number, clock, timing);
  if (code === 2) {
    throw new Error(`#${number} still has pending checks after the timeout.`);
  }
  if (status.counts.fail > 0) {
    throw new Error(
      `#${number} has ${status.counts.fail} failed check(s). Babysit it to green first: bun run pr failures ${number}`,
    );
  }
  if (options.owner) {
    return mergeAsOwner(run, number, { baseRefName, headRefName, trunk });
  }
  const result = await autoMerge(run, number, trunk, { clock, ...timing });
  if (!result.merged) {
    console.log(result.message);
    console.log(
      `#${number} waits for the owner. Ask in this session's thread${pr.url ? `, with this approve link: ${pr.url}/files` : ''}. The approval merges it, then run \`bun run pr merge ${number}\` again to watch main.`,
    );
    return heldCode;
  }
  return result.sha;
}

/**
 * Merges a PR with a merge commit, in the session that built it. By default
 * it dispatches the Auto-merge workflow, which judges the PR with the default
 * branch's rules and merges it with the release bot's token. When the judge
 * holds the PR, it prints the verdict and returns `heldCode`. With `owner`,
 * because the owner told the session to merge, it merges itself: a PR in a
 * stack with `gh stack merge`, bottom up, and any other with a plain merge.
 * GitHub can still count a PR as stacked after the PRs below it merged, so a
 * plain merge that GitHub refuses for its stack retries through the stack.
 * Then it waits for the release and for CI on the default branch at the merge
 * commit, and starts the revert when that CI fails twice. It refuses while
 * GitHub reports that the PR needs a review, and while agent review's owner
 * findings wait for the owner's approval.
 */
export async function merge(
  run: Run,
  number: string,
  clock: Clock,
  timing: { timeout: number; interval: number },
  options: { owner?: boolean } = {},
) {
  const out = await must(run, [
    'gh',
    'pr',
    'view',
    number,
    '--json',
    'baseRefName,headRefName,headRefOid,reviewDecision,mergeStateStatus,reviewRequests,latestReviews,state,mergeCommit,url',
  ]);
  const pr = JSON.parse(out) as OpenPr & {
    state?: string;
    mergeCommit?: { oid: string } | null;
  };
  // The owner's approval can merge the PR after `merge` exited 3. Run again,
  // `merge` goes on to the release and the watch on main.
  const merged = pr.state === 'MERGED' && pr.mergeCommit ? pr.mergeCommit.oid : undefined;
  if (merged) {
    console.log(`#${number} is already merged.`);
  }
  const sha = merged ?? (await mergeOpen(run, number, pr, clock, timing, options));
  if (sha === heldCode) {
    return heldCode;
  }
  const trunk = await defaultBranch(run);
  await must(run, ['git', 'fetch', '--prune', 'origin']);
  console.log(`Merged #${number} as ${sha.slice(0, 7)}. Waiting for the release.`);
  const release = await awaitRelease(run, { sha, trunk, clock, ...timing });
  console.log(release.message);
  if (release.code !== 0) {
    return release.code;
  }
  const repo = await must(run, [
    'gh',
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '--jq',
    '.nameWithOwner',
  ]);
  const watch = await readWatch(path.join(root, 'clutch.yaml'));
  return watchMain(run, { clock, ...timing, repo, trunk, sha, watch });
}

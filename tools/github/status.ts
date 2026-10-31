import { marker } from '@tools/github/auto-merge-rules';
import { must } from '@tools/github/github';
import type { Clock } from '@tools/github/github';
import type { Run } from '@tools/github/stack';

type State = 'pass' | 'fail' | 'pending' | 'skipped';
export type Check = { name: string; state: State; url: string };

type Rollup = {
  __typename?: string;
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string;
  state?: string;
  detailsUrl?: string;
  targetUrl?: string;
};

const failed = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'ERROR',
]);

/** One entry of `statusCheckRollup`: a check run or a commit status. */
function checkOf(item: Rollup): Check {
  const name = item.name ?? item.context ?? '?';
  const url = item.detailsUrl ?? item.targetUrl ?? '';
  const result = item.__typename === 'StatusContext' ? item.state : item.conclusion;
  if (item.__typename !== 'StatusContext' && item.status !== 'COMPLETED') {
    return { name, state: 'pending', url };
  }
  if (result === 'SUCCESS' || result === 'NEUTRAL') {
    return { name, state: 'pass', url };
  }
  if (result === 'SKIPPED') {
    return { name, state: 'skipped', url };
  }
  return { name, state: failed.has(result ?? '') ? 'fail' : 'pending', url };
}

/**
 * The blocking count in an agent review comment. The agent words it in several
 * ways: "Blocking findings: 0", "Blocking: 0", "Findings: 1 (0 blocking)" or
 * "0 blocking".
 */
export function blockingCount(body: string) {
  const text = body.replaceAll('*', '');
  const match =
    /blocking(?: findings)?:\s*(\d+)/iu.exec(text) ??
    /blocking findings\s+(\d+)/iu.exec(text) ??
    /(\d+)\s+blocking\b/iu.exec(text) ??
    undefined;
  if (match) {
    return Number(match[1]);
  }
  return /\bno findings\b/iu.test(text) ? 0 : null;
}

type Comment = { body: string; login: string };

/** The comments on a PR, oldest first. */
async function comments(run: Run, number: string): Promise<Array<Comment>> {
  const out = await must(run, [
    'gh',
    'api',
    '--paginate',
    `repos/{owner}/{repo}/issues/${number}/comments?per_page=100`,
    '--jq',
    '.[] | {body, login: .user.login}',
  ]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Comment);
}

/** The status checks that the rules of `branch` require. None when the token cannot read them. */
async function requiredChecks(run: Run, branch: string) {
  const result = await run([
    'gh',
    'api',
    `repos/{owner}/{repo}/rules/branches/${branch}`,
    '--jq',
    '[.[] | .parameters.required_status_checks[]?.context]',
  ]);
  return result.ok ? (JSON.parse(result.out || '[]') as Array<string>) : [];
}

/** The verdict of a dry-run comment. */
const verdict = (body: string) => (/would not auto-merge/u.test(body) ? 'would not' : 'would');

/** Everything a person or an agent asks before a merge, in one read. */
export async function prStatus(run: Run, number: string) {
  const out = await must(run, [
    'gh',
    'pr',
    'view',
    number,
    '--json',
    'number,url,state,headRefOid,headRefName,baseRefName,mergeable,mergeStateStatus,statusCheckRollup',
  ]);
  const pr = JSON.parse(out) as {
    number: number;
    url: string;
    state: string;
    headRefOid: string;
    headRefName?: string;
    baseRefName: string;
    mergeable: string;
    mergeStateStatus: string;
    statusCheckRollup: Array<Rollup> | null;
  };
  const checks = (pr.statusCheckRollup ?? []).map(checkOf);
  const names = await requiredChecks(run, pr.baseRefName);
  // A required check that has not started yet is pending.
  const required = names.map(
    (name) =>
      checks.find((check) => check.name === name) ?? { name, state: 'pending' as State, url: '' },
  );
  const all = [...checks, ...required.filter((check) => !checks.includes(check))];
  // Only a bot posts the review and the dry run. A person's comment that quotes one does not count.
  const posted = await comments(run, number);
  const notes = posted.filter((note) => note.login.endsWith('[bot]'));
  const review = notes.findLast((note) => note.body.trimStart().startsWith('## Agent review'));
  const dryRun = notes.findLast((note) => note.body.includes(marker(pr.headRefOid)));
  const count = (state: State) => all.filter((check) => check.state === state).length;
  const blocking = review ? blockingCount(review.body) : null;
  // A repository without agent review has no review to wait for.
  const reviewed =
    blocking === 0 || (blocking === null && !all.some((check) => check.name === 'agent-review'));
  const ready =
    pr.state === 'OPEN' &&
    pr.mergeable === 'MERGEABLE' &&
    count('fail') === 0 &&
    count('pending') === 0 &&
    required.every((check) => check.state === 'pass' || check.state === 'skipped') &&
    reviewed;
  return {
    number: pr.number,
    url: pr.url,
    state: pr.state,
    head: pr.headRefOid,
    headRef: pr.headRefName ?? '',
    base: pr.baseRefName,
    mergeable: pr.mergeable,
    mergeState: pr.mergeStateStatus,
    required,
    checks: all,
    counts: { pass: count('pass'), fail: count('fail'), pending: count('pending') },
    agentReview: { posted: review !== undefined, blocking },
    dryRun: dryRun ? verdict(dryRun.body) : null,
    ready,
  };
}

export type PrStatus = Awaited<ReturnType<typeof prStatus>>;

function reviewLine(review: { posted: boolean; blocking: number | null }) {
  if (!review.posted) {
    return 'no review yet';
  }
  return review.blocking === null
    ? 'posted, but its blocking count is unreadable'
    : `${review.blocking} blocking`;
}

/** The status as a short block. */
export function renderStatus(status: PrStatus) {
  const failing = status.checks
    .filter((check) => check.state === 'fail')
    .map((check) => check.name);
  return [
    `PR #${status.number} ${status.url}`,
    `Head ${status.head.slice(0, 7)} into ${status.base}. ${status.state}, ${status.mergeable} (${status.mergeState}).`,
    `Required: ${status.required.map((check) => `${check.name} ${check.state}`).join(', ') || 'none'}`,
    `Checks: ${status.counts.pass} pass, ${status.counts.fail} fail, ${status.counts.pending} pending${failing.length > 0 ? ` (failed: ${failing.join(', ')})` : ''}`,
    `Agent review: ${reviewLine(status.agentReview)}`,
    `Dry run: ${status.dryRun ? `${status.dryRun} auto-merge at ${status.head.slice(0, 7)}` : 'no verdict for this head'}`,
    `Ready to merge: ${status.ready ? 'yes' : 'no'}`,
  ].join('\n');
}

/**
 * Polls until no check is pending, then returns the status. Exit code 0 when
 * the PR is ready, 1 when a check failed or it is not ready, 2 at the timeout.
 */
export async function waitForChecks(
  run: Run,
  number: string,
  clock: Clock,
  options: { timeout: number; interval: number; local?: { branch: string; sha: string } },
) {
  const end = clock.now() + options.timeout;
  for (;;) {
    const status = await prStatus(run, number);
    // Right after a push, GitHub can still report the old head and its green
    // checks. Wait until it shows the commit that this checkout has.
    const behind =
      options.local !== undefined &&
      status.headRef === options.local.branch &&
      status.head !== options.local.sha;
    if (status.counts.pending === 0 && !behind) {
      return { status, code: status.ready ? 0 : 1 };
    }
    if (clock.now() >= end) {
      return { status, code: 2 };
    }
    await clock.sleep(options.interval);
  }
}

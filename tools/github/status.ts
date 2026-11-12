import path from 'node:path';

import { changedFiles, ownerApproved, ownerFindings } from '@tools/github/auto-merge';
import { marker } from '@tools/github/auto-merge-rules';
import { contractBreaks } from '@tools/github/contract-breaks';
import { must } from '@tools/github/github';
import type { Clock } from '@tools/github/github';
import { majorChange } from '@tools/github/major-change';
import { ownerCount } from '@tools/github/owner-reviews';
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
  startedAt?: string;
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

/** The review text without Markdown emphasis or code marks, which the agent words around levels. */
const plain = (body: string) => body.replaceAll(/[*`]/gu, '');

/**
 * The blocking count in an agent review comment. The agent words it in several
 * ways: "Blocking findings: 0", "Blocking: 0", "Findings: 1 (0 blocking)",
 * "0 blocking", "No `blocking` findings" or "Findings (2, all `note`; none blocking)".
 */
export function blockingCount(body: string) {
  const text = plain(body);
  const match =
    /blocking(?: findings)?:\s*(\d+)/iu.exec(text) ??
    /blocking findings\s+(\d+)/iu.exec(text) ??
    /(\d+)\s+blocking\b/iu.exec(text) ??
    undefined;
  if (match) {
    return Number(match[1]);
  }
  // Only when no count is written: "No blocking findings", "No findings" or "none blocking".
  return /\bno (?:blocking )?findings\b|\bnone blocking\b/iu.test(text) ? 0 : null;
}

type Comment = { body: string; login: string; createdAt?: string };

/** The comments on a PR, oldest first. */
async function comments(run: Run, number: string): Promise<Array<Comment>> {
  const out = await must(run, [
    'gh',
    'api',
    '--paginate',
    `repos/{owner}/{repo}/issues/${number}/comments?per_page=100`,
    '--jq',
    '.[] | {body, login: .user.login, createdAt: .created_at}',
  ]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Comment);
}

/** Whether a note was posted after the run that started at `started`. Without either time, it counts. */
const postedInRun = (note: Comment, started?: string) =>
  started === undefined || note.createdAt === undefined || note.createdAt >= started;

/** The bot's latest agent review summary among `posted`, or undefined. */
function latestReview(posted: Array<Comment>) {
  return posted
    .filter((note) => note.login.endsWith('[bot]'))
    .findLast((note) => note.body.trimStart().startsWith('## Agent review'));
}

/**
 * The summary of this head's agent-review run, or undefined. With no credential the
 * run posts none, so an earlier head's summary is not this head's.
 */
function thisRunsReview(posted: Array<Comment>, started?: string) {
  const latest = latestReview(posted);
  return latest && postedInRun(latest, started) ? latest : undefined;
}

/**
 * The blocking count of the head, from the agent review summary. No summary means the
 * review did not run, so the count stays unknown.
 */
function blockingOf(review: Comment | undefined): number | null {
  return review === undefined ? null : blockingCount(review.body);
}

const root = path.resolve(import.meta.dir, '../..');

/** The default owner in CODEOWNERS: the owner of the `*` rule, else the login that the file names most. */
function codeownersDefault(text: string) {
  const counts = new Map<string, number>();
  let star: string | undefined;
  for (const line of text.split('\n')) {
    const [pattern, ...owners] = line.replace(/#.*$/u, '').trim().split(/\s+/u);
    const people = owners
      .filter((owner) => owner.startsWith('@') && !owner.includes('/'))
      .map((owner) => owner.slice(1));
    if (!pattern || people.length === 0) {
      continue;
    }
    if (pattern === '*') {
      star = people[0];
    }
    for (const person of people) {
      counts.set(person, (counts.get(person) ?? 0) + 1);
    }
  }
  return star ?? [...counts].toSorted((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * The owner whose approval answers agent review's owner findings: `automerge.owner`
 * in clutch.yaml, else the default owner in .github/CODEOWNERS. Tools may not
 * import from apps, so this reads only those two places.
 */
export async function ownerLogin(): Promise<string | undefined> {
  const config = Bun.file(path.join(root, 'clutch.yaml'));
  if (await config.exists()) {
    const { automerge } = (Bun.YAML.parse(await config.text()) ?? {}) as {
      automerge?: { owner?: unknown };
    };
    if (typeof automerge?.owner === 'string' && automerge.owner.trim()) {
      return automerge.owner.trim().replace(/^@/u, '');
    }
  }
  const codeowners = Bun.file(path.join(root, '.github/CODEOWNERS'));
  return (await codeowners.exists()) ? codeownersDefault(await codeowners.text()) : undefined;
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
    'number,url,state,headRefOid,headRefName,baseRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup',
  ]);
  const pr = JSON.parse(out) as {
    number: number;
    url: string;
    state: string;
    headRefOid: string;
    headRefName?: string;
    baseRefName: string;
    /** APPROVED, CHANGES_REQUESTED or REVIEW_REQUIRED, or empty when no review is required. */
    reviewDecision?: string;
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
  const agentRun = (pr.statusCheckRollup ?? []).find(
    (item) => (item.name ?? item.context) === 'agent-review',
  );
  const reviewComment = thisRunsReview(posted, agentRun?.startedAt);
  const dryRun = notes.findLast((note) => note.body.includes(marker(pr.headRefOid)));
  const count = (state: State) => all.filter((check) => check.state === state).length;
  const blocking = blockingOf(reviewComment);
  // The annotations of the latest agent-review run on the head decide whether an owner finding exists, as auto-merge reads them.
  const findings = await ownerFindings(run, '{owner}/{repo}', pr.headRefOid);
  const owner = await ownerCount(run, number, pr.headRefOid, findings.length);
  // A repository without agent review has no review to wait for.
  const reviewed =
    reviewComment !== undefined || !all.some((check) => check.name === 'agent-review');
  // A rule such as a code-owner review can still hold the merge after every check passes.
  // A ruleset's code-owner review leaves reviewDecision empty, but GitHub
  // still reports the merge state as BLOCKED.
  const review =
    pr.reviewDecision || (pr.mergeStateStatus === 'BLOCKED' ? 'BLOCKED by a rule' : '');
  const approved = review === '' || review === 'APPROVED';
  // What the merge judge holds for the owner, as auto-merge reads it. The owner's approval of the head lifts it.
  const changed = await changedFiles(run, '{owner}/{repo}', number);
  const breaks = await contractBreaks(run, '{owner}/{repo}', changed, pr.headRefOid);
  const major = await majorChange(run, '{owner}/{repo}', number, changed);
  const holds = [...breaks, ...major];
  const lifted =
    holds.length === 0 ||
    (await ownerApproved(run, '{owner}/{repo}', number, pr.headRefOid, await ownerLogin()));
  const ready =
    pr.state === 'OPEN' &&
    pr.mergeable === 'MERGEABLE' &&
    count('fail') === 0 &&
    count('pending') === 0 &&
    required.every((check) => check.state === 'pass' || check.state === 'skipped') &&
    reviewed &&
    approved &&
    lifted;
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
    agentReview: { posted: reviewComment !== undefined, blocking, owner },
    review: review || 'none required',
    contractBreaks: breaks,
    major,
    dryRun: dryRun ? verdict(dryRun.body) : null,
    ready,
  };
}

export type PrStatus = Awaited<ReturnType<typeof prStatus>>;

function reviewLine(review: { posted: boolean; blocking: number | null; owner: number }) {
  if (!review.posted) {
    return 'no review yet';
  }
  const blocking =
    review.blocking === null
      ? 'posted, but its blocking count is unreadable'
      : `${review.blocking} blocking`;
  return review.owner > 0 ? `${blocking}, ${review.owner} owner (advisory)` : blocking;
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
    `Agent review: ${reviewLine(status.agentReview)}. Review decision: ${status.review}.`,
    ...(status.contractBreaks.length > 0
      ? [`Contract breaks: ${status.contractBreaks.join(', ')}. The owner agrees to a break.`]
      : []),
    ...(status.major.length > 0
      ? [`Major change: ${status.major.join(', and ')}. The owner signs off a major change.`]
      : []),
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

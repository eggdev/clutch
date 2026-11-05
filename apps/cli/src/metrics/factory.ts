import { agentsIn, isRevert, percentile } from '@/metrics/compute';

/**
 * The version of the rules in this file. C-Suite pins it, so bump it when a
 * rule changes what a number means. `factory-observability.md` lists the rules.
 */
export const factoryDefinitions = 'warp-2026-11-04';

/** The revert rate that steps auto-merge down: the brake of decision D-004. */
const revertBrake = 0.02;

/** One commit of a pull request, as `pulls/<n>/commits` lists it. */
export type PullCommit = {
  sha: string;
  message: string;
  /** The author date, which a rebase keeps. */
  authoredAt: string;
  /** Whether a bot account made it, such as Renovate or the Revert workflow. */
  bot: boolean;
  /** Whether it has more than one parent, such as an "Update branch" merge. */
  merge: boolean;
};

/** What the factory numbers read about one merged pull request. */
export type FactoryPull = {
  number: number;
  title: string;
  body: string;
  headRef: string;
  labels: Array<string>;
  createdAt: string;
  mergedAt: string;
  mergeSha: string;
  /** The commits of the pull request, oldest first. */
  commits: Array<PullCommit>;
  /** The first submitted review, or the first completed agent review run. */
  firstReviewAt?: string;
  /** When the issue of the pull request went `in_progress`, before its first commit. */
  inProgressAt?: string | null;
};

/**
 * The pull request with its first review: the earliest of a submitted review
 * and a completed agent review run on one of its commits. `runs` maps a head
 * commit to its earliest completed run.
 */
export function withAgentReview<T extends Pick<FactoryPull, 'commits' | 'firstReviewAt'>>(
  pull: T,
  runs: Map<string, string>,
): T {
  const [first] = [pull.firstReviewAt, ...pull.commits.map((commit) => runs.get(commit.sha))]
    .filter((at): at is string => Boolean(at))
    .toSorted();
  return { ...pull, firstReviewAt: first };
}

const hour = 3_600_000;
const time = (iso: string) => Date.parse(iso);

/**
 * The commits that `pr open` and `pr ready` make for the operator: the
 * changeset and the tracker update. Older releases left them without an agent
 * trailer, so their subject tells them apart.
 */
const toolSubjects = [
  /^chore\(changeset\): add an? (?:patch|minor|major) changeset for this PR$/u,
  /^chore\(tracker\): mark \S+ done$/u,
];

/** Whether `pr open` or `pr ready` made the commit, not a person. */
export function isToolCommit(message: string) {
  const subject = message.split('\n', 1)[0].trim();
  return toolSubjects.some((pattern) => pattern.test(subject));
}

/**
 * The commits that a person pushed: no agent trailer, no bot author, no merge
 * of the base branch and no commit that `pr open` made.
 */
export function humanCommits(pull: Pick<FactoryPull, 'commits'>) {
  return pull.commits.filter(
    (commit) =>
      !commit.bot &&
      !commit.merge &&
      !isToolCommit(commit.message) &&
      agentsIn(commit.message).length === 0,
  );
}

/**
 * Whether a person opened the pull request. The operator's token opens agent
 * PRs too, so the author does not tell. A person's PR has no agent branch
 * prefix, and its first commit has no agent trailer and no bot author.
 */
export function openedByPerson(pull: Pick<FactoryPull, 'commits' | 'headRef'>, prefix: string) {
  const [first] = pull.commits;
  return (
    !pull.headRef.startsWith(prefix) &&
    first !== undefined &&
    !first.bot &&
    agentsIn(first.message).length === 0
  );
}

/** When the lane started: the first commit, or the issue's `in_progress` commit when it is earlier. */
export function laneStart(pull: Pick<FactoryPull, 'commits' | 'inProgressAt' | 'createdAt'>) {
  const starts = [pull.commits[0]?.authoredAt, pull.inProgressAt].filter((at): at is string =>
    Boolean(at),
  );
  return starts.length === 0 ? pull.createdAt : starts.toSorted()[0];
}

const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * Whether `revert` reverts `target`. Each revert that Clutch or GitHub makes
 * names its target in one of these ways: the `revert/<n>` branch of the Revert
 * workflow, `Reverts #<n>` in its body or commit, `This reverts commit <sha>`
 * from `git revert`, or the title `Revert "<title>"` or `revert: <title>`.
 */
export function reverts(revert: FactoryPull, target: FactoryPull, repo: string) {
  if (revert.number === target.number || time(revert.mergedAt) <= time(target.mergedAt)) {
    return false;
  }
  if (revert.headRef === `revert/${target.number}`) {
    return true;
  }
  const text = [revert.body, ...revert.commits.map((commit) => commit.message)].join('\n');
  const byNumber = new RegExp(`\\breverts (?:${escape(repo)})?#${target.number}\\b`, 'iu');
  if (byNumber.test(text)) {
    return true;
  }
  const shas = [target.mergeSha, ...target.commits.map((commit) => commit.sha)].filter(Boolean);
  for (const match of text.matchAll(/This reverts commit ([0-9a-f]{7,40})/gu)) {
    if (shas.some((sha) => sha.startsWith(match[1]))) {
      return true;
    }
  }
  const title = revert.title.trim();
  const short = title.endsWith('...') ? title.slice(0, -3) : undefined;
  const workflow = `revert: ${target.title}`;
  return (
    title === `Revert "${target.title}"` ||
    title === workflow ||
    (short !== undefined && workflow.startsWith(short))
  );
}

const hasDrillLabel = (pull: FactoryPull) => pull.labels.includes('drill');

/** Whether a pull request is a revert at all, before `reverts` finds its target. */
const looksLikeRevert = (pull: FactoryPull) =>
  pull.headRef.startsWith('revert/') ||
  isRevert(pull.title) ||
  pull.commits.some((commit) => isRevert(commit.message));

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;
const share = (part: number, whole: number) => (whole === 0 ? null : round(part / whole, 3));

const spread = (values: Array<number>) => ({
  p50: percentile(values, 50),
  p90: percentile(values, 90),
  count: values.length,
});

/** Hours from `start` to `end`, never less than 0, for a clock that is out of step. */
const hoursBetween = (start: string, end: string) => Math.max(0, (time(end) - time(start)) / hour);

/**
 * Autonomy, cycle time and reverts, with Warp's definitions, for the pull
 * requests merged in the window. The window ends now, so a later revert is
 * one of `pulls` too.
 *
 * - Autonomy: the share of merged PRs with no human code push. Opening the PR
 *   counts as a push. Reviews, comments and the merge do not.
 * - Cycle time: hours from the lane start to the PR, to the first review and
 *   to the merge, as p50 and p90.
 * - Reverts: the share of merged PRs that a later merged PR reverts. A drill
 *   does not count, as the revert or as the target.
 */
export function factoryMetrics(
  pulls: Array<FactoryPull>,
  options: { repo: string; branchPrefix: string },
) {
  const { repo, branchPrefix } = options;
  const merged = pulls.length;

  const withHuman = pulls
    .filter((pull) => openedByPerson(pull, branchPrefix) || humanCommits(pull).length > 0)
    .map((pull) => pull.number);

  const starts = pulls.map((pull) => ({ pull, start: laneStart(pull) }));
  const toPr = starts.map(({ pull, start }) => hoursBetween(start, pull.createdAt));
  const toFirstReview = starts.flatMap(({ pull, start }) =>
    pull.firstReviewAt ? [hoursBetween(start, pull.firstReviewAt)] : [],
  );
  const toMerge = starts.map(({ pull, start }) => hoursBetween(start, pull.mergedAt));

  const candidates = pulls.filter((pull) => !hasDrillLabel(pull) && looksLikeRevert(pull));
  const reverted = pulls
    .filter(
      (target) =>
        !hasDrillLabel(target) && candidates.some((revert) => reverts(revert, target, repo)),
    )
    .map((pull) => pull.number);
  const rate = share(reverted.length, merged);
  const human = new Set(withHuman);
  const revertedSet = new Set(reverted);

  return {
    definitions: factoryDefinitions,
    merged,
    autonomy: {
      autonomous: merged - withHuman.length,
      merged,
      share: share(merged - withHuman.length, merged),
      humanPushed: withHuman,
    },
    cycleTimeHours: {
      toPr: spread(toPr),
      toFirstReview: spread(toFirstReview),
      toMerge: spread(toMerge),
    },
    reverts: {
      reverted: reverted.length,
      merged,
      rate,
      brake: revertBrake,
      overBrake: rate !== null && rate > revertBrake,
      pulls: reverted,
    },
    // One row for each PR, so a reader can check a number or take its own lane start.
    pulls: starts.map(({ pull, start }) => ({
      number: pull.number,
      laneStart: start,
      openedAt: pull.createdAt,
      firstReviewAt: pull.firstReviewAt ?? null,
      mergedAt: pull.mergedAt,
      humanPush: human.has(pull.number),
      reverted: revertedSet.has(pull.number),
    })),
  };
}

export type FactoryMetrics = ReturnType<typeof factoryMetrics>;

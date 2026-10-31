/** What `clutch metrics` reads about one merged pull request. */
export type MergedPull = {
  number: number;
  title: string;
  createdAt: string;
  mergedAt: string;
  /** Whether a person merged it, enabled auto-merge, reviewed or commented. */
  humanAction: boolean;
  /** The latest time a check on the head commit passed, before the merge. */
  lastGreenAt?: string;
  /** The full message of each commit in the pull request. */
  commitMessages: Array<string>;
};

/** One check run on a commit of the default branch. */
export type CheckRun = {
  name: string;
  status: string;
  conclusion: string | null;
  completedAt: string | null;
};

/** A commit of the default branch, oldest first, with its check runs. */
export type MainCommit = { sha: string; message: string; checks: Array<CheckRun> };

const hour = 3_600_000;
const failed = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']);
const agentNames = ['claude', 'codex', 'cursor', 'copilot'] as const;

const time = (iso: string) => Date.parse(iso);
const round = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places;

/** The `p`th percentile of `values`, by linear interpolation, or null for none. */
export function percentile(values: Array<number>, p: number) {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return round(sorted[low] + (sorted[high] - sorted[low]) * (rank - low));
}

const spread = (values: Array<number>) => ({
  p50: percentile(values, 50),
  p90: percentile(values, 90),
  count: values.length,
});

/** The agents that the `Co-authored-by` trailers of `message` name. */
export function agentsIn(message: string) {
  const found = new Set<string>();
  for (const match of message.matchAll(/^co-authored-by:(.*)$/gimu)) {
    const who = match[1].toLowerCase();
    for (const agent of agentNames) {
      if (who.includes(agent)) {
        found.add(agent);
      }
    }
  }
  return [...found];
}

/** Whether a commit message or a pull request title is a revert. */
export function isRevert(text: string) {
  return /^revert\b/iu.test(text.trim()) || /^This reverts commit [0-9a-f]{7,}/mu.test(text);
}

/**
 * Minutes in `[since, until]` that the required checks of the default branch
 * were failing. Main turns red when a required check fails on a commit, and
 * green again when the latest run of each required check that ran on that
 * commit, or a later one, passes. A check added to the rules later is not
 * expected on older commits. A commit with no completed required check leaves
 * the state as it was. The
 * first commit is the last one before the window, so the window starts with
 * its state.
 */
export function mainRedMinutes(
  commits: Array<MainCommit>,
  required: Array<string>,
  since: string,
  until: string,
) {
  const wanted = new Set(required);
  type Event = { at: number; index: number; ok: boolean };
  const events: Array<Event> = [];
  for (const [index, commit] of commits.entries()) {
    const runs = commit.checks.flatMap((run) =>
      wanted.has(run.name) && run.completedAt
        ? [{ name: run.name, red: failed.has(run.conclusion ?? ''), at: time(run.completedAt) }]
        : [],
    );
    const red = runs.filter((run) => run.red);
    if (red.length > 0) {
      events.push({ at: Math.min(...red.map((run) => run.at)), index, ok: false });
    }
    const latest = new Map<string, (typeof runs)[number]>();
    for (const run of runs.toSorted((a, b) => a.at - b.at)) {
      latest.set(run.name, run);
    }
    const final = [...latest.values()];
    if (final.length > 0 && final.every((run) => !run.red)) {
      events.push({ at: Math.max(...final.map((run) => run.at)), index, ok: true });
    }
  }
  const start = time(since);
  const end = time(until);
  let newest = -1;
  let redSince: number | undefined;
  let total = 0;
  for (const event of events.toSorted((a, b) => a.at - b.at || a.index - b.index)) {
    if (event.index < newest) {
      continue;
    }
    newest = event.index;
    if (!event.ok && redSince === undefined) {
      redSince = event.at;
    } else if (event.ok && redSince !== undefined) {
      total += Math.max(0, Math.min(event.at, end) - Math.max(redSince, start));
      redSince = undefined;
    }
  }
  if (redSince !== undefined) {
    total += Math.max(0, end - Math.max(redSince, start));
  }
  return Math.round(total / 60_000);
}

/** The flow numbers from the merged pull requests of a window of `days` days. */
export function flowMetrics(pulls: Array<MergedPull>, days: number) {
  const merged = pulls.length;
  const noHuman = pulls.filter((pull) => !pull.humanAction).length;
  const openToMerge = pulls.map((pull) => (time(pull.mergedAt) - time(pull.createdAt)) / hour);
  const greenToMerge = pulls.flatMap((pull) =>
    pull.lastGreenAt ? [(time(pull.mergedAt) - time(pull.lastGreenAt)) / hour] : [],
  );
  const commits = pulls.flatMap((pull) => pull.commitMessages);
  const byAgent: Record<string, number> = {};
  let agentCommits = 0;
  for (const message of commits) {
    const agents = agentsIn(message);
    agentCommits += agents.length > 0 ? 1 : 0;
    for (const agent of agents) {
      byAgent[agent] = (byAgent[agent] ?? 0) + 1;
    }
  }
  const agentPulls = pulls.filter((pull) =>
    pull.commitMessages.some((message) => agentsIn(message).length > 0),
  ).length;
  const share = (part: number, whole: number) => (whole === 0 ? null : round(part / whole, 3));
  return {
    merged,
    mergedPerDay: round(merged / days, 2),
    noHumanAction: { count: noHuman, share: share(noHuman, merged) },
    openToMergeHours: spread(openToMerge),
    greenToMergeHours: spread(greenToMerge),
    agents: {
      commits: commits.length,
      agentCommits,
      commitShare: share(agentCommits, commits.length),
      pullShare: share(agentPulls, merged),
      byAgent,
    },
    revertPulls: pulls.filter((pull) => isRevert(pull.title)).length,
  };
}

/** One GitHub Actions workflow run, as `actions/runs` reports it. */
export type WorkflowRun = {
  conclusion: string | null;
  runStartedAt: string;
  updatedAt: string;
};

/** The duration and failure rate of the completed workflow runs. */
export function ciMetrics(runs: Array<WorkflowRun>) {
  const done = runs.filter((run) => run.conclusion !== null && run.conclusion !== 'skipped');
  const failures = done.filter((run) => failed.has(run.conclusion ?? '')).length;
  return {
    runs: done.length,
    failureRate: done.length === 0 ? null : round(failures / done.length, 3),
    durationMinutes: spread(
      done.map((run) => (time(run.updatedAt) - time(run.runStartedAt)) / 60_000),
    ),
  };
}

/**
 * One dry-run verdict that the Auto-merge workflow commented, with the grading
 * reactions on it: the owner's, and a bot's made on the owner's instruction.
 */
export type DryRunVerdict = {
  /** The id of the verdict comment. */
  commentId: number;
  url: string;
  pull: number;
  createdAt: string;
  wouldMerge: boolean;
  /** Why the PR would not auto-merge. Empty when it would. */
  reasons: Array<string>;
  thumbsUp: number;
  thumbsDown: number;
};

/** The owner's grade of a verdict: a 👎 disagrees, a 👍 alone agrees, and none is ungraded. */
export function gradeOf(verdict: DryRunVerdict) {
  if (verdict.thumbsDown > 0) {
    return 'disagree';
  }
  return verdict.thumbsUp > 0 ? 'agree' : null;
}

/** The reasons in a would-not verdict: its `- ` lines before the reaction request. */
export function verdictReasons(body: string) {
  if (!body.includes('would not auto-merge')) {
    return [];
  }
  return body
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim());
}

/**
 * How often the owner agrees with the auto-merge dry run. A 👎 is a
 * disagreement, a 👍 alone is an agreement, and no reaction is unanswered.
 * `streak` counts the agreements since the latest disagreement, newest first,
 * and skips unanswered verdicts. P1 ends at a streak of 20.
 */
export function dryRunAgreement(verdicts: Array<DryRunVerdict>) {
  const sorted = verdicts.toSorted((a, b) => time(a.createdAt) - time(b.createdAt));
  const agreed = sorted.filter((verdict) => verdict.thumbsDown === 0 && verdict.thumbsUp > 0);
  const disagreed = sorted.filter((verdict) => verdict.thumbsDown > 0);
  let streak = 0;
  for (const verdict of sorted.toReversed()) {
    if (verdict.thumbsDown > 0) {
      break;
    }
    if (verdict.thumbsUp > 0) {
      streak += 1;
    }
  }
  return {
    verdicts: sorted.length,
    wouldMerge: sorted.filter((verdict) => verdict.wouldMerge).length,
    agreed: agreed.length,
    disagreed: disagreed.length,
    unanswered: sorted.length - agreed.length - disagreed.length,
    streak,
    disagreedPulls: disagreed.map((verdict) => verdict.pull),
  };
}

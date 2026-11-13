import type { Gh } from '@/doctor/remote';
import { githubReader } from '@/metrics/collect';
import {
  ciMetrics,
  dryRunAgreement,
  gradeOf,
  flowMetrics,
  isDrill,
  isRevert,
  mainRedMinutes,
} from '@/metrics/compute';
import { factoryMetrics, withAgentReview } from '@/metrics/factory';
import type { FactoryMetrics } from '@/metrics/factory';
import { loopMetrics, loopRows, loopRuns, riseLimit, stepRunsToRead } from '@/metrics/loop';
import type { LoopMetrics, LoopTrend } from '@/metrics/loop';
import { agentBranchShare, byStep, prSize } from '@/metrics/pulls';

/**
 * The P2 exit in .clutch/PLAN.md: the share of PRs that merge with no human
 * action, and the revert rate that may not be passed. The Watch row flags each
 * one that misses.
 */
const watchTargets = { noHumanShare: 0.8, revertRate: 0.02 };

/** The label of the issues that propose to tighten a risk path after a revert. */
const tightenLabel = 'risk-tighten';

/** The issues that the checkout tracks, for the issues-done count. */
type LocalIssue = { status: string; pr: string };

type Options = {
  gh: Gh;
  repo: string;
  days: number;
  now: Date;
  /** The checkout's issues, or nothing for another repository or a checkout without them. */
  issues?: Array<LocalIssue>;
  /** The checkout's `pr.branchPrefix` and `pr_size.exclude`, or the defaults for another repository. */
  branchPrefix?: string;
  sizeExclude?: Array<string>;
  /** The login whose reactions grade the dry-run verdicts. See `verdictOwner`. */
  owner?: string | null;
};

/** Each field that the report leaves null, and why. CL-503b fills the reserved ones. */
type Unavailable = Record<string, string>;

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What needs a look: each P2 target that misses, main-red minutes and the open tighten issues. */
function watchOf(
  flow: ReturnType<typeof flowMetrics>,
  revertPulls: number,
  redMinutes: number | null,
  tighten: Array<{ number: number; title: string; url: string }> | null,
  loop: LoopMetrics | null,
) {
  const revertRate = flow.merged === 0 ? null : revertPulls / flow.merged;
  const noHumanShare = flow.noHumanAction.share;
  return {
    noHumanShare,
    noHumanBelowTarget: noHumanShare !== null && noHumanShare < watchTargets.noHumanShare,
    revertRate,
    revertsOverLimit: revertRate !== null && revertRate > watchTargets.revertRate,
    mainRedMinutes: redMinutes,
    tighten,
    loopRises: loop
      ? loopRows(loop)
          .filter(([, trend]) => trend.rise)
          .map(([name, trend]) => ({ name, change: trend.change }))
      : [],
  };
}

/**
 * The metrics of `repo` for the `days` days up to `now`. A section that GitHub
 * does not answer is null, with its reason under `unavailable`. Consumers must
 * ignore fields they do not know, so later issues can add fields.
 */
export async function metricsReport(options: Options) {
  const { gh, repo, days, now } = options;
  const reader = githubReader(gh, repo);
  const until = now.toISOString();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const unavailable: Unavailable = {};

  const numbers = await reader.mergedNumbers(since.slice(0, 10));
  const read = await reader.mergedPulls(numbers);
  const pulls = read.filter((pull) => pull.mergedAt >= since);
  const flow = flowMetrics(pulls, days);
  const branchPrefix = options.branchPrefix ?? 'clutch/cl-';
  let reviewRuns = new Map<string, string>();
  const [firstOpened] = pulls.map((pull) => pull.createdAt).toSorted();
  if (firstOpened) {
    try {
      reviewRuns = await reader.agentReviewRuns(firstOpened.slice(0, 10));
    } catch (error) {
      unavailable.agentReview = reason(error);
    }
  }
  const factory = factoryMetrics(
    pulls.map((pull) => withAgentReview(pull, reviewRuns)),
    { repo, branchPrefix },
  );

  let mainRed: { branch: string; requiredChecks: Array<string>; minutes: number } | null = null;
  let revertCommits: number | null = null;
  // A drill's revert commit is a rehearsal, so it is not counted as a revert on main.
  const drillCommits = new Set(pulls.filter(isDrill).map((pull) => pull.mergeSha));
  try {
    const branch = await reader.branch();
    const commits = await reader.mainCommits(branch.name, since);
    revertCommits = commits.filter(
      (commit) => isRevert(commit.message) && !drillCommits.has(commit.sha),
    ).length;
    if (branch.required.length === 0) {
      unavailable.mainRed = `${branch.name} requires no status checks.`;
    } else {
      mainRed = {
        branch: branch.name,
        requiredChecks: branch.required,
        minutes: mainRedMinutes(commits, branch.required, since, until),
      };
    }
  } catch (error) {
    unavailable.mainRed = reason(error);
    unavailable.revertCommits = reason(error);
  }

  let ci: ReturnType<typeof ciMetrics> | null = null;
  try {
    ci = ciMetrics(await reader.workflowRuns(since.slice(0, 10)));
  } catch (error) {
    unavailable.ci = reason(error);
  }

  // The period before is as long as this one, so each median has a baseline.
  let loop: LoopMetrics | null = null;
  try {
    const before = new Date(now.getTime() - 2 * days * 86_400_000).toISOString();
    const fetched = await reader.loopRuns(before.slice(0, 10));
    const runs = loopRuns(
      fetched.filter((run) => run.createdAt >= before),
      since,
    );
    const steps = await reader.stepSeconds(stepRunsToRead(runs).map((run) => run.id));
    loop = loopMetrics(runs, steps);
  } catch (error) {
    unavailable.loop = reason(error);
  }

  let agreement: ReturnType<typeof dryRunAgreement> | null = null;
  try {
    agreement = dryRunAgreement(await reader.dryRunVerdicts(since, options.owner));
    if (!options.owner) {
      unavailable.verdictOwner =
        'No owner in clutch.yaml automerge.owner or CODEOWNERS, so no reaction counts as a grade.';
    }
  } catch (error) {
    unavailable.dryRunAgreement = reason(error);
  }

  let tighten: Array<{ number: number; title: string; url: string }> | null = null;
  try {
    tighten = await reader.openIssues(tightenLabel);
  } catch (error) {
    unavailable.tighten = reason(error);
  }

  let issuesDone: number | null = null;
  if (options.issues) {
    const merged = new Set(pulls.map((pull) => `https://github.com/${repo}/pull/${pull.number}`));
    issuesDone = options.issues.filter(
      (issue) => issue.status === 'done' && merged.has(issue.pr),
    ).length;
  } else {
    unavailable.issuesDone = 'Counted only from the .clutch/issues of the checkout.';
  }

  const { revertPulls, drillPulls, ...rest } = flow;
  const pullsOut = {
    ...rest,
    noHumanAction: { ...rest.noHumanAction, byStep: byStep(pulls) },
    agents: {
      ...rest.agents,
      branch: agentBranchShare(pulls, branchPrefix),
    },
  };
  return {
    schemaVersion: 1,
    repo,
    since,
    until,
    days,
    factory,
    pulls: pullsOut,
    reverts: {
      pulls: revertPulls,
      commits: revertCommits,
      rate: flow.merged === 0 ? null : Math.round((revertPulls / flow.merged) * 1000) / 1000,
      drills: drillPulls,
    },
    mainRed,
    ci,
    issuesDone,
    prSize: prSize(pulls, options.sizeExclude ?? []),
    dryRunAgreement: agreement,
    loop,
    watch: watchOf(flow, revertPulls, mainRed?.minutes ?? null, tighten, loop),
    unavailable,
  };
}

export type MetricsReport = Awaited<ReturnType<typeof metricsReport>>;

const show = (value: number | null | undefined, unit = '') =>
  value === null || value === undefined ? 'n/a' : `${value}${unit}`;
const percent = (share: number | null) =>
  share === null ? 'n/a' : `${Math.round(share * 1000) / 10}%`;
const spread = (value: { p50: number | null; p90: number | null; count: number }, unit: string) =>
  `p50 ${show(value.p50, unit)}, p90 ${show(value.p90, unit)} (${value.count})`;

/** The factory numbers, with Warp's definitions, as the first rows of the table. */
function factoryRows(factory: FactoryMetrics): Array<[string, string]> {
  const { autonomy, cycleTimeHours: cycle, reverts } = factory;
  return [
    [
      'Autonomy',
      `${percent(autonomy.share)} (${autonomy.autonomous} of ${autonomy.merged} PRs with no human code push)`,
    ],
    ['Lane start to PR', spread(cycle.toPr, ' h')],
    ['Lane start to first review', spread(cycle.toFirstReview, ' h')],
    ['Lane start to merge', spread(cycle.toMerge, ' h')],
    [
      'Reverted PRs',
      `${percent(reverts.rate)} (${reverts.reverted} of ${reverts.merged}${reverts.pulls.length > 0 ? `: ${reverts.pulls.map((number) => `#${number}`).join(' ')}` : ''}), brake ${percent(reverts.brake)}`,
    ],
    ['Definitions', factory.definitions],
  ];
}

/** A loop median against the period before, such as `52 s (40 runs), was 48 s: +8.3%`. */
function loopValue(trend: LoopTrend) {
  if (trend.p50 === null) {
    return 'n/a (no passed runs)';
  }
  const median = `${Math.round(trend.p50)} s (${trend.count} runs)`;
  if (trend.previousP50 === null || trend.change === null) {
    return `${median}, no runs in the period before`;
  }
  const sign = trend.change > 0 ? '+' : '';
  const mark = trend.rise ? `, a rise over ${percent(riseLimit)}` : '';
  return `${median}, was ${Math.round(trend.previousP50)} s: ${sign}${percent(trend.change)}${mark}`;
}

/** One line: each P2 target that misses, main-red minutes, the open tighten issues and each loop time that rose. */
function watchLine(watch: MetricsReport['watch']) {
  const flags = [
    watch.noHumanBelowTarget
      ? `no human action ${percent(watch.noHumanShare)}, under the ${percent(watchTargets.noHumanShare)} target`
      : null,
    watch.revertsOverLimit
      ? `reverts ${percent(watch.revertRate)}, over the ${percent(watchTargets.revertRate)} limit`
      : null,
    watch.mainRedMinutes ? `main red ${watch.mainRedMinutes} min` : null,
    watch.tighten && watch.tighten.length > 0
      ? `tighten ${watch.tighten.map((issue) => `#${issue.number}`).join(' ')}`
      : null,
    ...watch.loopRises.map((item) => `${item.name} up ${percent(item.change)}`),
  ].filter(Boolean);
  return flags.length > 0 ? flags.join('; ') : 'nothing';
}

/** The report as a two-column table. */
export function renderMetrics(report: MetricsReport) {
  const { pulls } = report;
  const steps = pulls.noHumanAction.byStep;
  const sizes = Object.entries(report.prSize.labels)
    .map(([label, count]) => `${label} ${count}`)
    .join(', ');
  const agents = Object.entries(pulls.agents.byAgent)
    .map(([name, count]) => `${name} ${count}`)
    .join(', ');
  const { drills: drillCount } = report.reverts;
  const drills = drillCount > 0 ? `; ${drillCount} drill${drillCount === 1 ? '' : 's'}` : '';
  const rows: Array<[string, string]> = [
    [
      'Window',
      `${report.since.slice(0, 10)} to ${report.until.slice(0, 10)} (${report.days} days)`,
    ],
    ...factoryRows(report.factory),
    ['Merged PRs', `${pulls.merged} (${pulls.mergedPerDay} a day)`],
    [
      'Merged with no human action',
      `${pulls.noHumanAction.count} (${percent(pulls.noHumanAction.share)})`,
    ],
    ['Open to merge', spread(pulls.openToMergeHours, ' h')],
    ['Last green check to merge', spread(pulls.greenToMergeHours, ' h')],
    [
      'Main red',
      report.mainRed
        ? `${report.mainRed.minutes} min (${report.mainRed.requiredChecks.join(', ')})`
        : 'n/a',
    ],
    [
      'Reverts',
      `${report.reverts.pulls} PRs (${percent(report.reverts.rate)}), ${show(report.reverts.commits)} commits on main${drills}`,
    ],
    [
      'Agent share',
      `${percent(pulls.agents.pullShare)} of PRs, ${percent(pulls.agents.commitShare)} of ${pulls.agents.commits} commits${agents ? ` (${agents})` : ''}`,
    ],
    [
      'Agent branches',
      `${pulls.agents.branch.pulls} PRs (${percent(pulls.agents.branch.share)}) on ${pulls.agents.branch.prefix}*`,
    ],
    [
      'No human action by step',
      `bots ${steps.bots}, low ${steps.low}, medium ${steps.medium}, unattributed ${steps.unattributed} (${steps.marked} from auto-merge markers)`,
    ],
    ['PR size', `${spread(report.prSize.lines, ' lines')}; ${sizes}`],
    [
      'CI runs',
      report.ci
        ? `${report.ci.runs}, ${percent(report.ci.failureRate)} failed, ${spread(report.ci.durationMinutes, ' min')}`
        : 'n/a',
    ],
    ...(report.loop
      ? loopRows(report.loop).map(([name, trend]): [string, string] => [
          `${name}, p50`,
          loopValue(trend),
        ])
      : [['Loop time', 'n/a'] as [string, string]]),
    ['Issues done', show(report.issuesDone)],
    [
      'Dry-run agreement',
      report.dryRunAgreement
        ? `${report.dryRunAgreement.agreed} agreed, ${report.dryRunAgreement.disagreed} disagreed, ${report.dryRunAgreement.unanswered} unanswered of ${report.dryRunAgreement.verdicts}; streak ${report.dryRunAgreement.streak}`
        : 'n/a',
    ],
    ['Watch', watchLine(report.watch)],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  const lines = rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`);
  const notes = Object.entries(report.unavailable).map(([field, why]) => `  ${field}: ${why}`);
  const missing = notes.length > 0 ? ['', 'Unavailable:', ...notes] : [];
  return [`clutch metrics for ${report.repo}`, '', ...lines, ...missing].join('\n');
}

/**
 * The dry-run verdicts of `repo` in the window, for grading: the ungraded
 * ones, the ones the owner disagreed with, and the agreement streak.
 */
export async function verdictReport(options: Options) {
  const { gh, repo, days, now } = options;
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const verdicts = await githubReader(gh, repo).dryRunVerdicts(since, options.owner);
  const sorted = verdicts.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  const entry = (verdict: (typeof sorted)[number]) => ({
    commentId: verdict.commentId,
    pull: verdict.pull,
    url: verdict.url,
    createdAt: verdict.createdAt,
    verdict: verdict.wouldMerge ? 'would auto-merge' : 'would not auto-merge',
    reasons: verdict.reasons,
  });
  return {
    schemaVersion: 1,
    repo,
    owner: options.owner ?? null,
    since,
    agreement: dryRunAgreement(sorted),
    ungraded: sorted.filter((verdict) => gradeOf(verdict) === null).map(entry),
    disagreed: sorted.filter((verdict) => gradeOf(verdict) === 'disagree').map(entry),
  };
}

export type VerdictReport = Awaited<ReturnType<typeof verdictReport>>;

/** The ungraded verdicts as one line each, with the streak. */
export function renderVerdicts(report: VerdictReport) {
  const who = report.owner ? `@${report.owner}` : 'anyone (no owner found)';
  const lines = report.ungraded.map(
    (item) =>
      `#${item.pull}  ${item.verdict}${item.reasons.length > 0 ? `: ${item.reasons.join(' ')}` : ''}  ${item.url}`,
  );
  return [
    `Dry-run verdicts for ${report.repo}, graded by ${who}. Streak: ${report.agreement.streak} agreed in a row.`,
    '',
    lines.length > 0 ? `Ungraded (${lines.length}):` : 'Nothing to grade.',
    ...lines,
  ].join('\n');
}

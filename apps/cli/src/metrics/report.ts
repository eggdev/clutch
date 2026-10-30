import type { Gh } from '@/doctor/remote';
import { githubReader } from '@/metrics/collect';
import {
  ciMetrics,
  dryRunAgreement,
  flowMetrics,
  isRevert,
  mainRedMinutes,
} from '@/metrics/compute';
import { agentBranchShare, byStep, prSize } from '@/metrics/pulls';

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
};

/** Each field that the report leaves null, and why. CL-503b fills the reserved ones. */
type Unavailable = Record<string, string>;

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

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

  let mainRed: { branch: string; requiredChecks: Array<string>; minutes: number } | null = null;
  let revertCommits: number | null = null;
  try {
    const branch = await reader.branch();
    const commits = await reader.mainCommits(branch.name, since);
    revertCommits = commits.filter((commit) => isRevert(commit.message)).length;
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

  let agreement: ReturnType<typeof dryRunAgreement> | null = null;
  try {
    agreement = dryRunAgreement(await reader.dryRunVerdicts(since));
  } catch (error) {
    unavailable.dryRunAgreement = reason(error);
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

  const { revertPulls, ...rest } = flow;
  const pullsOut = {
    ...rest,
    noHumanAction: { ...rest.noHumanAction, byStep: byStep(pulls) },
    agents: {
      ...rest.agents,
      branch: agentBranchShare(pulls, options.branchPrefix ?? 'clutch/cl-'),
    },
  };
  return {
    schemaVersion: 1,
    repo,
    since,
    until,
    days,
    pulls: pullsOut,
    reverts: {
      pulls: revertPulls,
      commits: revertCommits,
      rate: flow.merged === 0 ? null : Math.round((revertPulls / flow.merged) * 1000) / 1000,
    },
    mainRed,
    ci,
    issuesDone,
    prSize: prSize(pulls, options.sizeExclude ?? []),
    dryRunAgreement: agreement,
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
  const rows: Array<[string, string]> = [
    [
      'Window',
      `${report.since.slice(0, 10)} to ${report.until.slice(0, 10)} (${report.days} days)`,
    ],
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
      `${report.reverts.pulls} PRs (${percent(report.reverts.rate)}), ${show(report.reverts.commits)} commits on main`,
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
    ['Issues done', show(report.issuesDone)],
    [
      'Dry-run agreement',
      report.dryRunAgreement
        ? `${report.dryRunAgreement.agreed} agreed, ${report.dryRunAgreement.disagreed} disagreed, ${report.dryRunAgreement.unanswered} unanswered of ${report.dryRunAgreement.verdicts}; streak ${report.dryRunAgreement.streak}`
        : 'n/a',
    ],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  const lines = rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`);
  const notes = Object.entries(report.unavailable).map(([field, why]) => `  ${field}: ${why}`);
  const missing = notes.length > 0 ? ['', 'Unavailable:', ...notes] : [];
  return [`clutch metrics for ${report.repo}`, '', ...lines, ...missing].join('\n');
}

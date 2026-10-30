import { changedLines, sizeLabel } from '@/labels/compute';
import { percentile } from '@/metrics/compute';

/** What CL-503b reads about one merged pull request, next to `MergedPull`. */
export type PullShape = {
  number: number;
  humanAction: boolean;
  headRef: string;
  /** The author's login and whether it is a bot. */
  author: { login: string; bot: boolean };
  labels: Array<string>;
  /** `git diff --numstat` rows, built from the API's per-file counts. */
  numstat: string;
  /** The step from a bot's `automerge-enabled` marker, when auto-merge left one. */
  markedStep?: string;
};

/** The auto-merge steps of CL-405, in order. */
export const steps = ['bots', 'low', 'medium'] as const;
type Step = (typeof steps)[number];

/** The marker that auto-merge leaves when it turns on a merge, as agreed with CL-405. */
export const enabledMarker = /<!-- automerge-enabled:(bots|low|medium):[0-9a-f]+ -->/u;

const botBranches = ['renovate/', 'gardening/'];

/**
 * The auto-merge step that explains a merge with no human action. A marker
 * from auto-merge wins. Without one, a bot author or a bot's branch is
 * `bots`, and the `risk/low` or `risk/medium` label gives the tier step.
 */
export function stepOf(pull: PullShape): {
  step: Step | 'unattributed';
  from: 'marker' | 'inferred';
} {
  if (pull.markedStep && (steps as ReadonlyArray<string>).includes(pull.markedStep)) {
    return { step: pull.markedStep as Step, from: 'marker' };
  }
  if (pull.author.bot || botBranches.some((prefix) => pull.headRef.startsWith(prefix))) {
    return { step: 'bots', from: 'inferred' };
  }
  if (pull.labels.includes('risk/low')) {
    return { step: 'low', from: 'inferred' };
  }
  if (pull.labels.includes('risk/medium')) {
    return { step: 'medium', from: 'inferred' };
  }
  return { step: 'unattributed', from: 'inferred' };
}

/** The merges with no human action, counted by auto-merge step. */
export function byStep(pulls: Array<PullShape>) {
  const counts: Record<Step | 'unattributed', number> = {
    bots: 0,
    low: 0,
    medium: 0,
    unattributed: 0,
  };
  let marked = 0;
  for (const pull of pulls.filter((item) => !item.humanAction)) {
    const { step, from } = stepOf(pull);
    counts[step] += 1;
    marked += from === 'marker' ? 1 : 0;
  }
  return { ...counts, marked };
}

/**
 * The size of the merged PRs, counted as `clutch labels` counts it: added
 * plus deleted lines without lockfiles, snapshots, `.clutch/` and the
 * project's `pr_size.exclude`.
 */
export function prSize(pulls: Array<PullShape>, exclude: Array<string>) {
  const lines = pulls.map((pull) => changedLines(pull.numstat, exclude));
  const labels: Record<string, number> = { 'size/S': 0, 'size/M': 0, 'size/L': 0, 'size/XL': 0 };
  for (const count of lines) {
    labels[sizeLabel(count).name] += 1;
  }
  return {
    lines: { p50: percentile(lines, 50), p90: percentile(lines, 90), count: lines.length },
    labels,
  };
}

/**
 * The share of merged PRs on an agent's branch, by its prefix. `pr open` runs
 * under the operator's login, so the branch tells an agent apart, not the author.
 */
export function agentBranchShare(pulls: Array<PullShape>, prefix: string) {
  const agent = pulls.filter((pull) => pull.headRef.startsWith(prefix)).length;
  return {
    prefix,
    pulls: agent,
    share: pulls.length === 0 ? null : Math.round((agent / pulls.length) * 1000) / 1000,
  };
}

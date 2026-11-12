import { botKind, revertedPr } from '@tools/github/bot-rule';

/**
 * The rules of auto-merge, without any GitHub call: the steps, the kinds of
 * pull request, the reasons a PR may not merge, and the comments the
 * Auto-merge workflow posts. tools/github/auto-merge.ts gathers the facts and
 * acts on them.
 */

/** An agent's branch starts with this prefix. A person can open a PR from such a branch, so the author counts too. */
const agentBranch = 'clutch/cl-';

export const modes = ['off', 'dry-run', 'on'] as const;
export type Mode = (typeof modes)[number];

/** How far auto-merge reaches, in order. Each step takes the PRs of the steps before it. */
export const steps = ['bots', 'low', 'medium'] as const;
export type Step = (typeof steps)[number];

/**
 * The revert brake: auto-merge steps down one step while reverts pass
 * `maxRevertRate` of the PRs merged in `window`, once there are `minMerged`.
 * Decision 0002 sets the 2% that tightens it on evidence.
 */
export const brake = { window: '30d', minMerged: 20, maxRevertRate: 0.02 };

/** The step that the brake gives: one step lower while the revert rate passes the limit. */
export function brakedStep(step: Step, merged: number, reverts: number): Step {
  if (merged < brake.minMerged || reverts / merged <= brake.maxRevertRate) {
    return step;
  }
  return steps[Math.max(steps.indexOf(step) - 1, 0)];
}

/** The sentence that the verdict gives when the brake steps down. */
export function brakeReason(merged: number, reverts: number, from: Step, to: Step) {
  const rate = ((reverts / merged) * 100).toFixed(1);
  return `Reverts are ${reverts} of ${merged} merged PRs in the last ${brake.window}, ${rate}%, over the ${brake.maxRevertRate * 100}% brake, so the step drops from ${from} to ${to}.`;
}

/** The step after `step`, which an `on` run calibrates. The last step calibrates itself. */
export const nextStep = (step: Step): Step => steps[Math.min(steps.indexOf(step) + 1, 2)];

/** Whether an `on` run is at the last step, which has no next step to calibrate, so it posts no dry-run comment. */
export const lastStepOn = (mode: Mode, step: Step) => mode === 'on' && nextStep(step) === step;

/** `owner` is the login whose approval of a head lets it merge at any tier. */
export type Config = { mode: Mode; step: Step; owner?: string };

export type Pr = {
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  author: { login: string; is_bot: boolean };
};

/** The facts a verdict needs. */
export type Facts = {
  pr: Pr;
  defaultBranch: string;
  tier: string;
  /** Each required check, with the conclusion of its latest run, `pending` or `missing`. */
  checks: Record<string, string>;
  /**
   * Agent review's `owner` findings on the head: the change weakens a check, a
   * lint rule, a budget or a test. They hold nothing. The verdict lists them,
   * and the weekly digest records them for the owner.
   */
  ownerFindings: Array<string>;
  /**
   * Each one-way change that the contract snapshot of the head names under
   * `breaks`, when the PR's own diff changes `contract.json`. The owner agrees
   * to a break, so each one leaves the PR for the owner, whatever its risk tier.
   */
  breaks: Array<string>;
  /** Why the PR is a major change, or nothing: a title with `!`, or a changeset in its diff that names a major bump. The owner signs off a major change, whatever its risk tier. */
  major: Array<string>;
  /** Why a bot PR fails its bot rule: a diff that is more than a version, or a revert that may not merge. Empty for an agent PR. */
  botProblems: Array<string>;
  /** Each required check that failed on the default branch's latest commit. */
  mainRed: Array<string>;
  /**
   * Whether `automerge.owner` approved the head commit, and gave no later
   * review that asks for changes. The owner's approval is the review that a
   * one-way-door PR waits for, so it lifts the tier, a contract break and a
   * major change.
   * The checks, a draft, the base and a red main still hold the PR.
   */
  ownerApproved: boolean;
};

/**
 * Whether the PR is an agent's: its head branch starts with `clutch/cl-`, or a
 * bot opened it. The release bot opens each agent PR, so the author is a bot.
 * A PR on a known bot's branch is never an agent's.
 */
export function isAgentPr(pr: Pick<Pr, 'headRefName' | 'author'>) {
  return (
    botKind(pr.headRefName) === null && (pr.headRefName.startsWith(agentBranch) || pr.author.is_bot)
  );
}

/** Why the PR is neither an agent's nor a bot's, or nothing. */
export function kindProblem(pr: Pr) {
  const bot = botKind(pr.headRefName);
  if (bot) {
    return pr.author.is_bot ? null : `The author of the ${bot} branch is not a bot.`;
  }
  return isAgentPr(pr)
    ? null
    : 'A person opened this pull request. Open it with `bun run pr open`, so the release bot opens it.';
}

/**
 * Why a revert PR may not merge without a person. It may when auto-merge merged
 * the PR it reverts, and its own risk tier is low or medium. `wasAutoMerged`
 * asks GitHub whether auto-merge merged a PR, so this file makes no GitHub call.
 */
export async function revertProblems(
  headRefName: string,
  tier: string,
  wasAutoMerged: (pr: string) => Promise<boolean>,
) {
  const reverted = revertedPr(headRefName);
  if (!reverted) {
    return ['The branch does not name the reverted pull request.'];
  }
  const problems: Array<string> = [];
  if (!(await wasAutoMerged(reverted))) {
    problems.push(`#${reverted} was not merged by auto-merge, so a person merges its revert.`);
  }
  if (tier !== 'low' && tier !== 'medium') {
    problems.push(`The risk tier is ${tier}, not low or medium.`);
  }
  return problems;
}

/** Why the PR's kind and tier are not in reach at `step`. */
function stepProblems(facts: Facts, step: Step): Array<string> {
  const { pr, tier, botProblems } = facts;
  if (!isAgentPr(pr)) {
    return botProblems;
  }
  if (facts.ownerApproved) {
    return [];
  }
  if (step === 'bots') {
    return ['Agent PRs auto-merge from the step low. The step is bots.'];
  }
  const reach = step === 'low' ? ['low'] : ['low', 'medium'];
  return reach.includes(tier) ? [] : [`The risk tier is ${tier}, not ${reach.join(' or ')}.`];
}

/** The reasons the pull request may not merge without a person at `step`. None means it may. */
export function blockers(facts: Facts, step: Step): Array<string> {
  const { pr, defaultBranch, checks, mainRed } = facts;
  const reasons: Array<string> = [];
  if (pr.state !== 'OPEN') {
    reasons.push(`The pull request is ${pr.state.toLowerCase()}.`);
  }
  if (pr.isDraft) {
    reasons.push('The pull request is a draft.');
  }
  if (pr.baseRefName !== defaultBranch) {
    reasons.push(`The base is ${pr.baseRefName}, not ${defaultBranch}. A stacked PR waits.`);
  }
  const kind = kindProblem(pr);
  if (kind) {
    reasons.push(kind);
  } else {
    reasons.push(...stepProblems(facts, step));
  }
  // The owner's approval of the head lifts the tier, a break and a major change.
  if (!facts.ownerApproved) {
    for (const name of facts.breaks) {
      reasons.push(`The contract snapshot names the break ${name}. The owner agrees to a break.`);
    }
    if (facts.major.length > 0) {
      reasons.push(
        `The change is major: ${facts.major.join(', and ')}. The owner signs off a major change.`,
      );
    }
  }
  for (const [name, conclusion] of Object.entries(checks)) {
    if (conclusion !== 'success') {
      reasons.push(`The required check ${name} is ${conclusion}.`);
    }
  }
  // A revert is how a red main turns green, so the red main does not hold it.
  if (botKind(pr.headRefName) !== 'revert') {
    for (const name of mainRed) {
      reasons.push(
        `The required check ${name} is red on ${defaultBranch}. Nothing merges until it is green.`,
      );
    }
  }
  return reasons;
}

/** The heading of the owner findings in a verdict and a dry-run comment. They hold nothing. */
const recordedHeading = 'Owner findings, recorded for the weekly digest:';

/**
 * The verdict that a run prints: whether the PR would auto-merge at `step`, the
 * reasons when it would not, and agent review's owner findings, which hold
 * nothing but stay visible for the weekly digest.
 */
export function verdictText(
  reasons: Array<string>,
  step: Step,
  findings: Array<string>,
  ownerApproved = false,
) {
  const approved = ownerApproved ? ' The owner approved this head.' : '';
  const verdict =
    reasons.length > 0
      ? `Would not auto-merge at the step ${step}:\n${reasons.map((reason) => `- ${reason}`).join('\n')}`
      : `Would auto-merge at the step ${step}.${approved}`;
  return findings.length > 0
    ? `${verdict}\n${recordedHeading}\n${findings.map((finding) => `- ${finding}`).join('\n')}`
    : verdict;
}

/** Marks the dry-run comment for one head commit, so a rerun does not repeat it. */
export const marker = (sha: string) => `<!-- automerge-dry-run:${sha} -->`;

/**
 * Marks the comment that says auto-merge is enabled for one head commit, and
 * at which step. The release bot posts it, so `clutch metrics` trusts it only
 * from a bot login, and counts each merge with no human action by its step.
 */
export const enabledMarker = (step: Step, sha: string) =>
  `<!-- automerge-enabled:${step}:${sha} -->`;

/** The line that asks the owner for the reaction that `clutch metrics` counts. */
export const reactionRequest = 'Owner: react 👍 if you agree with this verdict, or 👎 if not.';

/**
 * The dry-run comment: the verdict, the facts or the reasons behind it, the
 * owner findings that it records, and the reaction request. `reasons` is empty when the PR would auto-merge.
 */
export function dryRunComment(facts: Facts, reasons: Array<string>, step: Step) {
  const sha = facts.pr.headRefOid.slice(0, 7);
  const details =
    reasons.length > 0
      ? reasons.map((reason) => `- ${reason}`)
      : [
          `- Risk tier: \`${facts.tier}\``,
          `- Branch: \`${facts.pr.headRefName}\` into \`${facts.defaultBranch}\``,
          `- Required checks green: ${Object.keys(facts.checks)
            .map((name) => `\`${name}\``)
            .join(', ')}`,
          ...(facts.breaks.length > 0
            ? [
                `- Contract breaks the owner agreed to: ${facts.breaks.map((name) => `\`${name}\``).join(', ')}`,
              ]
            : []),
          ...(facts.major.length > 0
            ? [`- Major change the owner approved: ${facts.major.join(', and ')}`]
            : []),
        ];
  return [
    marker(facts.pr.headRefOid),
    `**Auto-merge dry run:** this pull request ${reasons.length > 0 ? 'would not' : 'would'} auto-merge at ${sha}.`,
    '',
    `At the step \`${step}\`:`,
    '',
    ...details,
    ...(facts.ownerFindings.length > 0
      ? ['', recordedHeading, ...facts.ownerFindings.map((finding) => `- ${finding}`)]
      : []),
    '',
    reactionRequest,
  ].join('\n');
}

/**
 * Why the dry run gives no verdict yet, or nothing when it can give one. A
 * verdict needs an open, ready agent PR whose required checks have all
 * finished, since the marker allows one verdict for each head commit.
 */
export function noVerdictYet({ pr, checks }: Facts) {
  if (pr.state !== 'OPEN' || pr.isDraft || !isAgentPr(pr)) {
    return 'The pull request is not an open, ready agent PR.';
  }
  const waiting = Object.entries(checks)
    .filter(([, conclusion]) => conclusion === 'pending' || conclusion === 'missing')
    .map(([name]) => name);
  return waiting.length > 0 ? `Waiting for ${waiting.join(', ')} to finish.` : undefined;
}

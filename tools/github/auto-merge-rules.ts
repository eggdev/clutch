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

export type Config = { mode: Mode; step: Step };

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
   * lint rule, a budget or a test. Each one leaves the PR for the owner.
   */
  ownerFindings: Array<string>;
  /** Why a bot PR fails its bot rule: a diff that is more than a version, or a revert that may not merge. Empty for an agent PR. */
  botProblems: Array<string>;
  /** Each required check that failed on the default branch's latest commit. */
  mainRed: Array<string>;
};

/**
 * Whether the PR is an agent's: its head branch starts with `clutch/cl-`, or a
 * bot opened it. The release bot opens each agent PR, so the author is a bot.
 * A PR on a known bot's branch is never an agent's.
 */
export function isAgentPr(pr: Pr) {
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

/** Why the PR's kind and tier are not in reach at `step`. */
function stepProblems(facts: Facts, step: Step): Array<string> {
  const { pr, tier, botProblems } = facts;
  if (!isAgentPr(pr)) {
    return botProblems;
  }
  if (step === 'bots') {
    return ['Agent PRs auto-merge from the step low. The step is bots.'];
  }
  const reach = step === 'low' ? ['low'] : ['low', 'medium'];
  return reach.includes(tier) ? [] : [`The risk tier is ${tier}, not ${reach.join(' or ')}.`];
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
  for (const [name, conclusion] of Object.entries(checks)) {
    if (conclusion !== 'success') {
      reasons.push(`The required check ${name} is ${conclusion}.`);
    }
  }
  for (const finding of facts.ownerFindings) {
    reasons.push(`Agent review asks the owner: ${finding}`);
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

/** The verdict that a run prints: whether the PR would auto-merge at `step`, and the reasons when it would not. */
export function verdictText(reasons: Array<string>, step: Step) {
  return reasons.length > 0
    ? `Would not auto-merge at the step ${step}:\n${reasons.map((reason) => `- ${reason}`).join('\n')}`
    : `Would auto-merge at the step ${step}.`;
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
 * The dry-run comment: the verdict, the facts or the reasons behind it, and
 * the reaction request. `reasons` is empty when the PR would auto-merge.
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
        ];
  return [
    marker(facts.pr.headRefOid),
    `**Auto-merge dry run:** this pull request ${reasons.length > 0 ? 'would not' : 'would'} auto-merge at ${sha}.`,
    '',
    `At the step \`${step}\`:`,
    '',
    ...details,
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

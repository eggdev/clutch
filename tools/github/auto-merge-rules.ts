import { botKind } from '@tools/github/bot-rule';

/**
 * The rules of auto-merge, without any GitHub call: the steps, the kinds of
 * pull request, the reasons a PR may not merge, and the comments the
 * Auto-merge workflow posts. tools/github/auto-merge.ts gathers the facts and
 * acts on them.
 */

/** Only an agent opens a branch with this prefix. `pr open` runs under the operator's login, so the author cannot tell. */
const agentBranch = 'clutch/cl-';

export const modes = ['off', 'dry-run', 'on'] as const;
export type Mode = (typeof modes)[number];

/** How far auto-merge reaches, in order. Each step takes the PRs of the steps before it. */
export const steps = ['bots', 'low', 'medium'] as const;
export type Step = (typeof steps)[number];

/** The step after `step`, which an `on` run calibrates. The last step calibrates itself. */
export const nextStep = (step: Step): Step => steps[Math.min(steps.indexOf(step) + 1, 2)];

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
  /** Why a bot PR's diff fails the bot rule. Empty for an agent PR. */
  botProblems: Array<string>;
  /** Each required check that failed on the default branch's latest commit. */
  mainRed: Array<string>;
};

/** Why the PR is neither an agent's nor a bot's, or nothing. */
export function kindProblem(pr: Pr) {
  if (pr.headRefName.startsWith(agentBranch)) {
    return null;
  }
  const bot = botKind(pr.headRefName);
  if (!bot) {
    return `The head branch is neither an agent's (${agentBranch}) nor a bot's (renovate/, gardening/).`;
  }
  return pr.author.is_bot ? null : `The author of the ${bot} branch is not a bot.`;
}

/** Why the PR's kind and tier are not in reach at `step`. */
function stepProblems({ pr, tier, botProblems }: Facts, step: Step): Array<string> {
  if (!pr.headRefName.startsWith(agentBranch)) {
    return botProblems;
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
  for (const [name, conclusion] of Object.entries(checks)) {
    if (conclusion !== 'success') {
      reasons.push(`The required check ${name} is ${conclusion}.`);
    }
  }
  for (const name of mainRed) {
    reasons.push(
      `The required check ${name} is red on ${defaultBranch}. Nothing merges until it is green.`,
    );
  }
  return reasons;
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
  if (pr.state !== 'OPEN' || pr.isDraft || !pr.headRefName.startsWith(agentBranch)) {
    return 'The pull request is not an open, ready agent PR.';
  }
  const waiting = Object.entries(checks)
    .filter(([, conclusion]) => conclusion === 'pending' || conclusion === 'missing')
    .map(([name]) => name);
  return waiting.length > 0 ? `Waiting for ${waiting.join(', ')} to finish.` : undefined;
}

import path from 'node:path';
import { parseArgs } from 'node:util';

import { botKind, renovateProblems } from '@tools/github/bot-rule';
import type { ChangedFile } from '@tools/github/bot-rule';
import type { Run } from '@tools/github/stack';

/**
 * Decides whether a pull request may merge without a person, and acts on
 * `automerge` in clutch.yaml. `step` sets how far auto-merge reaches: `bots`
 * takes Renovate and gardening PRs that pass the bot rule, `low` also takes
 * low-risk agent PRs, and `medium` also takes medium-risk ones. `on` queues
 * GitHub's auto-merge for each PR that may merge, and never while a required
 * check is red on the default branch. `dry-run` and `on` comment a verdict
 * once for each head commit of an agent PR, so the owner can grade it: at the
 * step for `dry-run`, and at the next step for `on`. `off` only prints. The Auto-merge
 * workflow runs it from the base branch, so a pull request cannot change the
 * rules that judge it. See .agents/skills/deliver/references/pull-requests.md#auto-merge.
 */
const usage = 'Usage: bun tools/github/auto-merge.ts --pr <number> --head <sha>';

const root = path.resolve(import.meta.dir, '../..');

/** Only an agent opens a branch with this prefix. `pr open` runs under the operator's login, so the author cannot tell. */
export const agentBranch = 'clutch/cl-';

/** The check that agent review reports. It joins the required checks of the default branch. */
const agentReview = 'agent-review';

const modes = ['off', 'dry-run', 'on'] as const;
type Mode = (typeof modes)[number];

/** How far auto-merge reaches, in order. Each step takes the PRs of the steps before it. */
export const steps = ['bots', 'low', 'medium'] as const;
export type Step = (typeof steps)[number];

/** The step after `step`, which an `on` run calibrates. The last step calibrates itself. */
export const nextStep = (step: Step): Step => steps[Math.min(steps.indexOf(step) + 1, 2)];

export type Config = { mode: Mode; step: Step };

type Pr = {
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
function kindProblem(pr: Pr) {
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

async function must(run: Run, command: Array<string>) {
  const result = await run(command);
  if (!result.ok) {
    throw new Error(`${command.join(' ')} failed: ${result.err || result.out}`);
  }
  return result.out.trim();
}

const gh = (run: Run, ...args: Array<string>) => must(run, ['gh', ...args]);

/** `automerge` in clutch.yaml. A project without it is `off`, and the step defaults to `bots`. */
async function readConfig(): Promise<Config> {
  const file = Bun.file(path.join(root, 'clutch.yaml'));
  const config = (await file.exists())
    ? (Bun.YAML.parse(await file.text()) as Record<string, unknown>)
    : {};
  const automerge = (config.automerge ?? {}) as { mode?: unknown; step?: unknown };
  const mode = automerge.mode ?? 'off';
  const step = automerge.step ?? 'bots';
  if (!(modes as ReadonlyArray<unknown>).includes(mode)) {
    throw new Error(`clutch.yaml: automerge.mode must be one of ${modes.join(', ')}.`);
  }
  if (!(steps as ReadonlyArray<unknown>).includes(step)) {
    throw new Error(`clutch.yaml: automerge.step must be one of ${steps.join(', ')}.`);
  }
  return { mode: mode as Mode, step: step as Step };
}

/** The required status checks of the default branch, plus agent review. */
async function requiredChecks(run: Run, repo: string, branch: string) {
  const out = await gh(
    run,
    'api',
    `repos/${repo}/rules/branches/${branch}`,
    '--jq',
    '[.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context]',
  );
  return [...new Set([...(JSON.parse(out) as Array<string>), agentReview])];
}

/** The conclusion of the latest run of each check in `names` on commit `sha`. */
async function checkConclusions(run: Run, repo: string, sha: string, names: Array<string>) {
  const out = await gh(
    run,
    'api',
    '--paginate',
    `repos/${repo}/commits/${sha}/check-runs?per_page=100`,
    '--jq',
    '.check_runs[] | {id, name, status, conclusion}',
  );
  const latest = new Map<string, { id: number; status: string; conclusion: string | null }>();
  for (const line of out.split('\n').filter(Boolean)) {
    const runInfo = JSON.parse(line) as {
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
    };
    if ((latest.get(runInfo.name)?.id ?? -1) < runInfo.id) {
      latest.set(runInfo.name, runInfo);
    }
  }
  return Object.fromEntries(
    names.map((name) => {
      const found = latest.get(name);
      if (!found) {
        return [name, 'missing'];
      }
      return [name, found.status === 'completed' ? (found.conclusion ?? 'pending') : 'pending'];
    }),
  );
}

async function riskTier(run: Run, defaultBranch: string, sha: string) {
  const out = await must(run, [
    'bun',
    'tools/clutch.ts',
    'risk',
    '--base',
    `origin/${defaultBranch}`,
    '--head',
    sha,
    '--json',
  ]);
  return (JSON.parse(out) as { tier: string }).tier;
}

async function hasMarker(run: Run, repo: string, pr: string, text: string) {
  const out = await gh(
    run,
    'api',
    '--paginate',
    `repos/${repo}/issues/${pr}/comments`,
    '--jq',
    '.[].body',
  );
  return out.includes(text);
}

/** The changed files of a pull request, with their diffs. */
async function changedFiles(run: Run, repo: string, pr: string): Promise<Array<ChangedFile>> {
  const out = await gh(
    run,
    'api',
    '--paginate',
    `repos/${repo}/pulls/${pr}/files?per_page=100`,
    '--jq',
    '.[] | {filename, patch}',
  );
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChangedFile);
}

/** A conclusion that makes a check red. */
const red = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']);

/** Each required check that is red on the latest commit of `branch`. A pending check is not red. */
async function redOn(run: Run, repo: string, branch: string, names: Array<string>) {
  const sha = await gh(run, 'api', `repos/${repo}/commits/${branch}`, '--jq', '.sha');
  const checks = await checkConclusions(run, repo, sha, names);
  return names.filter((name) => red.has(checks[name]));
}

/** Marks the comment that says a merge is queued for one head commit. */
export const queuedMarker = (sha: string) => `<!-- automerge-queued:${sha} -->`;

/** Runs the auto-merge decision for one pull request. Returns the exit code. */
export async function runAutoMerge(
  args: Array<string>,
  run: Run,
  config: Config,
  log: (line: string) => void = console.log,
): Promise<number> {
  const { mode, step } = config;
  const { values } = parseArgs({
    args,
    options: { pr: { type: 'string' }, head: { type: 'string' } },
  });
  if (!values.pr || !values.head) {
    throw new Error(usage);
  }
  const repo = await gh(run, 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner');
  const defaultBranch = await gh(
    run,
    'repo',
    'view',
    '--json',
    'defaultBranchRef',
    '--jq',
    '.defaultBranchRef.name',
  );
  const pr = JSON.parse(
    await gh(
      run,
      'pr',
      'view',
      values.pr,
      '--json',
      'state,isDraft,baseRefName,headRefName,headRefOid,author',
    ),
  ) as Pr;
  if (pr.headRefOid !== values.head) {
    log(
      `The head moved from ${values.head} to ${pr.headRefOid}. The run for the new head decides.`,
    );
    return 0;
  }
  const kind = kindProblem(pr);
  if (kind) {
    log(`Not judged: ${kind}`);
    return 0;
  }
  const bot = botKind(pr.headRefName);
  const names = await requiredChecks(run, repo, defaultBranch);
  const tier = await riskTier(run, defaultBranch, pr.headRefOid);
  let botProblems: Array<string> = [];
  if (bot === 'renovate') {
    botProblems = renovateProblems(await changedFiles(run, repo, values.pr));
  } else if (bot === 'gardening' && tier !== 'low') {
    botProblems = [`The gardening PR's risk tier is ${tier}, not low.`];
  }
  const facts: Facts = {
    pr,
    defaultBranch,
    tier,
    checks: await checkConclusions(run, repo, pr.headRefOid, names),
    botProblems,
    mainRed: await redOn(run, repo, defaultBranch, names),
  };
  const reasons = blockers(facts, step);
  const verdict =
    reasons.length > 0
      ? `Would not auto-merge at the step ${step}:\n${reasons.map((reason) => `- ${reason}`).join('\n')}`
      : `Would auto-merge at the step ${step}.`;
  if (mode === 'on' && reasons.length === 0) {
    await gh(run, 'pr', 'merge', values.pr, '--auto', '--merge');
    if (!(await hasMarker(run, repo, values.pr, queuedMarker(pr.headRefOid)))) {
      const body = `${queuedMarker(pr.headRefOid)}\n**Auto-merge:** queued at ${pr.headRefOid.slice(0, 7)}, at the step \`${step}\`. GitHub merges it with a merge commit once the required checks pass. To stop it, run \`gh pr merge --disable-auto ${values.pr}\`.`;
      await gh(run, 'pr', 'comment', values.pr, '--body', body);
    }
    log(`${verdict}\nQueued the merge.`);
    return 0;
  }
  if (mode === 'off' || bot) {
    log(verdict);
    return 0;
  }
  const calibrate = mode === 'on' ? nextStep(step) : step;
  const graded = blockers(facts, calibrate);
  const wait = noVerdictYet(facts);
  if (wait) {
    log(`${verdict}\nNo dry-run comment: ${wait}`);
    return 0;
  }
  if (await hasMarker(run, repo, values.pr, marker(pr.headRefOid))) {
    log(`${verdict}\nThe dry-run comment for this head is already there.`);
    return 0;
  }
  await gh(run, 'pr', 'comment', values.pr, '--body', dryRunComment(facts, graded, calibrate));
  log(`${verdict}\nPosted the dry-run comment for the step ${calibrate}.`);
  return 0;
}

const spawn: Run = async (command) => {
  const proc = Bun.spawn(command, { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, out, err };
};

if (import.meta.main) {
  try {
    process.exit(await runAutoMerge(process.argv.slice(2), spawn, await readConfig()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

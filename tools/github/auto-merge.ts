import path from 'node:path';
import { parseArgs } from 'node:util';

import type { Run } from '@tools/github/stack';

/**
 * Decides whether a pull request may merge without a person, and acts on the
 * `automerge.mode` in clutch.yaml. `dry-run` comments its verdict, would or
 * would not auto-merge, once for each head commit of an agent PR. `on` queues
 * the merge, and `off` only prints. The Auto-merge
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

type Pr = {
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
};

/** The facts a verdict needs. */
export type Facts = {
  pr: Pr;
  defaultBranch: string;
  tier: string;
  /** Each required check, with the conclusion of its latest run, `pending` or `missing`. */
  checks: Record<string, string>;
};

/** The reasons the pull request may not merge without a person. None means it may. */
export function blockers({ pr, defaultBranch, tier, checks }: Facts): Array<string> {
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
  if (!pr.headRefName.startsWith(agentBranch)) {
    reasons.push(`The head branch does not start with ${agentBranch}.`);
  }
  if (tier !== 'low') {
    reasons.push(`The risk tier is ${tier}, not low.`);
  }
  for (const [name, conclusion] of Object.entries(checks)) {
    if (conclusion !== 'success') {
      reasons.push(`The required check ${name} is ${conclusion}.`);
    }
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
export function dryRunComment(facts: Facts, reasons: Array<string>) {
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

/** The `automerge.mode` in clutch.yaml. A project without the key is `off`. */
async function readMode(): Promise<Mode> {
  const file = Bun.file(path.join(root, 'clutch.yaml'));
  const config = (await file.exists())
    ? (Bun.YAML.parse(await file.text()) as Record<string, unknown>)
    : {};
  const mode = (config.automerge as { mode?: unknown } | undefined)?.mode ?? 'off';
  if (!(modes as ReadonlyArray<unknown>).includes(mode)) {
    throw new Error(`clutch.yaml: automerge.mode must be one of ${modes.join(', ')}.`);
  }
  return mode as Mode;
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

async function hasMarker(run: Run, repo: string, pr: string, sha: string) {
  const out = await gh(
    run,
    'api',
    '--paginate',
    `repos/${repo}/issues/${pr}/comments`,
    '--jq',
    '.[].body',
  );
  return out.includes(marker(sha));
}

/** Runs the auto-merge decision for one pull request. Returns the exit code. */
export async function runAutoMerge(
  args: Array<string>,
  run: Run,
  mode: Mode,
  log: (line: string) => void = console.log,
): Promise<number> {
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
      'state,isDraft,baseRefName,headRefName,headRefOid',
    ),
  ) as Pr;
  if (pr.headRefOid !== values.head) {
    log(
      `The head moved from ${values.head} to ${pr.headRefOid}. The run for the new head decides.`,
    );
    return 0;
  }
  const names = await requiredChecks(run, repo, defaultBranch);
  const facts: Facts = {
    pr,
    defaultBranch,
    tier: await riskTier(run, defaultBranch, pr.headRefOid),
    checks: await checkConclusions(run, repo, pr.headRefOid, names),
  };
  const reasons = blockers(facts);
  const verdict =
    reasons.length > 0
      ? `Would not auto-merge:\n${reasons.map((reason) => `- ${reason}`).join('\n')}`
      : 'Would auto-merge.';
  if (mode === 'on' && reasons.length === 0) {
    await gh(run, 'pr', 'merge', values.pr, '--auto', '--merge');
    log('Queued the merge.');
    return 0;
  }
  if (mode !== 'dry-run') {
    log(verdict);
    return 0;
  }
  const wait = noVerdictYet(facts);
  if (wait) {
    log(`${verdict}\nNo dry-run comment: ${wait}`);
    return 0;
  }
  if (await hasMarker(run, repo, values.pr, pr.headRefOid)) {
    log(`${verdict}\nThe dry-run comment for this head is already there.`);
    return 0;
  }
  await gh(run, 'pr', 'comment', values.pr, '--body', dryRunComment(facts, reasons));
  log(`${verdict}\nPosted the dry-run comment.`);
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
    process.exit(await runAutoMerge(process.argv.slice(2), spawn, await readMode()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

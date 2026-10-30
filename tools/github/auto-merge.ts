import path from 'node:path';
import { parseArgs } from 'node:util';

import {
  blockers,
  dryRunComment,
  enabledMarker,
  kindProblem,
  marker,
  modes,
  nextStep,
  noVerdictYet,
  steps,
} from '@tools/github/auto-merge-rules';
import type { Config, Facts, Mode, Pr, Step } from '@tools/github/auto-merge-rules';
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

/** The check that agent review reports. It joins the required checks of the default branch. */
const agentReview = 'agent-review';

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
    if (!(await hasMarker(run, repo, values.pr, enabledMarker(step, pr.headRefOid)))) {
      const body = `${enabledMarker(step, pr.headRefOid)}\n**Auto-merge:** queued at ${pr.headRefOid.slice(0, 7)}, at the step \`${step}\`. GitHub merges it with a merge commit once the required checks pass. To stop it, run \`gh pr merge --disable-auto ${values.pr}\`.`;
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

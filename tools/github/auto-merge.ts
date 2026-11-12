import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { judgeAtStep } from '@tools/github/auto-merge-brake';
import { actionsApp, checkConclusions } from '@tools/github/auto-merge-checks';
import { enableAutoMerge, gh, hasMarker, must } from '@tools/github/auto-merge-enable';
import {
  blockers,
  dryRunComment,
  kindProblem,
  lastStepOn,
  marker,
  modes,
  nextStep,
  noVerdictYet,
  revertProblems,
  steps,
} from '@tools/github/auto-merge-rules';
import type { Config, Facts, Mode, Pr, Step } from '@tools/github/auto-merge-rules';
import { autoMerged } from '@tools/github/auto-revert';
import { botKind, renovateProblems, syncProblems } from '@tools/github/bot-rule';
import type { ChangedFile } from '@tools/github/bot-rule';
import { retrying } from '@tools/github/command';
import type { Run } from '@tools/github/stack';

/**
 * Decides whether a pull request may merge without a person, and acts on
 * `automerge` in clutch.yaml. `step` sets how far auto-merge reaches: `bots`
 * takes Renovate and gardening PRs that pass the bot rule, `low` also takes
 * low-risk agent PRs, and `medium` also takes medium-risk ones. `on` queues
 * GitHub's auto-merge for each PR that may merge, and never while a required
 * check is red on the default branch, except for a revert. `dry-run` and `on`
 * comment a verdict once for each head commit of an agent PR, so the owner can
 * grade it: at the step for `dry-run`, and at the next step for `on`. `off` only
 * prints. The approval of `automerge.owner` on the head lifts the tier and the
 * owner findings, so a PR that waits for the owner merges once they approve. The Auto-merge workflow runs it from the base branch, so a pull request
 * cannot change the rules that judge it. See .agents/skills/deliver/references/pull-requests.md#auto-merge.
 */
const usage = [
  'Usage: bun tools/github/auto-merge.ts --pr <number> --head <sha>',
  '       bun tools/github/auto-merge.ts --enable --pr <number> --head <sha> --step <step>',
].join('\n');

const root = path.resolve(import.meta.dir, '../..');

/** The check that agent review reports. It joins the required checks of the default branch. */
const agentReview = 'agent-review';

/** The check that a project's CI runs for Clutch: `clutch doctor --check`. No ruleset requires it, so the rule reads it. */
const doctorCheck = 'clutch / doctor';

/** `automerge` in clutch.yaml. A project without it is `off`, and the step defaults to `bots`. */
export async function readConfig(): Promise<Config> {
  const file = Bun.file(path.join(root, 'clutch.yaml'));
  const config = (await file.exists())
    ? (Bun.YAML.parse(await file.text()) as Record<string, unknown>)
    : {};
  const automerge = (config.automerge ?? {}) as { mode?: unknown; step?: unknown; owner?: unknown };
  const mode = automerge.mode ?? 'off';
  const step = automerge.step ?? 'bots';
  if (!(modes as ReadonlyArray<unknown>).includes(mode)) {
    throw new Error(`clutch.yaml: automerge.mode must be one of ${modes.join(', ')}.`);
  }
  if (!(steps as ReadonlyArray<unknown>).includes(step)) {
    throw new Error(`clutch.yaml: automerge.step must be one of ${steps.join(', ')}.`);
  }
  const owner =
    typeof automerge.owner === 'string' && automerge.owner ? automerge.owner : undefined;
  return { mode: mode as Mode, step: step as Step, owner };
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

/**
 * Whether `owner` approved `sha`: their latest review that approves or asks
 * for changes approves, and names that commit. A review on an older head, or
 * a later request for changes, does not count.
 */
export async function ownerApproved(
  run: Run,
  repo: string,
  pr: string,
  sha: string,
  owner?: string,
) {
  if (!owner) {
    return false;
  }
  const out = await gh(
    run,
    'api',
    '--paginate',
    `repos/${repo}/pulls/${pr}/reviews`,
    '--jq',
    `.[] | select(.user.login == "${owner}" and (.state == "APPROVED" or .state == "CHANGES_REQUESTED")) | [.state, .commit_id] | @tsv`,
  );
  const last = out.split('\n').findLast(Boolean)?.split('\t');
  return last?.[0] === 'APPROVED' && last[1] === sha;
}

/** The title of the annotation that agent review writes for an `owner` finding. */
export const ownerAnnotation = 'Owner review needed';

/**
 * The `owner` findings of the latest agent-review run on `sha`: the messages of
 * its "Owner review needed" annotations. Only the GitHub Actions app's run
 * counts, and only that job can write its annotations, so an agent cannot
 * remove one the way it could remove a label.
 */
export async function ownerFindings(run: Run, repo: string, sha: string) {
  const ids = await gh(
    run,
    'api',
    `repos/${repo}/commits/${sha}/check-runs?check_name=${agentReview}&per_page=100`,
    '--jq',
    `.check_runs[] | select(.app.slug == "${actionsApp}") | .id`,
  );
  const latest = Math.max(0, ...ids.split('\n').filter(Boolean).map(Number));
  if (latest === 0) {
    return [];
  }
  const out = await gh(
    run,
    'api',
    `repos/${repo}/check-runs/${latest}/annotations`,
    '--jq',
    `.[] | select(.title == "${ownerAnnotation}") | .message`,
  );
  return out.split('\n').filter(Boolean);
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

const isString = (value: unknown): value is string => typeof value === 'string';

/**
 * The one-way changes that the contract snapshot at `sha` names under `breaks`,
 * when pull request `pr` changes `contract.json`. A pull request that leaves the
 * file alone has none, so a break counts only in the pull request that makes it.
 * A snapshot whose `breaks` is not a list of strings is refused, as is any other
 * failure of the read.
 */
export async function contractBreaks(run: Run, repo: string, pr: string, sha: string) {
  const changed = await changedFiles(run, repo, pr);
  if (!changed.some((file) => file.filename === 'contract.json')) {
    return [];
  }
  const endpoint = `repos/${repo}/contents/contract.json?ref=${sha}`;
  const result = await run(['gh', 'api', endpoint, '--jq', '.content | @base64d']);
  if (!result.ok) {
    if (/HTTP 404/u.test(result.err)) {
      return [];
    }
    throw new Error(`gh api ${endpoint} failed: ${result.err || result.out}`);
  }
  const snapshot: unknown = JSON.parse(result.out);
  const breaks =
    typeof snapshot === 'object' && snapshot !== null && 'breaks' in snapshot
      ? snapshot.breaks
      : undefined;
  if (!Array.isArray(breaks)) {
    throw new TypeError(`contract.json at ${sha}: \`breaks\` is not a list of strings.`);
  }
  const names = breaks.filter(isString);
  if (names.length !== breaks.length) {
    throw new TypeError(`contract.json at ${sha}: \`breaks\` is not a list of strings.`);
  }
  return names;
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

/** The managed files that `.clutch/lineage.json` lists at `sha`, from the checkout. None without one. */
async function syncedFiles(run: Run, sha: string) {
  const lineage = await run(['git', 'show', `${sha}:.clutch/lineage.json`]);
  if (!lineage.ok) {
    return new Set<string>();
  }
  return new Set(Object.keys((JSON.parse(lineage.out) as { files?: object }).files ?? {}));
}

/** A conclusion that makes a check red. */
const red = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']);

/** Each required check that is red on the latest commit of `branch`. A pending check is not red. */
async function redOn(run: Run, repo: string, branch: string, names: Array<string>) {
  const sha = await gh(run, 'api', `repos/${repo}/commits/${branch}`, '--jq', '.sha');
  const checks = await checkConclusions(run, repo, sha, names);
  return names.filter((name) => red.has(checks[name]));
}

/**
 * Hands a merge to the workflow's merge job, which alone may use the release
 * bot's key. Without it, the run enables auto-merge itself.
 */
export type Handoff = (step: Step) => Promise<void>;

/** Runs the auto-merge decision for one pull request. Returns the exit code. */
export async function runAutoMerge(
  args: Array<string>,
  run: Run,
  config: Config,
  log: (line: string) => void = console.log,
  handoff?: Handoff,
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
  } else if (bot === 'clutch-sync') {
    botProblems = syncProblems(
      await changedFiles(run, repo, values.pr),
      await syncedFiles(run, pr.headRefOid),
    );
  } else if (bot === 'gardening' && !['low', 'medium'].includes(tier)) {
    botProblems = [`The gardening PR's risk tier is ${tier}, not low or medium.`];
  } else if (bot === 'revert') {
    botProblems = await revertProblems(pr.headRefName, tier, (n) => autoMerged(run, repo, n));
  }
  const conclusions = await checkConclusions(run, repo, pr.headRefOid, [...names, doctorCheck]);
  const { [doctorCheck]: doctor, ...checks } = conclusions;
  const facts: Facts = {
    pr,
    defaultBranch,
    tier,
    checks,
    doctor,
    ownerFindings: await ownerFindings(run, repo, pr.headRefOid),
    breaks: await contractBreaks(run, repo, values.pr, pr.headRefOid),
    botProblems,
    mainRed: await redOn(run, repo, defaultBranch, names),
    ownerApproved: await ownerApproved(run, repo, values.pr, pr.headRefOid, config.owner),
  };
  const { effective, reasons, verdict } = await judgeAtStep(run, facts, step, log);
  if (mode === 'on' && reasons.length === 0) {
    if (handoff) {
      await handoff(effective);
      log(`${verdict}\nHanded the merge to the merge job.`);
    } else {
      await enableAutoMerge(run, repo, values.pr, pr.headRefOid, effective);
      log(`${verdict}\nQueued the merge.`);
    }
    return 0;
  }
  if (mode === 'off' || bot) {
    log(verdict);
    return 0;
  }
  if (lastStepOn(mode, effective)) {
    log(`${verdict}\nNo dry-run comment: the step ${effective} is the last.`);
    return 0;
  }
  const calibrate = mode === 'on' ? nextStep(effective) : effective;
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

/** The command line: a decision, or `--enable` from the merge job. */
async function main(args: Array<string>) {
  if (!args.includes('--enable')) {
    // In the workflow, the decide job holds no bot key, so it hands the merge on.
    const output = process.env.GITHUB_OUTPUT;
    const handoff: Handoff | undefined =
      output && process.env.AUTOMERGE_HANDOFF === '1'
        ? async (step) => {
            await appendFile(output, `merge=true\nstep=${step}\n`);
          }
        : undefined;
    return runAutoMerge(args, retrying, await readConfig(), console.log, handoff);
  }
  const { values } = parseArgs({
    args,
    options: {
      enable: { type: 'boolean' },
      pr: { type: 'string' },
      head: { type: 'string' },
      step: { type: 'string' },
    },
  });
  const step = values.step as Step;
  if (!values.pr || !values.head || !(steps as ReadonlyArray<string>).includes(step)) {
    throw new Error(usage);
  }
  const repo = await gh(
    retrying,
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '--jq',
    '.nameWithOwner',
  );
  await enableAutoMerge(retrying, repo, values.pr, values.head, step);
  console.log(`Enabled auto-merge for #${values.pr} at ${values.head.slice(0, 7)}, step ${step}.`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

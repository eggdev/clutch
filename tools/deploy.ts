import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  mergedPr,
  pullOf,
  revertStarted,
  revertable,
  startRevert,
} from '@tools/github/auto-revert';
import type { Pull } from '@tools/github/auto-revert';
import { botKind } from '@tools/github/bot-rule';
import { must } from '@tools/github/github';
import { ask } from '@tools/github/needs-owner';
import type { Run } from '@tools/github/stack';
import { parse } from 'yaml';

/**
 * Deploys a green `main` and proves it, from `.github/workflows/deploy.yml`.
 * `deploy:` in clutch.yaml names the command and the production URL:
 *
 * - `run` deploys. A project that names a deploy and fails it is red, so a
 *   skipped deploy cannot look green.
 * - `prove` runs the core journeys on production, and runs them once more on
 *   a failure. A second failure marks the deploy red. It reverts the PR of the
 *   commit when auto-merge merged it, as a red CI run does. When no revert is
 *   possible, it opens one question for the owner that names the commit.
 * - `check` fails a project past kickoff with a shippable app and no deploy.
 *
 * See docs/principles/proof-gates-code.md#a-gate-with-no-proof-fails.
 */
export type Deploy = { command: Array<string>; url: string };

export function deployOf(root: string) {
  const file = path.join(root, 'clutch.yaml');
  if (!existsSync(file)) {
    return null;
  }
  return (parse(readFileSync(file, 'utf-8')) as { deploy?: Deploy } | null)?.deploy ?? null;
}

/** The problem with a project past kickoff that ships an app and names no deploy, or null. */
export function deployProblem(root: string) {
  if (existsSync(path.join(root, 'KICKOFF.md')) || deployOf(root)) {
    return null;
  }
  const apps = path.join(root, 'apps');
  const shippable =
    existsSync(apps) &&
    readdirSync(apps).some((name) => {
      const manifest = path.join(apps, name, 'package.json');
      if (!existsSync(manifest)) {
        return false;
      }
      const tags = (
        JSON.parse(readFileSync(manifest, 'utf-8')) as { nx?: { tags?: Array<string> } }
      ).nx?.tags;
      return !tags?.includes('platform:cli') && !tags?.includes('platform:native');
    });
  return shippable
    ? 'clutch.yaml names no `deploy:`, so nothing puts this project in production. Name its command and url.'
    : null;
}

/** Deploys. Returns the exit code. */
export async function runDeploy(root: string, run: Run, log: (line: string) => void) {
  const deploy = deployOf(root);
  if (!deploy) {
    log('::notice title=No deploy::clutch.yaml names no `deploy:`. Nothing deployed.');
    return 0;
  }
  const result = await run(deploy.command);
  if (!result.ok) {
    log(`::error title=Deploy failed::${result.err || result.out}`);
    return 1;
  }
  return 0;
}

const body = (sha: string, url: string, why: string, output: string) => `## Goal

Production at ${url} fails its core journeys after deploying ${sha}.

No automatic revert started: ${why}

## Options

A. Revert the merge. B. Fix forward on a new PR.

## What each option changes for users

A restores the last good build now. B leaves the failure live until the fix ships.

## My pick

A, because users are on a broken build.

${output.slice(-1500)}
`;

/**
 * Whether `pull` is itself a revert: a `revert/<number>` PR of the Revert
 * workflow, or a PR whose title starts with "revert". Its revert would undo the
 * fix, and a second failure would revert again, so a person decides instead.
 */
function isRevert(pull: Pull) {
  return botKind(pull.headRefName) === 'revert' || /^revert\b/iu.test(pull.title ?? '');
}

/**
 * Whether production was proven before the Deploy run `runId`: the last
 * finished Deploy run before it passed. A cancelled or skipped run says
 * nothing, so it is passed over. Deploy runs one at a time, so run ids keep
 * their order.
 */
async function provenBefore(run: Run, repo: string, runId: string) {
  const runs = JSON.parse(
    await must(run, [
      'gh',
      'run',
      'list',
      '--repo',
      repo,
      '--workflow',
      'deploy.yml',
      '--limit',
      '20',
      '--json',
      'databaseId,conclusion,status',
    ]),
  ) as Array<{ databaseId: number; conclusion: string; status: string }>;
  const previous = runs.find(
    (deploy) =>
      deploy.databaseId < Number(runId) &&
      deploy.status === 'completed' &&
      ['success', 'failure'].includes(deploy.conclusion),
  );
  return previous?.conclusion === 'success';
}

/**
 * After production failed its core journeys twice on the deploy of `sha`,
 * starts the same revert as a red CI run: of the PR that auto-merge merged,
 * or of an agent's PR. Returns null when the revert started, or already had.
 * Otherwise it returns why not, and the caller asks the owner: a person merged
 * the PR, the PR is a revert, the commit has no PR, production was not proven
 * before, or the revert could not start. The caller already ran the journeys
 * twice, so one flaky run reverts nothing. See
 * docs/contributing/operations/rollback.md#auto-revert.
 */
async function revertAfterProof(
  run: Run,
  options: {
    sha: string;
    log: (text: string) => void;
    env: Record<string, string | undefined>;
  },
): Promise<string | null> {
  const { sha, log, env } = options;
  const repo = env.GITHUB_REPOSITORY;
  const runId = env.GITHUB_RUN_ID;
  const branch = env.GITHUB_REF_NAME;
  if (!repo || !runId || !branch) {
    return 'this run is not a Deploy run on GitHub Actions.';
  }
  try {
    const { merge, pr } = await mergedPr(run, repo, sha);
    if (!pr) {
      return `${merge.slice(0, 7)} is not the merge of a pull request.`;
    }
    const pull = await pullOf(run, repo, pr);
    if (isRevert(pull)) {
      return `#${pr} is itself a revert, so a second revert would loop.`;
    }
    if (await revertStarted(run, repo, pr)) {
      log(`The revert of #${pr} already started. Drive its revert PR, revert/${pr}, to the merge.`);
      return null;
    }
    if (!(await revertable(run, repo, pr, pull))) {
      return `a person merged #${pr}, so it gets no automatic revert.`;
    }
    if (!(await provenBefore(run, repo, runId))) {
      return `the deploy before ${sha.slice(0, 7)} was not proven, so no single PR broke production.`;
    }
    await startRevert(run, {
      repo,
      pr,
      branch,
      comment: `Production failed its core journeys twice after the deploy of ${sha.slice(0, 7)}, and it was proven before. The Revert workflow opens the revert PR. Run: https://github.com/${repo}/actions/runs/${runId}`,
      started: `Production failed its core journeys after #${pr}. Started its revert.`,
      log,
    });
    return null;
  } catch (error) {
    return `the revert could not start: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Proves production. Returns the exit code. */
export async function prove(
  root: string,
  run: Run,
  sha: string,
  log: (line: string) => void,
  env: Record<string, string | undefined> = process.env,
) {
  const deploy = deployOf(root);
  if (!deploy) {
    log('::notice title=No deploy::clutch.yaml names no `deploy:`. Nothing to prove.');
    return 0;
  }
  const journeys = ['bun', 'tools/journeys/run.ts', '--production', deploy.url];
  const first = await run(journeys);
  if (first.ok) {
    return 0;
  }
  const again = await run(journeys);
  if (again.ok) {
    log('::warning title=Production journey flake::It failed once and passed on the rerun.');
    return 0;
  }
  log(`::error title=Production proof failed::${deploy.url} failed its core journeys twice.`);
  // A revert can be paid back, so the owner is asked only when none can start.
  const why = await revertAfterProof(run, { sha, log, env });
  if (why === null) {
    return 1;
  }
  log(`No automatic revert: ${why}`);
  const file = path.join(tmpdir(), `deploy-${sha}.md`);
  await writeFile(file, body(sha, deploy.url, why, again.err || again.out));
  await ask(run, `Production failed its core journeys after ${sha.slice(0, 7)}`, file);
  return 1;
}

const spawnRun: Run = async (command) => {
  const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { ok: code === 0, out, err };
};

if (import.meta.main) {
  const [action, sha = ''] = process.argv.slice(2);
  const root = process.cwd();
  if (action === 'run') {
    process.exitCode = await runDeploy(root, spawnRun, console.log);
  } else if (action === 'prove') {
    process.exitCode = await prove(root, spawnRun, sha, console.log);
  } else if (action === 'check') {
    const problem = deployProblem(root);
    if (problem) {
      console.error(problem);
      process.exitCode = 1;
    }
  } else {
    console.error('Usage: bun tools/deploy.ts run | prove <sha> | check');
    process.exitCode = 2;
  }
}

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
 *   a failure. A second failure marks the deploy red and opens one question for
 *   the owner that names the commit.
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

const body = (sha: string, url: string, output: string) => `## Goal

Production at ${url} fails its core journeys after deploying ${sha}.

## Options

A. Revert the merge. B. Fix forward on a new PR.

## What each option changes for users

A restores the last good build now. B leaves the failure live until the fix ships.

## My pick

A, because users are on a broken build.

${output.slice(-1500)}
`;

/** Proves production. Returns the exit code. */
export async function prove(root: string, run: Run, sha: string, log: (line: string) => void) {
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
  const file = path.join(tmpdir(), `deploy-${sha}.md`);
  await writeFile(file, body(sha, deploy.url, again.err || again.out));
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

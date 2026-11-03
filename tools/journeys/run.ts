import { appendFileSync } from 'node:fs';
import path from 'node:path';

import { devApps, isUp, urlOf } from '@tools/dev';
import type { DevApp } from '@tools/dev';
import { budgetOf, journeys } from '@tools/journeys/journeys';
import type { Journey } from '@tools/journeys/journeys';
import { webAppOf } from '@tools/journeys/web-app';

/**
 * Runs one journey: `mise exec -- bun run journey <id>`. `--all` runs every
 * web journey in one browser run, as CI and the pre-push hook do. A web journey runs
 * in Playwright against the web app, which `journeys.webApp` in clutch.yaml
 * names, or the one app under apps/ with a web entry. Running servers are used again. When
 * a server is down, the runner starts the missing ones through `tools/dev.ts`,
 * then stops only what it started. A journey that runs past its budget fails.
 * With no web journey, `--all` passes and says so: a warning annotation and a
 * line in the step summary. A native journey runs only through the device host.
 * See docs/contributing/setup/verification.md#journeys.
 */

/** Time for Playwright to start and to stop the browser, on top of the journey budget. */
const overheadMs = 20_000;

/** Where a run writes its lines. The CLI uses the console and the process environment. */
export type Sink = {
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  error: (line: string) => void;
};

const consoleSink: Sink = {
  env: process.env,
  log: (line) => console.log(line),
  error: (line) => console.error(line),
};

/** The end-to-end testing guide: its GitHub page at this commit in a GitHub Actions run, else its path. */
function guideLink(env: Sink['env']) {
  const { GITHUB_REPOSITORY: repository, GITHUB_SHA: sha } = env;
  const base =
    repository && sha
      ? `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repository}/blob/${sha}/`
      : '';
  return `${base}docs/contributing/end-to-end-testing.md`;
}

/** Says that the run tested nothing, so a required check that runs no journey is visible. */
function noJourneyNotice(sink: Sink) {
  const link = guideLink(sink.env);
  sink.log('No web journey exists yet. Nothing ran.');
  sink.log(
    `::warning title=No journey ran::No web journey exists yet, so this check tested nothing. Add one at features/<feature>/journeys/<id>.pw.ts. See ${link}`,
  );
  if (sink.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      sink.env.GITHUB_STEP_SUMMARY,
      `**No journey ran.** The journeys check passed with nothing to run. Add a web journey at \`features/<feature>/journeys/<id>.pw.ts\`. See [end-to-end testing](${link}).\n`,
    );
  }
}

async function allUp(apps: ReadonlyArray<DevApp>, urls: ReadonlyMap<string, string>) {
  const states = await Promise.all(apps.map((app) => isUp(urls.get(app.name) ?? '', app.health)));
  return states.every(Boolean);
}

/** Starts the missing dev servers through the dev command, and waits until each one answers. */
async function startServers(
  root: string,
  apps: ReadonlyArray<DevApp>,
  urls: ReadonlyMap<string, string>,
): Promise<Bun.Subprocess> {
  const dev = Bun.spawn([process.execPath, 'tools/dev.ts'], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const until = Date.now() + 180_000;
  while (Date.now() < until) {
    if (dev.exitCode !== null) {
      throw new Error(`The dev command stopped (exit ${dev.exitCode}). Read its output above.`);
    }
    if (await allUp(apps, urls)) {
      return dev;
    }
    await Bun.sleep(500);
  }
  dev.kill('SIGINT');
  await dev.exited;
  throw new Error('The dev servers did not answer within 180 seconds.');
}

async function stopServers(dev: Bun.Subprocess) {
  dev.kill('SIGINT');
  const stopped = await Promise.race([dev.exited, Bun.sleep(15_000).then(() => null)]);
  if (stopped === null) {
    dev.kill('SIGKILL');
    await dev.exited;
  }
}

async function runPlaywright(
  root: string,
  files: ReadonlyArray<string>,
  baseUrl: string,
  budgetSeconds: number,
) {
  const run = Bun.spawn(
    [
      path.join(root, 'node_modules/.bin/playwright'),
      'test',
      '--config',
      'tools/journeys/playwright.config.ts',
      ...files,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        JOURNEY_BASE_URL: baseUrl,
        JOURNEY_BUDGET_MS: String(budgetSeconds * 1000),
      },
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );
  const late = setTimeout(() => run.kill('SIGKILL'), budgetSeconds * 1000 + overheadMs);
  const code = await run.exited;
  clearTimeout(late);
  if (run.signalCode === 'SIGKILL') {
    console.error(
      `${files.join(', ')} ran past the budget of ${budgetSeconds} s. Make the journey shorter, or raise \`Budget:\` in its header and give the reason.`,
    );
    return 1;
  }
  return code;
}

/** The journeys that `id` selects: one by its ID, or each web journey for `--all`. */
function select(all: ReadonlyArray<Journey>, id: string | undefined): Array<Journey> | string {
  if (id === '--all') {
    return all.filter((item) => item.platform === 'web');
  }
  const journey = all.find((item) => item.id === id);
  if (journey === undefined) {
    const known = all.map((item) => item.id).join(', ') || 'none';
    return `${id ? `No journey has the ID \`${id}\`.` : 'Name a journey.'} Run \`mise exec -- bun run journey <id>\`. Known journeys: ${known}.`;
  }
  if (journey.platform === 'native') {
    return 'Native journeys run through the device host. See docs/contributing/setup/native.md.';
  }
  return [journey];
}

/** Runs the selected journeys. Returns the exit code. Exported for the runner's tests. */
export async function main(
  root: string,
  id: string | undefined,
  sink: Sink = consoleSink,
): Promise<number> {
  const selected = select(journeys(root), id);
  if (typeof selected === 'string') {
    sink.error(selected);
    return 1;
  }
  if (selected.length === 0) {
    noJourneyNotice(sink);
    return 0;
  }
  const web = webAppOf(root);
  if (typeof web === 'string') {
    sink.error(web);
    return 1;
  }
  const apps = devApps(root);
  const urls = new Map(apps.map((app) => [app.name, urlOf(root, app.name)]));
  const started = (await allUp(apps, urls)) ? null : await startServers(root, apps, urls);
  try {
    const budget = selected.reduce((sum, journey) => sum + budgetOf(root, journey), 0);
    return await runPlaywright(
      root,
      selected.map((journey) => journey.file),
      urls.get(web.name) ?? '',
      budget,
    );
  } finally {
    if (started) {
      await stopServers(started);
    }
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.cwd(), process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

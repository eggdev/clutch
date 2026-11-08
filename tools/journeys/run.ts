import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

import { missingJourneys } from '@tools/check-journeys';
import { devApps, isUp, urlOf } from '@tools/dev';
import type { DevApp } from '@tools/dev';
import {
  budgetOf,
  coreJourneys,
  coreWithout,
  fieldOf,
  headerOf,
  inboxCommandOf,
  journeys,
  requiredOutcomes,
  webDevices,
} from '@tools/journeys/journeys';
import type { Journey } from '@tools/journeys/journeys';
import {
  budgetsOf,
  deviceRuns,
  failedRuns,
  frictionFlake,
  reportFlakes,
  webAttempts,
  writeMeasures,
} from '@tools/journeys/measures';
import type { DeviceRun, FileFlake } from '@tools/journeys/measures';
import { nativeMain } from '@tools/journeys/native';
import { webAppOf } from '@tools/journeys/web-app';
import type { Platform } from '@tools/native/device-host';

/**
 * Runs one journey: `mise exec -- bun run journey <id>`. `--all` runs every
 * web journey in one browser run, as CI and the pre-push hook do. A web journey runs
 * in Playwright against the web app, which `journeys.webApp` in clutch.yaml
 * names, or the one app under apps/ with a web entry, on each device in
 * `webDevices`. Running servers are used again. When
 * a server is down, the runner starts the missing ones through `tools/dev.ts`,
 * then stops only what it started. A journey that runs past its budget fails.
 * A failed journey runs once more. A pass on the retry passes, and files a
 * `flake` friction entry. A measured budget that fails on any try (a layout
 * shift, a click budget or axe) fails the run, even when the retry passes.
 * Each journey writes its measures file.
 * With no web journey, `--all` passes and says so: a warning annotation and a
 * line in the step summary. `--native <ios|android>` runs each native journey
 * on the booted device of the device host.
 * See docs/contributing/end-to-end-testing.md#devices.
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

/** The folder that holds the tries that the journey test writes in each run. */
const runsRoot = (root: string) => path.join(root, 'test-results/journeys/runs');

/**
 * Where the journey test writes the measures of each try in this run. Each
 * run has its own folder, so two runs do not mix. A folder older than a day is deleted.
 */
function runsDir(root: string) {
  const parent = runsRoot(root);
  const now = Date.now();
  if (existsSync(parent)) {
    for (const entry of readdirSync(parent)) {
      const folder = path.join(parent, entry);
      // Another run may delete the folder first.
      const changed = statSync(folder, { throwIfNoEntry: false })?.mtimeMs ?? now;
      if (now - changed > 86_400_000) {
        rmSync(folder, { recursive: true, force: true });
      }
    }
  }
  return path.join(parent, `${process.pid}-${now}`);
}

async function runPlaywright(
  root: string,
  files: ReadonlyArray<string>,
  baseUrl: string,
  budgetSeconds: number,
  env: Record<string, string>,
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
        ...env,
        JOURNEY_BASE_URL: baseUrl,
        JOURNEY_BUDGET_MS: String(budgetSeconds * 1000),
      },
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );
  // Each journey may run on each device twice: once, and once more on a failure.
  const tries = webDevices.length * 2;
  const late = setTimeout(() => run.kill('SIGKILL'), budgetSeconds * 1000 * tries + overheadMs);
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

/**
 * The core journeys of a passed run that did not record each outcome that the
 * catalog names, `signed-up` first, on each device. The source checks read the
 * code. This reads what held in the browser, so a call that never ran proves
 * nothing. The last try of each device is the one that passed.
 */
export function unprovenCore(
  root: string,
  ran: ReadonlyArray<Journey>,
  runsOf: (journey: Journey) => ReadonlyArray<DeviceRun>,
): Array<string> {
  return ran.flatMap((journey) => {
    const name = fieldOf(headerOf(readFileSync(path.join(root, journey.file), 'utf-8')), 'Core');
    if (name === undefined || !(coreJourneys as ReadonlyArray<string>).includes(name)) {
      return [];
    }
    const runs = runsOf(journey);
    return webDevices.flatMap((device) => {
      const at = `${journey.file} on ${device.name}`;
      const last = runs.find((run) => run.device === device.name)?.attempts.at(-1);
      const seen = (last?.outcomes ?? []).map((outcome) => outcome.name);
      const missing = requiredOutcomes(
        name as (typeof coreJourneys)[number],
        coreWithout(root, name),
      ).filter((outcome) => !seen.includes(outcome));
      const problems: Array<string> = [];
      if (seen[0] !== 'signed-up') {
        problems.push(
          `${at}: the run did not record \`signed-up\` first, so it did not prove a new account. See docs/contributing/journeys/core.md.`,
        );
      }
      if (missing.length > 0) {
        problems.push(
          `${at}: the run passed, but recorded no ${missing.map((item) => `\`${item}\``).join(', ')}. Each catalog outcome must hold in the run. See docs/contributing/journeys/core.md.`,
        );
      }
      return problems;
    });
  });
}

/**
 * Writes the measures file of each journey that ran, and reports each flake.
 * Returns the runs of each journey, and a line for each device run that
 * failed. Playwright passes a run whose retry passed, so these lines are how a
 * measured budget that failed on the first try still fails the run.
 */
async function collect(
  root: string,
  selected: ReadonlyArray<Journey>,
  dir: string,
  sink: Sink,
  fileFlake: FileFlake,
) {
  const runs = new Map<string, Array<DeviceRun>>();
  const failed: Array<string> = [];
  for (const journey of selected) {
    const list = deviceRuns('web', webAttempts(dir, journey));
    runs.set(journey.id, list);
    const where = writeMeasures(root, journey, list);
    await reportFlakes(journey, list, where, fileFlake, sink.log);
    failed.push(...failedRuns(journey, list, where));
  }
  return { runsOf: (journey: Journey) => runs.get(journey.id) ?? [], failed };
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
    return 'Native journeys run on the device host: `mise exec -- bun run journey --native <ios|android>`. See docs/contributing/end-to-end-testing.md#native-journeys.';
  }
  return [journey];
}

/** Runs the selected journeys. Returns the exit code. Exported for the runner's tests. */
export async function main(
  root: string,
  id: string | undefined,
  sink: Sink = consoleSink,
  fileFlake: FileFlake = frictionFlake(root),
): Promise<number> {
  const selected = select(journeys(root), id);
  if (typeof selected === 'string') {
    sink.error(selected);
    return 1;
  }
  const budgets = budgetsOf(root);
  if (typeof budgets === 'string') {
    sink.error(budgets);
    return 1;
  }
  if (selected.length === 0) {
    // A feature that ships a screen and has no journey is a gate with no proof.
    const missing = missingJourneys(root, journeys(root));
    if (missing.length > 0) {
      sink.error(`No journey ran, and a feature ships a screen:\n${missing.join('\n')}`);
      return 1;
    }
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
    const dir = runsDir(root);
    const code = await runPlaywright(
      root,
      selected.map((journey) => journey.file),
      urls.get(web.name) ?? '',
      budget,
      {
        JOURNEY_MEASURES_DIR: dir,
        JOURNEY_BUDGETS: JSON.stringify(budgets),
        JOURNEY_INBOX: JSON.stringify(inboxCommandOf(root) ?? []),
      },
    );
    const { runsOf, failed } = await collect(root, selected, dir, sink, fileFlake);
    for (const line of failed) {
      sink.error(line);
    }
    if (code !== 0) {
      return code;
    }
    if (failed.length > 0) {
      return 1;
    }
    const unproven = unprovenCore(root, selected, runsOf);
    for (const problem of unproven) {
      sink.error(problem);
    }
    return unproven.length > 0 ? 1 : 0;
  } finally {
    if (started) {
      await stopServers(started);
    }
  }
}

if (import.meta.main) {
  try {
    const [first, platform] = process.argv.slice(2);
    process.exitCode =
      first === '--native'
        ? await nativeMain(process.cwd(), platform as Platform)
        : await main(process.cwd(), first);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

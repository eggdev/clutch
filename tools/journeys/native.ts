import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { budgetsFrom, clickBudgetAt, clickBudgetMessage } from '@repo/journeys/types/budget';
import type { Budgets } from '@repo/journeys/types/budget';
import type { JourneyData } from '@repo/journeys/types/steps';
import { isServerApp, manifestOf, nativeApps } from '@tools/apps';
import { devApps, isUp, urlOf } from '@tools/dev';
import { flowOf } from '@tools/journeys/flow-parts';
import type { Flow } from '@tools/journeys/flow-parts';
import { fieldOf, headerOf, isDataJourney, journeys } from '@tools/journeys/journeys';
import type { Journey } from '@tools/journeys/journeys';
import { toMaestro } from '@tools/journeys/maestro';
import type { FlowOptions, MaestroFlow } from '@tools/journeys/maestro';
import { budgetsOf, deviceRuns, failedRuns, writeMeasures } from '@tools/journeys/measures';
import { runParts } from '@tools/journeys/native-parts';
import { appIdOfApp, expoFingerprint } from '@tools/native/build';
import type { FingerprintTool } from '@tools/native/build';
import { linkDevServers } from '@tools/native/dev-link';
import type { DevServer, LinkOptions } from '@tools/native/dev-link';
import { DeviceHostError, deviceHost, deviceName, installedOn } from '@tools/native/device-host';
import type { DeviceHost, Platform } from '@tools/native/device-host';

/** The outcome of a compiled journey, with the activations before it from the start of the flow. */
type Outcome = { name: string; clicks: number; steps: number };

/** What a native journey runs: its flow file and its parts, its outcomes, and a click budget that the flow goes over. */
type Prepared = {
  file: string;
  flow: Flow;
  outcomes: Array<Outcome>;
  failure?: { kind: string; message: string };
};

/** The app ID of the one native app, from `expo.ios.bundleIdentifier` or `expo.android.package` in its app.json. */
function appIdOf(root: string, platform: Platform): string {
  const apps = nativeApps(root);
  if (apps.length !== 1) {
    throw new Error(
      `The native journeys need one native app, and the repository has ${apps.length}. Keep one app under apps/ with a native dependency.`,
    );
  }
  const id = appIdOfApp(root, apps[0] ?? '', platform);
  if (!id) {
    const key = platform === 'ios' ? 'ios.bundleIdentifier' : 'android.package';
    throw new Error(
      `apps/${apps[0] ?? ''}/app.json names no app ID, so the native journeys cannot run. Set expo.${key}.`,
    );
  }
  return id;
}

/** The URL scheme of the one native app, from `expo.scheme` in its app.json, or none. */
function schemeOf(root: string): string | undefined {
  const [app] = nativeApps(root);
  const config = path.join(root, 'apps', app ?? '', 'app.json');
  if (!app || !existsSync(config)) {
    return undefined;
  }
  const scheme: unknown = JSON.parse(readFileSync(config, 'utf-8')).expo?.scheme;
  return typeof scheme === 'string' ? scheme : undefined;
}

/**
 * The reason that the opened device cannot run the journeys, or none. A run
 * drives the build that is on the device, so the device must have the build of
 * the sources: the fingerprint that `native:build --install` recorded for the
 * device must be the native fingerprint of the app now. A journey that passes
 * on an older build proves nothing about the sources. A JavaScript-only change
 * keeps the fingerprint, and a debug build loads that JavaScript from the dev
 * server.
 */
async function deviceBuildProblem(
  root: string,
  platform: Platform,
  host: DeviceHost,
  tool: (appRoot: string) => Promise<FingerprintTool>,
): Promise<string | null> {
  const apps = nativeApps(root);
  if (apps.length !== 1) {
    return `The native journeys need one native app, and the repository has ${apps.length}. Keep one app under apps/ with a native dependency.`;
  }
  const install = `\`AGENT_DEVICE=${host.id()} mise exec -- bun run native:build --platform ${platform} --install\``;
  const installed = installedOn(root, host);
  if (installed === null) {
    return `This checkout installed no build on the opened device. Install it: ${install}.`;
  }
  const appRoot = path.join(root, 'apps', apps[0] ?? '');
  const fingerprint = await tool(appRoot);
  const { hash } = await fingerprint.create(appRoot, platform);
  return hash === installed.fingerprint
    ? null
    : `The opened device has the build of fingerprint ${installed.fingerprint.slice(0, 8)}, and the sources have ${hash.slice(0, 8)}. Install the build of the sources: ${install}.`;
}

/**
 * The settings of one run. `devOrganization` gives the run an organization
 * of its own, as a web run has, so it starts with no record. A `tool` step
 * calls the API as that organization, from the machine that drives the
 * device. `RCT_jsLocation` tells a debug build of React Native where its dev
 * server is: the app runs at its portless name, not at the port that React
 * Native expects. A release build holds its own bundle and does not read it.
 */
function runSettings(root: string): Pick<FlowOptions, 'arguments' | 'tools'> {
  const [app] = nativeApps(root);
  // The dev servers take their names from the root manifest. A repository with none has no dev server.
  const servers = existsSync(path.join(root, 'package.json')) ? devApps(root) : [];
  const client = servers.find((item) => item.folder === `apps/${app ?? ''}`);
  const api = servers.find((item) => isServerApp(manifestOf(root, path.basename(item.folder))));
  const organization = `journey-${Date.now().toString(36)}`;
  return {
    arguments: {
      devOrganization: organization,
      ...(client ? { RCT_jsLocation: new URL(urlOf(root, client.name)).host } : {}),
    },
    ...(api
      ? {
          tools: {
            url: new URL('/mcp', urlOf(root, api.name)).href,
            headers: { 'x-dev-organization-id': organization },
          },
        }
      : {}),
  };
}

/** Whether a loaded export is the data of a journey: a title and a list of steps. */
function isJourneyData(value: unknown): value is JourneyData {
  return (
    typeof value === 'object' && value !== null && 'steps' in value && Array.isArray(value.steps)
  );
}

/** Imports a journey in data form with `JOURNEY_COMPILE=1`, so it registers no test, and compiles it. */
async function compileJourney(
  root: string,
  journey: Journey,
  appId: string,
  options: FlowOptions,
): Promise<MaestroFlow> {
  const previous = process.env.JOURNEY_COMPILE;
  process.env.JOURNEY_COMPILE = '1';
  try {
    const loaded = (await import(path.join(root, journey.file))) as Record<string, unknown>;
    const found = Object.values(loaded).filter(isJourneyData);
    const [only] = found;
    if (found.length !== 1 || only === undefined) {
      throw new Error(
        `${journey.file} must export one journey(...) call by name, and it exports ${found.length}.`,
      );
    }
    return toMaestro(only, appId, options);
  } finally {
    if (previous === undefined) {
      delete process.env.JOURNEY_COMPILE;
    } else {
      process.env.JOURNEY_COMPILE = previous;
    }
  }
}

/** The first click budget that the outcomes go over, as the web run checks it, or none. */
function clickFailure(
  core: string | null,
  budgets: Budgets,
  outcomes: ReadonlyArray<Outcome>,
): Prepared['failure'] {
  const start = outcomes.find((item) => item.name === 'signed-up')?.steps ?? 0;
  for (const outcome of outcomes) {
    const check = clickBudgetAt(core, budgets, outcome.name, outcome.steps, start);
    if (check?.over && core) {
      return { kind: 'click-budget', message: clickBudgetMessage(core, check) };
    }
  }
  return undefined;
}

/**
 * The prepared journey with the parts of its flow, or null. A flow that the
 * runner cannot cut is logged before the device gets any step.
 */
function withParts(
  prepared: Omit<Prepared, 'flow'>,
  journey: Journey,
  log: (line: string) => void,
): Prepared | null {
  try {
    return { ...prepared, flow: flowOf(readFileSync(prepared.file, 'utf-8')) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`::error title=Flow cannot run in parts::${journey.file}: ${reason}`);
    return null;
  }
}

/**
 * What the native run of a journey needs before a device runs it. A journey in
 * data form compiles to a flow file and checks its click budgets; a Maestro
 * file runs as it is. A journey that does not compile is logged, and returns null.
 */
async function prepare(
  root: string,
  journey: Journey,
  platform: Platform,
  log: (line: string) => void,
): Promise<Prepared | null> {
  if (!isDataJourney(journey)) {
    return withParts({ file: path.join(root, journey.file), outcomes: [] }, journey, log);
  }
  try {
    const budgets = budgetsOf(root);
    if (typeof budgets === 'string') {
      throw new TypeError(budgets);
    }
    const flow = await compileJourney(root, journey, appIdOf(root, platform), {
      platform,
      ...runSettings(root),
      scheme: schemeOf(root),
    });
    let steps = 0;
    const outcomes = flow.outcomes.map((item) => {
      steps += item.clicks;
      return { name: item.name, clicks: item.clicks, steps };
    });
    const core = fieldOf(headerOf(readFileSync(path.join(root, journey.file), 'utf-8')), 'Core');
    const dir = path.join(root, 'test-results/journeys/native');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${journey.id}.maestro.yaml`);
    writeFileSync(file, flow.flow);
    for (const line of flow.left) {
      log(`${journey.file}: ${line}`);
    }
    const failure = clickFailure(core ?? null, budgetsFrom(budgets), outcomes);
    return withParts({ file, outcomes, ...(failure ? { failure } : {}) }, journey, log);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`::error title=Journey did not compile::${journey.file}: ${reason}`);
    return null;
  }
}

/**
 * Compiles each journey before a device runs it. A journey that does not
 * compile is logged and left out, and the run fails for it.
 */
async function readFlows(
  root: string,
  flows: ReadonlyArray<Journey>,
  platform: Platform,
  log: (line: string) => void,
): Promise<Array<{ journey: Journey; prepared: Prepared }>> {
  const ready: Array<{ journey: Journey; prepared: Prepared }> = [];
  for (const journey of flows) {
    const prepared = await prepare(root, journey, platform, log);
    if (prepared !== null) {
      ready.push({ journey, prepared });
    }
  }
  return ready;
}

/** Each dev server of this machine, with whether it answers its health path. */
function localServers(root: string): Promise<ReadonlyArray<DevServer & { up: boolean }>> {
  return Promise.all(
    devApps(root).map(async (app) => {
      const url = urlOf(root, app.name);
      return { url, health: app.health, up: await isUp(url, app.health) };
    }),
  );
}

/**
 * Runs each native journey on the device that the caller opened, through the
 * device host: `AGENT_DEVICE=<path> mise exec -- bun run journey --native
 * <ios|android>`. The device must have the build of the sources, and the dev
 * servers must run here and answer on the build machine. Each journey runs in
 * parts, once, with no retry, so a failed run fails. Its evidence goes to
 * `test-results/journeys/native/<id>/`, and its measures to
 * `<id>.<platform>.json`. See docs/contributing/end-to-end-testing.md#native-journeys.
 */

export type NativeOptions = {
  host?: DeviceHost;
  /** The fingerprint tool of a native app. A test gives a fake. */
  tool?: (appRoot: string) => Promise<FingerprintTool>;
  log?: (line: string) => void;
  /** The dev servers of this machine and whether each answers. A test gives a fake. */
  servers?: () => Promise<ReadonlyArray<DevServer & { up: boolean }>>;
  /** The link of the dev servers to the build machine. A test gives a fake. */
  link?: (servers: ReadonlyArray<DevServer>, options: LinkOptions) => Promise<void>;
};

/** Checks the device build and the dev servers before the first flow. Returns the refusal, or null. */
async function readyToRun(
  root: string,
  platform: Platform,
  host: DeviceHost,
  options: NativeOptions,
  log: (line: string) => void,
): Promise<string | null> {
  const problem = await deviceBuildProblem(root, platform, host, options.tool ?? expoFingerprint);
  if (problem !== null) {
    return `::error title=No build of the sources on the device::${problem}`;
  }
  const servers = await (options.servers ?? (() => localServers(root)))();
  if (servers.some((server) => !server.up)) {
    return 'The dev servers are down. Start them with `mise exec -- bun run dev`.';
  }
  await (options.link ?? linkDevServers)(
    servers.map(({ url, health }) => ({ url, health })),
    { log },
  );
  return null;
}

export async function nativeMain(
  root: string,
  platform: Platform | undefined,
  options: NativeOptions = {},
): Promise<number> {
  const log = options.log ?? console.log;
  if (platform !== 'ios' && platform !== 'android') {
    log('Name the platform: `mise exec -- bun run journey --native <ios|android>`.');
    return 1;
  }
  const flows = journeys(root).filter((journey) => journey.platform === 'native');
  // A native app with no native journey has no proof on a device.
  if (flows.length === 0) {
    log(
      `::error title=No journey ran::No native journey exists, so the ${platform} run proves nothing. Add one at features/<feature>/journeys/<id>.maestro.yaml. See docs/contributing/end-to-end-testing.md#native-journeys.`,
    );
    return 1;
  }
  const host = options.host ?? deviceHost();
  try {
    const refusal = await readyToRun(root, platform, host, options, log);
    if (refusal !== null) {
      log(refusal);
      return 1;
    }
    const ready = await readFlows(root, flows, platform, log);
    const device = deviceName(host);
    let failed = flows.length - ready.length;
    for (const { journey, prepared } of ready) {
      const start = Date.now();
      const folder = path.join(root, 'test-results/journeys/native', journey.id);
      const passed = runParts(host, prepared.flow, folder, log);
      log(`The evidence of ${journey.id} is in ${path.relative(root, folder)}/.`);
      // The flow is linear, so a click budget that its outcomes go over fails a run that passes the flow.
      const failure = passed ? prepared.failure : undefined;
      const runs = deviceRuns(platform, [
        {
          device,
          retry: 0,
          status: passed && failure === undefined ? 'passed' : 'failed',
          durationMs: Date.now() - start,
          outcomes: prepared.outcomes.map(({ name, clicks }) => ({ name, clicks })),
          failure: failure ?? null,
        },
      ]);
      const where = writeMeasures(root, journey, runs);
      const lines = failedRuns(journey, runs, where);
      for (const line of lines) {
        log(line);
      }
      failed += lines.length > 0 ? 1 : 0;
    }
    return failed > 0 ? 1 : 0;
  } catch (error) {
    if (!(error instanceof DeviceHostError)) {
      throw error;
    }
    log(error.message);
    return 1;
  }
}

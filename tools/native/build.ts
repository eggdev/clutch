import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { DeviceHostError, deviceHost, lockFile, withLock } from '@tools/native/device-host';
import type { DeviceHost, Platform } from '@tools/native/device-host';

/**
 * `mise exec -- bun run native:build` builds a native app only when its native
 * fingerprint changed. The fingerprint is a hash of each input that goes into
 * the native binary: native folders, config plugins and native dependencies.
 * A JavaScript-only change keeps it, so it needs no native build. Each app
 * commits its last built fingerprint in `native-fingerprint.json`.
 * See docs/contributing/setup/native.md#native-builds.
 */
export const recordName = 'native-fingerprint.json';

export type Fingerprint = {
  readonly hash: string;
  readonly sources: ReadonlyArray<{ readonly id?: string; readonly filePath?: string }>;
};

/** The call of `@expo/fingerprint` that `native:build` uses. */
export type FingerprintTool = {
  readonly create: (appRoot: string, platform: Platform) => Promise<Fingerprint>;
};

type Recorded = Partial<Record<Platform, Fingerprint>>;

const platforms: ReadonlyArray<Platform> = ['ios', 'android'];

/** An app under `apps/` is native when it depends on `expo` or `react-native`. */
export function nativeApps(root: string): Array<string> {
  const apps = path.join(root, 'apps');
  if (!existsSync(apps)) {
    return [];
  }
  return readdirSync(apps)
    .filter((name) => {
      const manifest = path.join(apps, name, 'package.json');
      if (!existsSync(manifest)) {
        return false;
      }
      const { dependencies = {}, devDependencies = {} } = JSON.parse(
        readFileSync(manifest, 'utf-8'),
      );
      return ['expo', 'react-native'].some(
        (dependency) => dependency in { ...dependencies, ...devDependencies },
      );
    })
    .toSorted();
}

/**
 * Loads `@expo/fingerprint` from the native app. The template has no native
 * app, so the package is not a root dependency. Kickoff adds it to the app.
 */
export async function expoFingerprint(appRoot: string): Promise<FingerprintTool> {
  let entry: string;
  try {
    entry = Bun.resolveSync('@expo/fingerprint', appRoot);
  } catch {
    throw new DeviceHostError(
      `${appRoot} cannot load @expo/fingerprint. Add it to the app's devDependencies at an exact version. See docs/contributing/setup/native.md#native-builds.`,
    );
  }
  const fingerprint = await import(entry);
  return {
    create: (root, platform) => fingerprint.createFingerprintAsync(root, { platforms: [platform] }),
  };
}

/** The ids of the sources that differ between two fingerprints. */
function changedSources(before: Fingerprint, after: Fingerprint): Array<string> {
  const key = (source: Fingerprint['sources'][number]) =>
    source.id ?? source.filePath ?? JSON.stringify(source);
  const all = (fingerprint: Fingerprint) =>
    new Set(fingerprint.sources.map((source) => JSON.stringify(source)));
  const old = all(before);
  const now = all(after);
  return [
    ...new Set([
      ...before.sources.filter((source) => !now.has(JSON.stringify(source))).map(key),
      ...after.sources.filter((source) => !old.has(JSON.stringify(source))).map(key),
    ]),
  ].toSorted();
}

export type BuildOptions = {
  readonly root: string;
  readonly args: Array<string>;
  readonly host?: DeviceHost;
  readonly tool?: (appRoot: string) => Promise<FingerprintTool>;
  readonly lock?: string;
  readonly log?: (line: string) => void;
};

const usage = 'Usage: mise exec -- bun run native:build [app] --platform <ios|android> [--record]';

type Target = { app: string; platforms: Array<Platform>; record: boolean };

/** The app and platforms that the arguments name, or a refusal to log. */
function targetOf(root: string, args: Array<string>): Target | string {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { platform: { type: 'string' }, record: { type: 'boolean', default: false } },
  });
  const apps = nativeApps(root);
  const app = positionals[0] ?? (apps.length === 1 ? apps[0] : undefined);
  if (!app || !apps.includes(app)) {
    return `Name one native app: ${apps.join(', ')}. ${usage}`;
  }
  const chosen = platforms.filter((platform) => !values.platform || values.platform === platform);
  if (chosen.length === 0 || (!values.record && chosen.length !== 1)) {
    return `Pass --platform ios or --platform android. ${usage}`;
  }
  return { app, platforms: chosen, record: values.record };
}

type Run = {
  readonly target: Target;
  readonly appRoot: string;
  readonly relative: string;
  readonly recorded: Recorded;
  readonly tool: FingerprintTool;
  readonly save: (next: Recorded) => void;
  readonly log: (line: string) => void;
};

async function record(run: Run): Promise<number> {
  const next = { ...run.recorded };
  for (const platform of run.target.platforms) {
    next[platform] = await run.tool.create(run.appRoot, platform);
  }
  run.save(next);
  run.log(
    `Recorded the ${run.target.platforms.join(' and ')} fingerprint in ${run.relative}. Commit it.`,
  );
  return 0;
}

async function buildChanged(run: Run, host: () => DeviceHost, lock: string): Promise<number> {
  const { log, relative } = run;
  const [platform] = run.target.platforms;
  const before = run.recorded[platform];
  if (!before) {
    log(
      `${relative} has no ${platform} fingerprint. Kickoff records the first one: \`mise exec -- bun run native:build ${run.target.app} --record\`.`,
    );
    return 1;
  }
  const after = await run.tool.create(run.appRoot, platform);
  if (after.hash === before.hash) {
    log(
      `JS-only change: the ${platform} native fingerprint matches ${relative}. Ship it with an update, not a native build. A dev build on the booted device loads the new JavaScript from the dev server.`,
    );
    return 1;
  }
  log(`The ${platform} native fingerprint changed. Changed sources:`);
  for (const source of changedSources(before, after).slice(0, 20)) {
    log(`  ${source}`);
  }
  const builder = host();
  const result = await withLock(lock, () => builder.build(run.appRoot, platform));
  log(result.output);
  if (result.exitCode !== 0) {
    log(`The ${platform} build failed, so ${relative} keeps the last built fingerprint.`);
    return result.exitCode;
  }
  run.save({ ...run.recorded, [platform]: after });
  log(`Built. Commit ${relative} with the native change that caused the build.`);
  return 0;
}

/**
 * Runs `native:build` and returns the exit code. A repository with no native
 * app exits 0: there is nothing to build, so a CI step that calls it passes.
 */
export async function nativeBuild(options: BuildOptions): Promise<number> {
  const log = options.log ?? console.log;
  if (nativeApps(options.root).length === 0) {
    log('No native app in this repository. Nothing to build.');
    return 0;
  }
  const target = targetOf(options.root, options.args);
  if (typeof target === 'string') {
    log(target);
    return 1;
  }
  const appRoot = path.join(options.root, 'apps', target.app);
  const recordFile = path.join(appRoot, recordName);
  try {
    const run: Run = {
      target,
      appRoot,
      relative: path.relative(options.root, recordFile),
      recorded: existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, 'utf-8')) : {},
      tool: await (options.tool ?? expoFingerprint)(appRoot),
      save: (next) => writeFileSync(recordFile, `${JSON.stringify(next, null, 2)}\n`),
      log,
    };
    return target.record
      ? await record(run)
      : await buildChanged(run, () => options.host ?? deviceHost(), options.lock ?? lockFile());
  } catch (error) {
    if (!(error instanceof DeviceHostError)) {
      throw error;
    }
    log(error.message);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await nativeBuild({ root: process.cwd(), args: process.argv.slice(2) });
}

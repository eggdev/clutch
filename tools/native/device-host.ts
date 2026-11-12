import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { maestroCommand } from '@tools/native/maestro';
import type { JavaLookup } from '@tools/native/maestro';

/**
 * The device host is the one place that drives a simulator, an emulator or a
 * native build. `DEVICE_HOST` names the host. Without it the host is `none`,
 * which refuses each call.
 * See docs/contributing/setup/native.md#device-host.
 *
 * The interface holds the device rules:
 *
 * - A host reuses a booted device. It has no call that creates, clones, boots
 *   or erases one.
 * - One machine-wide lock lets one session at a time drive a device or build.
 */
export type Platform = 'ios' | 'android';

export type Device = { readonly platform: Platform; readonly id: string; readonly name: string };

type Result = { readonly exitCode: number; readonly output: string };

export type DeviceHost = {
  readonly name: string;
  /** The booted device of the platform, or null. A host never boots one. */
  readonly bootedDevice: (platform: Platform) => Promise<Device | null>;
  /** Installs a built app on a booted device. */
  readonly install: (device: Device, app: string) => Promise<void>;
  /** Has Maestro read a flow, with no device. A flow that Maestro cannot read fails here. */
  readonly checkFlow: (flow: string) => Promise<Result>;
  /** Runs a Maestro flow on a booted device. */
  readonly runFlow: (device: Device, flow: string) => Promise<Result>;
  /** Builds the native app in `appRoot` for the platform. */
  readonly build: (appRoot: string, platform: Platform) => Promise<Result>;
};

/** A refusal from the device host. Its message names the fix. */
export class DeviceHostError extends Error {
  override name = 'DeviceHostError';
}

const setup =
  'No device host is set up, so `DEVICE_HOST` is `none`. The owner sets one up at kickoff. See docs/contributing/setup/native.md#device-host.';

const none: DeviceHost = {
  name: 'none',
  bootedDevice: () => Promise.reject(new DeviceHostError(setup)),
  install: () => Promise.reject(new DeviceHostError(setup)),
  checkFlow: () => Promise.reject(new DeviceHostError(setup)),
  runFlow: () => Promise.reject(new DeviceHostError(setup)),
  build: () => Promise.reject(new DeviceHostError(setup)),
};

/**
 * The `ci` device host: the one simulator or emulator that a CI job booted on
 * its own runner. The job boots the device, builds the app and installs it in
 * its own steps, so this host finds the device and runs Maestro on it. It
 * never boots a device, and it builds nothing. See
 * docs/contributing/end-to-end-testing.md#native-journeys.
 */

export type Run = (command: Array<string>) => Promise<{ exitCode: number; output: string }>;

const spawnRun: Run = async (command) => {
  const [tool = ''] = command;
  if (Bun.which(tool) === null) {
    throw new DeviceHostError(
      `\`${tool}\` is not installed, so the ci device host cannot reach a device. It runs on a CI runner with a booted device. See docs/contributing/end-to-end-testing.md#native-journeys.`,
    );
  }
  const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, output: `${out}${err}` };
};

async function must(run: Run, command: Array<string>) {
  const result = await run(command);
  if (result.exitCode !== 0) {
    throw new DeviceHostError(`${command.join(' ')} failed: ${result.output}`);
  }
  return result.output;
}

type Simulators = {
  devices: Record<string, Array<{ udid: string; name: string; state: string }>>;
};

async function bootedSimulator(run: Run): Promise<Device | null> {
  const list = JSON.parse(
    await must(run, ['xcrun', 'simctl', 'list', 'devices', 'booted', '--json']),
  ) as Simulators;
  const booted = Object.values(list.devices)
    .flat()
    .find((item) => item.state === 'Booted');
  return booted ? { platform: 'ios', id: booted.udid, name: booted.name } : null;
}

async function bootedEmulator(run: Run): Promise<Device | null> {
  const listed = await must(run, ['adb', 'devices']);
  const id = listed
    .split('\n')
    .map((line) => line.trim().split(/\s+/u))
    .find(([serial, state]) => serial?.startsWith('emulator-') && state === 'device')?.[0];
  if (!id) {
    return null;
  }
  const avd = await run(['adb', '-s', id, 'emu', 'avd', 'name']);
  const name = avd.exitCode === 0 ? avd.output.split('\n')[0]?.trim() : '';
  return { platform: 'android', id, name: name || id };
}

/** Runs Maestro, or answers the sentence that says why it cannot run here. */
async function maestro(run: Run, args: ReadonlyArray<string>, java?: JavaLookup): Promise<Result> {
  const command = await maestroCommand(args, java);
  return typeof command === 'string' ? { exitCode: 1, output: command } : run(command);
}

export function ciHost(run: Run = spawnRun, java?: JavaLookup): DeviceHost {
  return {
    name: 'ci',
    bootedDevice: (platform: Platform) =>
      platform === 'ios' ? bootedSimulator(run) : bootedEmulator(run),
    install: async (device, app) => {
      await must(
        run,
        device.platform === 'ios'
          ? ['xcrun', 'simctl', 'install', device.id, app]
          : ['adb', '-s', device.id, 'install', '-r', app],
      );
    },
    checkFlow: (flow) => maestro(run, ['check-syntax', flow], java),
    runFlow: (device, flow) => maestro(run, ['--device', device.id, 'test', flow], java),
    build: () =>
      Promise.reject(
        new DeviceHostError(
          'The ci device host builds nothing. The CI job builds the app in its own step. See docs/contributing/end-to-end-testing.md#native-journeys.',
        ),
      ),
  };
}

/**
 * Where a debug build of the app lands, or null when no build exists. The
 * `local` host builds there, and `native:build --install` reads it.
 */
export function builtApp(appRoot: string, platform: Platform): string | null {
  if (platform === 'android') {
    const apk = path.join(appRoot, 'android/app/build/outputs/apk/debug/app-debug.apk');
    return existsSync(apk) ? apk : null;
  }
  const products = path.join(appRoot, 'ios/build/Build/Products/Debug-iphonesimulator');
  const app = existsSync(products)
    ? readdirSync(products).find((name) => name.endsWith('.app'))
    : undefined;
  return app ? path.join(products, app) : null;
}

/**
 * The commands of a debug build, in order. Each is a function, because the
 * second reads what the first wrote: the prebuild of the app writes the native
 * project, and the build compiles it. The iOS build is for any simulator, so
 * it boots none. A step gives null when the project it needs is missing.
 */
function buildSteps(appRoot: string, platform: Platform): Array<() => Array<string> | null> {
  const prebuild = () => [
    'bun',
    'run',
    '--cwd',
    appRoot,
    'prebuild:native',
    '--platform',
    platform,
  ];
  if (platform === 'android') {
    const project = path.join(appRoot, 'android');
    return [
      prebuild,
      () =>
        existsSync(project)
          ? [path.join(project, 'gradlew'), '-p', project, ':app:assembleDebug']
          : null,
    ];
  }
  return [
    prebuild,
    () => {
      const folder = path.join(appRoot, 'ios');
      const workspace = existsSync(folder)
        ? readdirSync(folder).find((name) => name.endsWith('.xcworkspace'))
        : undefined;
      return workspace
        ? [
            'xcodebuild',
            '-workspace',
            path.join(folder, workspace),
            '-scheme',
            workspace.replace(/\.xcworkspace$/u, ''),
            '-configuration',
            'Debug',
            '-sdk',
            'iphonesimulator',
            '-destination',
            'generic/platform=iOS Simulator',
            '-derivedDataPath',
            path.join(folder, 'build'),
            '-quiet',
            'build',
          ]
        : null;
    },
  ];
}

/**
 * The `local` device host: the booted simulator or emulator of the machine
 * that runs the command. It finds the device and runs Maestro on it as the
 * `ci` host does. It also builds: the `prebuild:native` script of the app
 * writes the native project, and the build tool of the platform compiles a
 * debug build of it. The build needs no device, and the host never boots one.
 * When the owner has booted a device, the build is installed on it.
 */
export function localHost(run: Run = spawnRun): DeviceHost {
  const base = ciHost(run);
  return {
    ...base,
    name: 'local',
    async build(appRoot, platform) {
      let output = '';
      for (const step of buildSteps(appRoot, platform)) {
        const command = step();
        if (command === null) {
          return {
            exitCode: 1,
            output: `${output}The prebuild of ${appRoot} wrote no ${platform} project, so there is nothing to build.\n`,
          };
        }
        const result = await run(command);
        output += result.output;
        if (result.exitCode !== 0) {
          return { exitCode: result.exitCode, output };
        }
      }
      // The build needs no device. A device that the owner booted gets the build.
      const device = await base.bootedDevice(platform);
      const app = builtApp(appRoot, platform);
      if (device && app) {
        await base.install(device, app);
        return { exitCode: 0, output: `${output}Installed the build on ${device.name}.\n` };
      }
      return {
        exitCode: 0,
        output: `${output}No ${platform} device is booted, so the build is not installed. After the owner boots one, run \`mise exec -- bun run native:build --platform ${platform} --install\`.\n`,
      };
    },
  };
}

/**
 * Each host by its `DEVICE_HOST` name. `ci` drives the device that a CI job
 * booted on its own runner, and `local` drives the booted device of this
 * machine. Kickoff adds a host for any other machine here.
 */
const hosts: Record<string, () => DeviceHost> = {
  none: () => none,
  ci: () => ciHost(),
  local: () => localHost(),
};

/** The host that `DEVICE_HOST` names. It is `none` when the variable is not set. */
export function deviceHost(env: NodeJS.ProcessEnv = process.env): DeviceHost {
  const name = env.DEVICE_HOST || 'none';
  const make = hosts[name];
  if (!make) {
    throw new DeviceHostError(
      `DEVICE_HOST is \`${name}\`, but no host has that name. Use one of: ${Object.keys(hosts).join(', ')}. See docs/contributing/setup/native.md#device-host.`,
    );
  }
  return make();
}

/**
 * The machine-wide lock file. Each clone, worktree and project on a machine
 * shares its simulators, so the lock lives in the home folder, not in the
 * repository. `DEVICE_LOCK` moves it, for tests.
 */
export const lockFile = (env: NodeJS.ProcessEnv = process.env) =>
  env.DEVICE_LOCK || path.join(homedir(), '.cache', 'agent-devices', 'device.lock');

type Holder = { pid: number; cwd: string; since: string };

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function readHolder(file: string): Holder | null {
  try {
    const holder: Holder = JSON.parse(readFileSync(file, 'utf-8'));
    return Number.isInteger(holder.pid) ? holder : null;
  } catch {
    return null;
  }
}

/**
 * Runs `work` while this process holds the lock. When a live process holds
 * it, refuses at once and names that process. A lock from a process that has
 * ended is taken over.
 */
export async function withLock<T>(file: string, work: () => Promise<T>): Promise<T> {
  mkdirSync(path.dirname(file), { recursive: true });
  const mine: Holder = { pid: process.pid, cwd: process.cwd(), since: new Date().toISOString() };
  for (;;) {
    try {
      writeFileSync(file, JSON.stringify(mine), { flag: 'wx' });
      break;
    } catch {
      const holder = readHolder(file);
      if (holder && isAlive(holder.pid)) {
        throw new DeviceHostError(
          `Another session drives a device: PID ${holder.pid} in ${holder.cwd}, since ${holder.since}. Wait for it to finish, then run the command again. Do not delete ${file}.`,
        );
      }
      unlinkSync(file);
    }
  }
  try {
    return await work();
  } finally {
    if (readHolder(file)?.pid === process.pid && existsSync(file)) {
      unlinkSync(file);
    }
  }
}

/** Runs `work` on the booted device of the platform, while this process holds the lock. */
export function withDevice<T>(
  host: DeviceHost,
  platform: Platform,
  work: (device: Device) => Promise<T>,
  file = lockFile(),
): Promise<T> {
  return withLock(file, async () => {
    const device = await host.bootedDevice(platform);
    if (!device) {
      throw new DeviceHostError(
        `No ${platform} device is booted on the \`${host.name}\` device host. Ask the owner to boot one. An agent never creates, clones, boots or erases a device.`,
      );
    }
    return work(device);
  });
}

/** `flow <ios|android> <file>` runs a Maestro flow on the booted device. */
async function main(args: Array<string>): Promise<number> {
  const [command, platform, flow] = args;
  if (command !== 'flow' || (platform !== 'ios' && platform !== 'android') || !flow) {
    console.error('Usage: bun tools/native/device-host.ts flow <ios|android> <flow.maestro.yaml>');
    return 1;
  }
  const host = deviceHost();
  const result = await withDevice(host, platform, (device) => host.runFlow(device, flow));
  console.log(result.output);
  return result.exitCode;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof DeviceHostError)) {
      throw error;
    }
    console.error(error.message);
    process.exitCode = 1;
  }
}

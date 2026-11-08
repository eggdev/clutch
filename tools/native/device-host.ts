import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * The device host is the one place that drives a simulator, an emulator or a
 * native build. Each project sets up its own host at kickoff. The template
 * ships only `none`, which refuses each call. `DEVICE_HOST` names the host.
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

export function ciHost(run: Run = spawnRun): DeviceHost {
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
    runFlow: (device, flow) => run(['maestro', '--device', device.id, 'test', flow]),
    build: () =>
      Promise.reject(
        new DeviceHostError(
          'The ci device host builds nothing. The CI job builds the app in its own step. See docs/contributing/end-to-end-testing.md#native-journeys.',
        ),
      ),
  };
}

/**
 * Each host by its `DEVICE_HOST` name. `ci` drives the device that a CI job
 * booted on its own runner. Kickoff adds the project's host here.
 */
const hosts: Record<string, () => DeviceHost> = { none: () => none, ci: () => ciHost() };

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

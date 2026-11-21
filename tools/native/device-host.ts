import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The device host is the one place that drives a simulator or an emulator.
 * The template has one host, `pool`. It drives the device that the caller
 * opened from the shared device pool, through the `agent-device` command that
 * `AGENT_DEVICE` names. A script never opens or closes a device.
 * See docs/contributing/setup/native.md#the-device-pool.
 */
export type Platform = 'ios' | 'android';

export type Result = { readonly exitCode: number; readonly output: string };

export type DeviceHost = {
  readonly name: string;
  /** One call of the `agent-device` command that is bound to the device the caller opened. */
  readonly device: (args: ReadonlyArray<string>) => Result;
  /** What names the opened device: the path of its bound command. */
  readonly id: () => string;
};

/** A refusal from the device host. Its message names the fix. */
export class DeviceHostError extends Error {
  override name = 'DeviceHostError';
}

const howTo =
  "Open a device of the shared pool with T3 Code's device tools (`device_list`, then `device_open`), and pass the `agent-device` path that `device_open` returns: `AGENT_DEVICE=<path> mise exec -- bun run <command>`. See docs/contributing/setup/native.md#the-device-pool.";

/** The bound command that `AGENT_DEVICE` names, or a refusal that says how to get one. */
export function agentDeviceOf(
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = existsSync,
): string {
  const command = env.AGENT_DEVICE?.trim();
  if (!command) {
    throw new DeviceHostError(`\`AGENT_DEVICE\` is not set, so no device is named. ${howTo}`);
  }
  if (!exists(command)) {
    throw new DeviceHostError(
      `\`AGENT_DEVICE\` names ${command}, which does not exist. The command goes away when its device closes. ${howTo}`,
    );
  }
  return command;
}

/** The `pool` host. `run` is the spawn, a test gives a fake. */
export function poolHost(
  options: {
    env?: NodeJS.ProcessEnv;
    exists?: (file: string) => boolean;
    run?: (command: string, args: ReadonlyArray<string>) => Result;
  } = {},
): DeviceHost {
  const run =
    options.run ??
    ((command, args) => {
      const child = Bun.spawnSync([command, ...args], { cwd: process.cwd(), stderr: 'pipe' });
      return { exitCode: child.exitCode, output: `${child.stdout}${child.stderr}` };
    });
  return {
    name: 'pool',
    // The variable is read on each call, so the refusal comes at the first device call.
    device: (args) => run(agentDeviceOf(options.env, options.exists), args),
    id: () => agentDeviceOf(options.env, options.exists),
  };
}

/** The device host of the template: the pool host. */
export function deviceHost(env: NodeJS.ProcessEnv = process.env): DeviceHost {
  return poolHost({ env });
}

/** Installs a built app on the opened device. Throws DeviceHostError with the output when it fails. */
export function install(host: DeviceHost, app: string): void {
  const result = host.device(['install', app]);
  if (result.exitCode !== 0) {
    throw new DeviceHostError(`agent-device install ${app} failed: ${result.output}`);
  }
}

/**
 * The file that records the build on the opened device. A lease gives a new
 * device with a new command path, so the record of an old device never matches.
 */
function recordOf(root: string, host: DeviceHost): string {
  return path.join(root, 'tmp/native/devices', `${Bun.hash(host.id()).toString(36)}.json`);
}

/** The fingerprint of the build that `recordInstalled` wrote for the opened device, or null. */
export function installedOn(root: string, host: DeviceHost): { fingerprint: string } | null {
  const file = recordOf(root, host);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : null;
}

/** Records the fingerprint of the build on the opened device. A reader never gets half of the file. */
export function recordInstalled(root: string, host: DeviceHost, fingerprint: string): void {
  const file = recordOf(root, host);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.new`, `${JSON.stringify({ fingerprint })}\n`);
  renameSync(`${file}.new`, file);
}

/** Runs a Maestro flow on the opened device, with a limit of 15 minutes. */
export function runFlow(host: DeviceHost, flow: string): Result {
  return host.device(['replay', flow, '--maestro', '--timeout', String(15 * 60_000)]);
}

/** The model of the opened device, such as `iPhone 17`. */
export function deviceName(host: DeviceHost): string {
  const result = host.device(['devices', '--json']);
  try {
    const listed: { data?: { devices?: Array<{ model?: unknown }> } } = JSON.parse(result.output);
    const model = listed.data?.devices?.[0]?.model;
    return result.exitCode === 0 && typeof model === 'string' && model
      ? model
      : 'the opened device';
  } catch {
    return 'the opened device';
  }
}

/** `flow <file>` runs a Maestro flow on the opened device. */
function main(args: Array<string>): number {
  const [command, flow] = args;
  if (command !== 'flow' || !flow) {
    console.error(
      'Usage: AGENT_DEVICE=<path> mise exec -- bun tools/native/device-host.ts flow <flow.maestro.yaml>',
    );
    return 1;
  }
  const result = runFlow(deviceHost(), flow);
  console.log(result.output);
  return result.exitCode;
}

if (import.meta.main) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof DeviceHostError)) {
      throw error;
    }
    console.error(error.message);
    process.exitCode = 1;
  }
}

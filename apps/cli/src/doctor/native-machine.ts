import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { configBase } from '@/config';

/** Whether this machine has one native setting. `unknown` means doctor cannot tell. */
type MachineState = 'present' | 'missing' | 'unknown';

export type NativeMachine = {
  buildMachine: Exclude<MachineState, 'unknown'>;
  devicePool: MachineState;
};

/** Where the settings of this machine live. The test passes temporary folders. */
export type MachinePlace = {
  env: Record<string, string | undefined>;
  home: string;
};

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf-8'));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** True when an app under `apps/` depends on Expo or React Native. */
async function hasNativeApp(root: string): Promise<boolean> {
  const names = await readdir(path.join(root, 'apps')).catch(() => []);
  for (const name of names) {
    const manifest = await readJson(path.join(root, 'apps', name, 'package.json')).catch(
      () => null,
    );
    if (!isRecord(manifest)) {
      continue;
    }
    const all = [manifest.dependencies, manifest.devDependencies].filter(isRecord);
    if (all.some((deps) => 'expo' in deps || 'react-native' in deps)) {
      return true;
    }
  }
  return false;
}

/** The build machine setting: `{ "ssh": "<host>", "root": "<absolute folder>" }`. */
const buildMachineFile = (place: MachinePlace) =>
  path.join(configBase(place.env, place.home), 'clutch', 'build-machine.json');

/**
 * Text that a shell command holds with no quotes, and that ssh does not read as
 * an option. The same rule as `safe` in `tools/native/build-machine.ts`, which
 * the CLI cannot import.
 */
const plain = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9._/@][A-Za-z0-9._/@-]*$/u.test(value);

/** The setting is present when it parses, and `native:build` would read it. */
async function buildMachine(place: MachinePlace): Promise<NativeMachine['buildMachine']> {
  const setting = await readJson(buildMachineFile(place)).catch(() => null);
  const valid =
    isRecord(setting) && plain(setting.ssh) && plain(setting.root) && path.isAbsolute(setting.root);
  return valid ? 'present' : 'missing';
}

/**
 * Whether T3 Code names a device pool. The settings file belongs to T3 Code,
 * and its shape can change, so this line is advice only. Doctor reads only
 * whether `simlockDeviceHosts` is a non-empty array, and prints nothing from
 * the file.
 */
async function devicePool(place: MachinePlace): Promise<MachineState> {
  const file = path.join(place.home, '.t3', 'userdata', 'settings.json');
  const settings = await readJson(file).catch(() => null);
  if (!isRecord(settings)) {
    return 'unknown';
  }
  const hosts = settings.simlockDeviceHosts;
  const set =
    Array.isArray(hosts) && hosts.length > 0 && settings.simlockDeviceHostsEnabled !== false;
  return set ? 'present' : 'missing';
}

/** The native settings of this machine, or null for a repository with no native app. */
export async function nativeMachine(
  root: string,
  place: MachinePlace,
): Promise<NativeMachine | null> {
  if (!(await hasNativeApp(root))) {
    return null;
  }
  return {
    buildMachine: await buildMachine(place),
    devicePool: await devicePool(place),
  };
}

/** The two advice lines about this machine. They never change the exit code of doctor. */
export function renderNativeMachine(machine: NativeMachine, place: MachinePlace): string {
  const file = buildMachineFile(place).replace(place.home, '~');
  const build =
    machine.buildMachine === 'present'
      ? 'Build machine: set.'
      : `Build machine: not set. Write { "ssh": "<host>", "root": "<absolute folder>" } to ${file}. Without it, native:build cannot make a build.`;
  const pool = {
    present: 'Device pool: set in T3 Code.',
    missing:
      "Device pool: T3 Code names no device pool. Add the pool as a device host in T3 Code's settings.",
    unknown:
      'Device pool: unknown. T3 Code has no settings on this machine, so doctor cannot tell.',
  }[machine.devicePool];
  return `${build}\n${pool}`;
}

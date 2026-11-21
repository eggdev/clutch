import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { nativeMachine, renderNativeMachine } from '@/doctor/native-machine';

const folders: Array<string> = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true })));
});

async function write(file: string, content: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
}

/** A repository, and a home folder with the given settings files. */
async function machine(options: { native: boolean; build?: unknown; t3?: unknown }) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'native-machine-'));
  folders.push(base);
  const root = path.join(base, 'repo');
  const home = path.join(base, 'home');
  await write(path.join(root, 'apps', 'api', 'package.json'), {
    dependencies: { effect: '1' },
  });
  if (options.native) {
    await write(path.join(root, 'apps', 'app', 'package.json'), {
      dependencies: { expo: '57' },
    });
  }
  if (options.build !== undefined) {
    await write(path.join(home, '.config', 'clutch', 'build-machine.json'), options.build);
  }
  if (options.t3 !== undefined) {
    await write(path.join(home, '.t3', 'userdata', 'settings.json'), options.t3);
  }
  const place = { env: {}, home };
  const result = await nativeMachine(root, place);
  return { result, text: result ? renderNativeMachine(result, place) : '' };
}

test('a native app on a machine with both settings prints two lines that say so, and no values', async () => {
  const { result, text } = await machine({
    native: true,
    build: { ssh: 'secret-host', root: '/secret/folder' },
    t3: { simlockDeviceHosts: [{ address: 'secret-pool' }] },
  });
  expect(result).toEqual({ buildMachine: 'present', devicePool: 'present' });
  expect(text).toBe('Build machine: set.\nDevice pool: set in T3 Code.');
  expect(text).not.toContain('secret');
});

test('a native app on a machine with neither setting names the file and says doctor cannot tell', async () => {
  const { result, text } = await machine({ native: true });
  expect(result).toEqual({ buildMachine: 'missing', devicePool: 'unknown' });
  expect(text).toContain('~/.config/clutch/build-machine.json');
  expect(text).toContain('"ssh"');
  expect(text).toContain('native:build cannot make a build');
  expect(text).toContain('so doctor cannot tell');
});

test('a build machine file that does not parse or has a relative root is missing', async () => {
  for (const build of [
    '{ not json',
    { ssh: 'host', root: 'relative/folder' },
    { ssh: '', root: '/a' },
  ]) {
    const { result } = await machine({ native: true, build });
    expect(result?.buildMachine).toBe('missing');
  }
});

test('T3 settings with an empty pool list, or a turned-off pool, name no device pool', async () => {
  for (const t3 of [
    { simlockDeviceHosts: [] },
    { simlockDeviceHosts: [{}], simlockDeviceHostsEnabled: false },
  ]) {
    const { result, text } = await machine({ native: true, t3 });
    expect(result?.devicePool).toBe('missing');
    expect(text).toContain("Add the pool as a device host in T3 Code's settings.");
  }
});

test('a repository with no native app has no machine lines', async () => {
  const { result } = await machine({
    native: false,
    build: { ssh: 'host', root: '/folder' },
    t3: { simlockDeviceHosts: [{}] },
  });
  expect(result).toBeNull();
});

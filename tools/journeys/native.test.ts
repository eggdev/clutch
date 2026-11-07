import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { nativeMain } from '@tools/journeys/native';
import type { DeviceHost } from '@tools/native/device-host';
import { inRepo } from '@tools/testing/in-repo';

const flow = '# sign-up: A visitor signs up.\nappId: com.example\n';

/** A host whose flows answer the exit codes in order. */
function host(codes: Array<number>, booted = true) {
  const ran: Array<string> = [];
  const fake: DeviceHost = {
    name: 'fake',
    bootedDevice: (platform) =>
      Promise.resolve(booted ? { platform, id: 'emulator-5554', name: 'pixel-7-api-35' } : null),
    install: () => Promise.resolve(),
    runFlow: (_device, file) => {
      ran.push(file);
      return Promise.resolve({
        exitCode: codes.shift() ?? 0,
        output: `ran ${file}`,
      });
    },
    build: () => Promise.resolve({ exitCode: 1, output: '' }),
  };
  return { fake, ran };
}

function run(codes: Array<number>, booted = true) {
  return inRepo({ 'features/account/journeys/sign-up.maestro.yaml': flow }, async (root) => {
    const { fake, ran } = host(codes, booted);
    const lines: Array<string> = [];
    const filed: Array<string> = [];
    const exitCode = await nativeMain(root, 'android', {
      host: fake,
      lock: path.join(root, '.lock'),
      log: (line) => lines.push(line),
      fileFlake: (text) => {
        filed.push(text);
        return Promise.resolve();
      },
    });
    const file = path.join(root, 'test-results/journeys/measures/sign-up.android.json');
    const measures = booted ? JSON.parse(readFileSync(file, 'utf-8')) : null;
    return { exitCode, ran, lines, filed, measures };
  });
}

test('a native journey that passes on the retry passes, files a flake, and writes its measures', async () => {
  const result = await run([1, 0]);
  expect(result.exitCode).toBe(0);
  expect(result.ran).toHaveLength(2);
  expect(result.filed).toEqual([
    'Journey sign-up failed, then passed on the retry, on android (pixel-7-api-35). See test-results/journeys/measures/sign-up.android.json.',
  ]);
  expect(result.measures.runs[0]).toMatchObject({
    platform: 'android',
    device: 'pixel-7-api-35',
    result: 'flaky',
  });
});

test('a native journey that fails twice fails, and one that passes runs once', async () => {
  const failed = await run([1, 1]);
  expect(failed.exitCode).toBe(1);
  expect(failed.measures.runs[0].result).toBe('failed');
  const passed = await run([0]);
  expect([passed.exitCode, passed.ran.length, passed.filed]).toEqual([0, 1, []]);
});

test('with no booted device, the run fails and asks for one', async () => {
  const result = await run([], false);
  expect(result.exitCode).toBe(1);
  expect(result.lines.at(-1)).toContain('No android device is booted');
});

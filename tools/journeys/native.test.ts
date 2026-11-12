import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { nativeMain } from '@tools/journeys/native';
import type { DeviceHost } from '@tools/native/device-host';
import { inRepo } from '@tools/testing/in-repo';

const flow = '# sign-up: A visitor signs up.\nappId: com.example\n';

/** A host whose flows answer the exit codes in order. */
function host(codes: Array<number>, booted = true, readable = true) {
  const ran: Array<string> = [];
  const fake: DeviceHost = {
    name: 'fake',
    bootedDevice: (platform) =>
      Promise.resolve(booted ? { platform, id: 'emulator-5554', name: 'pixel-7-api-35' } : null),
    install: () => Promise.resolve(),
    checkFlow: () =>
      Promise.resolve(
        readable ? { exitCode: 0, output: 'OK' } : { exitCode: 1, output: 'Invalid Command: tapp' },
      ),
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

const signUp: Record<string, string> = { 'features/account/journeys/sign-up.maestro.yaml': flow };

/** A fingerprint tool that answers one hash for each platform. */
const fingerprintOf = (hash: string) => () =>
  Promise.resolve({ create: () => Promise.resolve({ hash, sources: [] }) });

function run(
  codes: Array<number>,
  booted = true,
  files: Record<string, string> = signUp,
  sources = 'built',
  readable = true,
) {
  return inRepo(files, async (root) => {
    const { fake, ran } = host(codes, booted, readable);
    const lines: Array<string> = [];
    const filed: Array<string> = [];
    const exitCode = await nativeMain(root, 'android', {
      host: fake,
      tool: fingerprintOf(sources),
      lock: path.join(root, '.lock'),
      log: (line) => lines.push(line),
      fileFlake: (text) => {
        filed.push(text);
        return Promise.resolve();
      },
    });
    const file = path.join(root, 'test-results/journeys/measures/sign-up.android.json');
    const measures = booted && ran.length > 0 ? JSON.parse(readFileSync(file, 'utf-8')) : null;
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

test('a flow that Maestro cannot read fails the run, and no device runs it', async () => {
  const result = await run([0], true, signUp, 'built', false);
  expect([result.exitCode, result.ran]).toEqual([1, []]);
  expect(result.lines).toEqual([
    '::error title=Maestro cannot read the flow::features/account/journeys/sign-up.maestro.yaml: Invalid Command: tapp',
  ]);
});

test('with no booted device, a flow that Maestro cannot read is still reported', async () => {
  const result = await run([], false, signUp, 'built', false);
  expect(result.exitCode).toBe(1);
  expect(result.lines[0]).toContain('Maestro cannot read the flow');
  expect(result.lines.at(-1)).toContain('No android device is booted');
});

test('with no native journey, the run fails, since the lane runs only when a native app exists', async () => {
  const result = await run([], true, {});
  expect([result.exitCode, result.ran]).toEqual([1, []]);
  expect(result.lines).toEqual([
    '::error title=No journey ran::No native journey exists, so the android run proves nothing. Add one at features/<feature>/journeys/<id>.maestro.yaml. See docs/contributing/end-to-end-testing.md#native-journeys.',
  ]);
});

/** A native app with the Expo dependency, an app ID for Android, and a build on record. */
const app = (id: string | null) => ({
  'apps/mobile/package.json': JSON.stringify({ dependencies: { expo: '1.0.0' } }),
  'apps/mobile/native-fingerprint.json': JSON.stringify({
    android: { hash: 'built', sources: [] },
  }),
  'apps/mobile/app.json': JSON.stringify(
    id === null ? { expo: {} } : { expo: { android: { package: id } } },
  ),
});

const journeyFile = (body: string, header = '') => {
  const steps = path.join(import.meta.dir, '../../packages/journeys/testing/steps.ts');
  const journeyKit = path.join(import.meta.dir, '../../packages/journeys/testing/journey.ts');
  return [
    `/**\n * sign-up: A visitor signs up.\n${header}*/`,
    `import { journey } from ${JSON.stringify(journeyKit)};`,
    `import { button, open, outcome, tap } from ${JSON.stringify(steps)};`,
    `export const signUp = journey('a visitor signs up', [${body}]);`,
    '',
  ].join('\n');
};

const welcome =
  "open('/'), tap(button('Sign up')), outcome('signed-up', { url: '/home', text: 'Welcome' })";

test('a data journey compiles to a flow, runs it, and records each outcome with its clicks', async () => {
  const file = 'features/account/journeys/sign-up.journey.ts';
  const result = await run([0], true, { ...app('com.example'), [file]: journeyFile(welcome) });
  expect(result.exitCode).toBe(0);
  expect(result.ran).toHaveLength(1);
  expect(result.ran[0]).toMatch(/test-results\/journeys\/native\/sign-up\.maestro\.yaml$/u);
  expect(result.measures.runs[0]).toMatchObject({ result: 'passed' });
  expect(result.measures.runs[0].attempts[0].outcomes).toEqual([{ name: 'signed-up', clicks: 1 }]);
});

test('a data journey whose outcome is over the click budget of its core journey fails, even on the retry', async () => {
  const file = 'features/account/journeys/sign-up.journey.ts';
  const taps = "tap(button('Next')), tap(button('Next')), tap(button('Next')), ";
  const body = `${taps}${welcome}`;
  const result = await run([0, 0], true, {
    ...app('com.example'),
    [file]: journeyFile(body, ' * Core: sign-up\n'),
  });
  expect(result.exitCode).toBe(1);
  expect(result.ran).toHaveLength(2);
  expect(result.measures.runs[0].result).toBe('failed');
  expect(result.measures.runs[0].budgetFailure).toMatchObject({ kind: 'click-budget' });
  expect(result.measures.runs[0].budgetFailure.message).toContain(
    'sign-up took 4 clicks or taps from the entry to `signed-up`, over its budget of 3',
  );
});

test('a data journey with no app ID in app.json fails with a sentence, and does not run', async () => {
  const file = 'features/account/journeys/sign-up.journey.ts';
  const result = await run([0], true, { ...app(null), [file]: journeyFile(welcome) });
  expect(result.exitCode).toBe(1);
  expect(result.ran).toEqual([]);
  expect(result.lines.at(0)).toContain(
    'apps/mobile/app.json names no app ID, so the native journeys cannot run. Set expo.android.package.',
  );
});

test('a build that is older than its sources is not driven, and neither is an app with no build', async () => {
  const file = 'features/account/journeys/sign-up.journey.ts';
  const files = { ...app('com.example'), [file]: journeyFile(welcome) };
  const stale = await run([0], true, files, 'changed');
  expect([stale.exitCode, stale.ran]).toEqual([1, []]);
  expect(stale.lines).toEqual([
    '::error title=Stale build::The android build of apps/mobile is older than its sources: the native fingerprint changed since the build. Build it again: `mise exec -- bun run native:build mobile --platform android`.',
  ]);
  const { 'apps/mobile/native-fingerprint.json': _record, ...unbuilt } = files;
  const none = await run([0], true, unbuilt);
  expect([none.exitCode, none.ran]).toEqual([1, []]);
  expect(none.lines[0]).toContain('apps/mobile has no android build on record');
});

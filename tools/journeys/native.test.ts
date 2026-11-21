import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { nativeMain } from '@tools/journeys/native';
import type { NativeOptions } from '@tools/journeys/native';
import { DeviceHostError, recordInstalled } from '@tools/native/device-host';
import type { DeviceHost, Result } from '@tools/native/device-host';
import { inRepo } from '@tools/testing/in-repo';
import { parse } from 'yaml';

/** A host that records each call, with the root as `<root>`, and answers each with `answer`. */
function host(root: string, answer: (args: ReadonlyArray<string>) => Result | null) {
  const calls: Array<Array<string>> = [];
  const fake: DeviceHost = {
    name: 'fake',
    device: (args) => {
      if (args[0] === 'devices') {
        const devices = [{ model: 'pixel-7-api-35', osVersion: '15' }];
        return { exitCode: 0, output: JSON.stringify({ success: true, data: { devices } }) };
      }
      const call = args.map((item) => item.replace(root, '<root>'));
      // A replay ends with its time limit, which the tests leave out.
      calls.push(call[0] === 'replay' ? call.slice(0, 2) : call);
      return answer(args) ?? { exitCode: 0, output: `ran ${call.join(' ')}` };
    },
    id: () => 'fake',
  };
  return { fake, calls };
}

/** A native app with the Expo dependency, and an app ID for Android, or none. */
const app = (id: string | null = 'com.example') => ({
  'apps/mobile/package.json': JSON.stringify({ dependencies: { expo: '1.0.0' } }),
  'apps/mobile/app.json': JSON.stringify(
    id === null ? { expo: {} } : { expo: { android: { package: id } } },
  ),
});

const flowFile = 'features/account/journeys/sign-up.maestro.yaml';
const maestro = (steps: string) => ({
  ...app(),
  [flowFile]: `# sign-up: A visitor signs up.\nappId: com.example\n---\n${steps}`,
});
const signUp = maestro('- launchApp\n- tapOn: Sign up\n');

type Setup = {
  answer?: (args: ReadonlyArray<string>) => Result | null;
  installed?: string | null;
  sources?: string;
  opened?: boolean;
  up?: boolean;
};

function run(files: Record<string, string>, setup: Setup = {}) {
  return inRepo(files, async (root) => {
    const { fake, calls } = host(root, setup.answer ?? (() => null));
    const device: DeviceHost =
      setup.opened === false
        ? {
            ...fake,
            id: () => {
              throw new DeviceHostError('`AGENT_DEVICE` is not set, so no device is named.');
            },
          }
        : fake;
    if (setup.installed !== null && setup.opened !== false) {
      recordInstalled(root, fake, setup.installed ?? 'built');
    }
    const lines: Array<string> = [];
    const links: Array<unknown> = [];
    const options: NativeOptions = {
      host: device,
      tool: () =>
        Promise.resolve({
          create: () => Promise.resolve({ hash: setup.sources ?? 'built', sources: [] }),
        }),
      log: (line) => lines.push(line),
      servers: () =>
        Promise.resolve([
          { url: 'http://api.x.localhost:1355', health: '/health', up: setup.up ?? true },
        ]),
      link: (servers) => {
        links.push(servers);
        return Promise.resolve();
      },
    };
    const exitCode = await nativeMain(root, 'android', options);
    // The files that the run wrote, read before the repository goes away.
    const written = existsSync(path.join(root, 'test-results'))
      ? [...new Bun.Glob('test-results/**/*').scanSync({ cwd: root })]
      : [];
    const saved = new Map(
      written.map((file) => [file, readFileSync(path.join(root, file), 'utf-8')]),
    );
    const read = (file: string) => saved.get(file) ?? null;
    const measures = read('test-results/journeys/measures/sign-up.android.json');
    return { exitCode, calls, lines, links, read, measures: measures && JSON.parse(measures) };
  });
}

const evidence = 'test-results/journeys/native/sign-up';
const replay = (first: string) => ['replay', `<root>/${evidence}/parts/${first}.maestro.yaml`];
const screenshot = (name: string) => ['screenshot', `<root>/${evidence}/${name}.png`];

test('a native journey that passes runs once, links the dev servers, and saves the final screen', async () => {
  const result = await run(signUp);
  expect(result.exitCode).toBe(0);
  expect(result.calls).toEqual([replay('001'), screenshot('final-screen')]);
  expect(result.links).toEqual([[{ url: 'http://api.x.localhost:1355', health: '/health' }]]);
  expect(result.measures.runs[0].result).toBe('passed');
  expect(result.lines).toContain(`The evidence of sign-up is in ${evidence}/.`);
});

test('a flow with a script step and a screenshot runs its parts in order, and writes each part', async () => {
  const steps = [
    '- launchApp',
    `- evalScript: \${output.seen = device.wait("label=\\"Title\\" value=\\"Milk\\"", 500)}`,
    `- assertTrue: \${output.seen}`,
    '- takeScreenshot: middle',
    '- tapOn: Done',
    '',
  ].join('\n');
  const result = await run(maestro(steps));
  expect(result.exitCode).toBe(0);
  expect(result.calls).toEqual([
    replay('001'),
    ['wait', 'label="Title" value="Milk"', '500'],
    replay('003'),
    screenshot('middle'),
    replay('005'),
    screenshot('final-screen'),
  ]);
  // The device gets the value of the script, not the script.
  expect(parse(result.read(`${evidence}/parts/003.maestro.yaml`)?.split('---\n')[1] ?? '')).toEqual(
    [{ assertTrue: 'true' }],
  );
  expect(result.read(`${evidence}/output.txt`)).toContain('Step 2 passed.');
});

test('a device part that fails stops the journey, runs no retry, and still saves the final screen', async () => {
  const steps = '- launchApp\n- takeScreenshot: middle\n- tapOn: Done\n';
  const result = await run(maestro(steps), {
    answer: (args) => (args[0] === 'replay' ? { exitCode: 1, output: 'no Sign up' } : null),
  });
  expect(result.exitCode).toBe(1);
  expect(result.calls).toEqual([replay('001'), screenshot('final-screen')]);
  expect(result.lines).toContain(
    `${flowFile} failed on pixel-7-api-35. See test-results/journeys/measures/sign-up.android.json.`,
  );
  expect(result.measures.runs[0]).toMatchObject({ platform: 'android', result: 'failed' });
  expect(result.read(`${evidence}/output.txt`)).toBe('no Sign up\n');
});

test('a device.wait that fails makes the journey fail with the output of the command', async () => {
  const steps = `- launchApp\n- evalScript: \${device.wait("label=\\"Title\\"", 500)}\n- tapOn: Done\n`;
  const result = await run(maestro(steps), {
    answer: (args) =>
      args[0] === 'wait' ? { exitCode: 1, output: 'No element matched within 500 ms' } : null,
  });
  expect(result.exitCode).toBe(1);
  expect(result.calls.map((call) => call[0])).toEqual(['replay', 'wait', 'screenshot']);
  expect(result.lines).toContain(
    'Step 2 is an evalScript that failed: agent-device wait failed: No element matched within 500 ms',
  );
});

test('a script step inside another step is refused before the device gets a step', async () => {
  const steps = `- runFlow:\n    commands:\n      - evalScript: \${output.a = 1}\n`;
  const result = await run(maestro(steps));
  expect([result.exitCode, result.calls]).toEqual([1, []]);
  expect(result.lines[0]).toStartWith(
    `::error title=Flow cannot run in parts::${flowFile}: Step 1 holds a script or screenshot step inside another step`,
  );
});

test('a device with no install record, or with the build of another fingerprint, runs no flow', async () => {
  const install =
    '`AGENT_DEVICE=fake mise exec -- bun run native:build --platform android --install`';
  const none = await run(signUp, { installed: null });
  expect([none.exitCode, none.calls, none.links]).toEqual([1, [], []]);
  expect(none.lines).toEqual([
    `::error title=No build of the sources on the device::This checkout installed no build on the opened device. Install it: ${install}.`,
  ]);
  const other = await run(signUp, { installed: 'aaaaaaaa11', sources: 'bbbbbbbb22' });
  expect([other.exitCode, other.calls]).toEqual([1, []]);
  expect(other.lines).toEqual([
    `::error title=No build of the sources on the device::The opened device has the build of fingerprint aaaaaaaa, and the sources have bbbbbbbb. Install the build of the sources: ${install}.`,
  ]);
});

test('with the dev servers down, the run names the fix and runs no flow', async () => {
  const result = await run(signUp, { up: false });
  expect([result.exitCode, result.calls, result.links]).toEqual([1, [], []]);
  expect(result.lines).toEqual([
    'The dev servers are down. Start them with `mise exec -- bun run dev`.',
  ]);
});

test('with no opened device, the run fails and names the fix', async () => {
  const result = await run(signUp, { opened: false });
  expect([result.exitCode, result.calls]).toEqual([1, []]);
  expect(result.lines.at(-1)).toContain('`AGENT_DEVICE` is not set');
});

test('with no native journey, the run fails, since it proves nothing', async () => {
  const result = await run({});
  expect([result.exitCode, result.calls]).toEqual([1, []]);
  expect(result.lines).toEqual([
    '::error title=No journey ran::No native journey exists, so the android run proves nothing. Add one at features/<feature>/journeys/<id>.maestro.yaml. See docs/contributing/end-to-end-testing.md#native-journeys.',
  ]);
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
const dataFile = 'features/account/journeys/sign-up.journey.ts';

test('a data journey compiles to a flow, runs it, and records each outcome with its clicks', async () => {
  const result = await run({ ...app(), [dataFile]: journeyFile(welcome) });
  expect(result.exitCode).toBe(0);
  expect(result.calls).toEqual([replay('001'), screenshot('final-screen')]);
  expect(result.read('test-results/journeys/native/sign-up.maestro.yaml')).toStartWith(
    'appId: com.example\n---\n',
  );
  expect(result.measures.runs[0]).toMatchObject({ result: 'passed' });
  expect(result.measures.runs[0].attempts[0].outcomes).toEqual([{ name: 'signed-up', clicks: 1 }]);
});

test('a data journey whose outcome is over the click budget of its core journey fails', async () => {
  const taps = "tap(button('Next')), tap(button('Next')), tap(button('Next')), ";
  const result = await run({
    ...app(),
    [dataFile]: journeyFile(`${taps}${welcome}`, ' * Core: sign-up\n'),
  });
  expect(result.exitCode).toBe(1);
  expect(result.calls).toHaveLength(2);
  expect(result.measures.runs[0].result).toBe('failed');
  expect(result.measures.runs[0].budgetFailure).toMatchObject({ kind: 'click-budget' });
  expect(result.measures.runs[0].budgetFailure.message).toContain(
    'sign-up took 4 clicks or taps from the entry to `signed-up`, over its budget of 3',
  );
});

test('a data journey with no app ID in app.json fails with a sentence, and does not run', async () => {
  const result = await run({ ...app(null), [dataFile]: journeyFile(welcome) });
  expect([result.exitCode, result.calls]).toEqual([1, []]);
  expect(result.lines.at(0)).toContain(
    'apps/mobile/app.json names no app ID, so the native journeys cannot run. Set expo.android.package.',
  );
});

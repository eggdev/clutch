import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildMachineOf, findOrMakeBuild, projectOf } from '@tools/native/build-machine';
import type { BuildRequest, Runner } from '@tools/native/build-machine';

const fingerprint = 'a1'.repeat(20);
const revision = 'c3'.repeat(20);
const env = { XDG_CONFIG_HOME: '/config' };
const file = '/config/clutch/build-machine.json';
const machine = { ssh: 'mac', root: '/builds' };
const folder = '/builds/demo';

function repository(name = 'demo'): string {
  const root = mkdtempSync(path.join(tmpdir(), 'build-machine-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name }));
  mkdirSync(path.join(root, 'tools/native'), { recursive: true });
  writeFileSync(path.join(root, 'tools/native/ios-simulator-build.sh'), 'echo build\n');
  return root;
}

test('the setting is read from the config folder', () => {
  const read = (at: string) => (at === file ? JSON.stringify(machine) : null);
  expect(buildMachineOf(env, read)).toEqual(machine);
});

test('a missing or bad setting is refused with the name of the file', () => {
  const bad = [null, '{', '{"ssh":"mac","root":"builds"}', '{"ssh":"a b","root":"/b"}'];
  for (const text of [...bad, '{"ssh":"-oProxyCommand=x","root":"/b"}']) {
    expect(() => buildMachineOf(env, () => text)).toThrow(`Write \`${file}\``);
  }
  expect(() => buildMachineOf(env, () => `{"ssh":"m'ac","root":"/b"}`)).toThrow(
    'names no build machine',
  );
});

test('the project is the package name without its scope', () => {
  expect(projectOf(repository('demo'))).toBe('demo');
  expect(projectOf(repository('@org/demo'))).toBe('demo');
  expect(() => projectOf(repository('Not A Name'))).toThrow('not a plain lowercase name');
});

type Call = { readonly kind: 'capture' | 'pipe'; readonly argv: ReadonlyArray<string> };
type Answers = { readonly found?: number; readonly built?: number; readonly last?: string };

/** A fake runner that records each call and answers as a build machine would. */
function fake(answers: Answers) {
  const calls: Array<Call> = [];
  const runner: Runner = {
    capture: (argv) => {
      calls.push({ kind: 'capture', argv });
      const remote = argv.at(-1) ?? '';
      if (argv[0] === 'git') {
        return Promise.resolve({ code: 0, stdout: `${revision}\n`, stderr: '' });
      }
      const code = remote.includes('test -d') ? (answers.found ?? 0) : 0;
      return Promise.resolve({ code, stdout: '', stderr: code === 255 ? 'refused' : '' });
    },
    pipe: (from, to) => {
      calls.push({ kind: 'pipe', argv: [...from, '|', ...to] });
      if (from[0] === 'git') {
        return Promise.resolve({
          code: answers.built ?? 0,
          lastLine: answers.last ?? fingerprint,
          stderr: '',
        });
      }
      mkdirSync(path.join(to.at(-1) ?? '', 'Clutch.app'), { recursive: true });
      return Promise.resolve({ code: 0, lastLine: '', stderr: '' });
    },
  };
  return { calls, runner };
}

function request(root: string, runner: Runner, extra: Partial<BuildRequest> = {}): BuildRequest {
  return { root, app: 'mobile', platform: 'ios', fingerprint, log: () => {}, runner, ...extra };
}
const withMachine = () => machine;
const target = (root: string) => path.join(root, 'tmp/native', fingerprint);

test('a cached app returns with no process and no setting', async () => {
  const root = repository();
  mkdirSync(path.join(target(root), 'Clutch.app'), { recursive: true });
  const { calls, runner } = fake({});
  const machineCalls: Array<string> = [];
  const read = () => {
    machineCalls.push('read');
    return machine;
  };
  const app = await findOrMakeBuild(request(root, runner, { machine: read }));
  expect(app).toBe(path.join(target(root), 'Clutch.app'));
  expect(calls).toEqual([]);
  expect(machineCalls).toEqual([]);
});

test('a build on the build machine is copied, not made', async () => {
  const root = repository();
  const { calls, runner } = fake({ found: 0 });
  const app = await findOrMakeBuild(request(root, runner, { machine: withMachine }));
  expect(app).toBe(path.join(target(root), 'Clutch.app'));
  expect(calls.map((call) => call.kind)).toEqual(['capture', 'pipe']);
  expect(calls[0]?.argv).toEqual([
    'ssh',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=15',
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=3',
    'mac',
    `zsh -lc 'test -d ${folder}/artifacts/${fingerprint}'`,
  ]);
  expect(calls[1]?.argv.join(' ')).toContain(`-C ${folder}/artifacts/${fingerprint} -cf - .`);
  expect(existsSync(`${target(root)}.partial`)).toBe(false);
});

test('with no build, the script goes over, the head commit builds, and the app is copied', async () => {
  const root = repository();
  const { calls, runner } = fake({ found: 1 });
  const lines: Array<string> = [];
  const log = (line: string) => lines.push(line);
  const app = await findOrMakeBuild(request(root, runner, { machine: withMachine, log }));
  expect(app).toBe(path.join(target(root), 'Clutch.app'));
  expect(calls.map((call) => call.argv[0])).toEqual(['ssh', 'git', 'ssh', 'git', 'ssh']);
  expect(calls[2]?.argv.at(-1)).toContain(`cat > ${folder}/bin/ios-simulator-build.sh`);
  expect(calls[3]?.argv.at(-1)).toBe(
    `zsh -lc 'exec bash ${folder}/bin/ios-simulator-build.sh ${folder} mobile ${revision} ${fingerprint}'`,
  );
  expect(lines[0]).toStartWith(`Building ${revision.slice(0, 8)} on the build machine.`);
});

const refusals: Array<[string, Answers | 'android', string]> = [
  ['another build runs', { found: 1, built: 75 }, 'Another build of this project runs'],
  ['the build fails', { found: 1, built: 2 }, '(exit 2). Read its output above.'],
  [
    'the commit has another fingerprint',
    { found: 1, last: 'b2'.repeat(20) },
    'The head commit has the native fingerprint b2b2b2b2, and this checkout has a1a1a1a1.',
  ],
  [
    'the script stops for another fingerprint',
    { found: 1, built: 76, last: 'b2'.repeat(20) },
    'The head commit has the native fingerprint b2b2b2b2, and this checkout has a1a1a1a1.',
  ],
  ['ssh fails', { found: 255 }, 'ssh mac failed: refused'],
  ['the platform is android', 'android', 'makes no Android build yet'],
];

for (const [name, answers, message] of refusals) {
  test(`a request is refused when ${name}`, async () => {
    const root = repository();
    const { runner } = fake(answers === 'android' ? {} : answers);
    const platform = answers === 'android' ? 'android' : 'ios';
    await expect(
      findOrMakeBuild(request(root, runner, { machine: withMachine, platform })),
    ).rejects.toThrow(message);
    expect(existsSync(target(root))).toBe(false);
  });
}

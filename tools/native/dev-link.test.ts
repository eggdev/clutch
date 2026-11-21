import { expect, test } from 'bun:test';

import { sshOptions } from '@tools/native/build-machine';
import { linkDevServers } from '@tools/native/dev-link';
import type { DevServer } from '@tools/native/dev-link';

const servers: Array<DevServer> = [
  { url: 'http://clutch.localhost:1355', health: '/' },
  { url: 'http://api.clutch.localhost:1355', health: '/health' },
];

type Answers = { readonly running?: number; readonly forward?: number; readonly probe?: number };

/** A fake `capture` that records each call, and answers the look for a forward, the forward and each probe. */
function fake(answers: Answers = {}, forwardError = '') {
  const calls: Array<ReadonlyArray<string>> = [];
  const capture = (argv: ReadonlyArray<string>) => {
    calls.push(argv);
    if (argv[0] === 'pgrep') {
      return Promise.resolve({ code: answers.running ?? 0, stdout: '', stderr: '' });
    }
    if (argv.includes('-R')) {
      return Promise.resolve({ code: answers.forward ?? 0, stdout: '', stderr: forwardError });
    }
    return Promise.resolve({ code: answers.probe ?? 0, stdout: '', stderr: '' });
  };
  return { calls, capture };
}

function link(list: ReadonlyArray<DevServer>, runner: ReturnType<typeof fake>) {
  const lines: Array<string> = [];
  const run = linkDevServers(list, {
    log: (line) => lines.push(line),
    machine: () => ({ ssh: 'builder.test', root: '/builds' }),
    runner,
  });
  return { lines, run };
}

const forwardLine =
  'Forwarding port 1355 of the build machine to the dev servers of this machine. The forward stays up for the next run.';
const look = ['pgrep', '-f', '--', '-R 1355:127\\.0\\.0\\.1:1355 builder\\.test$'];
const probe = (url: string) => [
  'ssh',
  ...sshOptions,
  'builder.test',
  `zsh -lc 'curl -sf -o /dev/null -m 5 "${url}"'`,
];
const probes = [
  probe('http://clutch.localhost:1355/'),
  probe('http://api.clutch.localhost:1355/health'),
];

test('when this machine already runs the forward, no forward starts, and each server is probed', async () => {
  const runner = fake();
  const { lines, run } = link(servers, runner);
  await run;
  expect(lines).toEqual([]);
  expect(runner.calls).toEqual([look, ...probes]);
});

test('when no forward runs, the link starts its own, then probes each server', async () => {
  const runner = fake({ running: 1 });
  const { lines, run } = link(servers, runner);
  await run;
  expect(lines).toEqual([forwardLine]);
  expect(runner.calls).toHaveLength(4);
  // The forward writes no output that capture would wait for.
  expect(runner.calls[1]?.slice(0, 2)).toEqual(['sh', '-c']);
  expect(runner.calls[1]?.slice(3)).toEqual([
    'forward',
    'ssh',
    '-f',
    '-N',
    ...sshOptions,
    '-o',
    'ExitOnForwardFailure=yes',
    '-R',
    '1355:127.0.0.1:1355',
    'builder.test',
  ]);
  expect(runner.calls.slice(2)).toEqual(probes);
});

test('a forward that fails refuses before any probe, names the port, and names no machine', async () => {
  const runner = fake(
    { running: 1, forward: 255 },
    'remote port forwarding failed for listen port 1355\n',
  );
  const { run } = link(servers, runner);
  // The exact message holds no ssh name.
  await expect(run).rejects.toThrow(
    /^The build machine could not forward port 1355 to this machine: remote port forwarding failed for listen port 1355\. Another listener holds that port there: the dev servers of the build machine, or the forward of another machine\.$/u,
  );
  expect(runner.calls).toHaveLength(2);
});

test('a server that does not answer through the forward refuses, and names its URL', async () => {
  const { run } = link(servers, fake({ probe: 1 }));
  await expect(run).rejects.toThrow(
    'The build machine cannot reach http://clutch.localhost:1355. Start the dev servers with `mise exec -- bun run dev`, then run the command again.',
  );
});

test('a URL or health path that the remote shell would read is refused before the probe', async () => {
  for (const server of [
    { url: 'http://a.localhost:1355', health: '/$(id)' },
    { url: 'http://a.localhost:1355', health: "/it's" },
  ]) {
    const runner = fake();
    await expect(link([server], runner).run).rejects.toThrow('so the probe cannot send it');
    expect(runner.calls).toEqual([look]);
  }
});

test('dev servers on two ports refuse before any call', async () => {
  const runner = fake();
  const { run } = link(
    [
      servers[0] ?? { url: '', health: '/' },
      { url: 'http://api.localhost:8787', health: '/health' },
    ],
    runner,
  );
  await expect(run).rejects.toThrow('The dev servers answer on the ports 1355, 8787');
  expect(runner.calls).toEqual([]);
});

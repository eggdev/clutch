import { expect, test } from 'bun:test';

import { linkDevServers } from '@tools/native/dev-link';
import type { DevServer } from '@tools/native/dev-link';

const servers: Array<DevServer> = [
  { url: 'http://clutch.localhost:1355', health: '/' },
  { url: 'http://api.clutch.localhost:1355', health: '/health' },
];

/** A fake `capture` that answers each probe by its round: before the forward, then after it. */
function fake(probes: Array<number>, forwardCode = 0, forwardError = '') {
  const calls: Array<ReadonlyArray<string>> = [];
  let probe = 0;
  const capture = (argv: ReadonlyArray<string>) => {
    calls.push(argv);
    if (argv.includes('-R')) {
      probe = Math.max(probe, 1);
      return Promise.resolve({ code: forwardCode, stdout: '', stderr: forwardError });
    }
    return Promise.resolve({ code: probes[probe] ?? 1, stdout: '', stderr: '' });
  };
  return { calls, capture };
}

function link(list: ReadonlyArray<DevServer>, runner: ReturnType<typeof fake>) {
  const lines: Array<string> = [];
  const run = linkDevServers(list, {
    log: (line) => lines.push(line),
    machine: () => ({ ssh: 'builder', root: '/builds' }),
    runner,
  });
  return { lines, run };
}

const forwardLine =
  'Forwarding port 1355 of the build machine to the dev servers of this machine. The forward stays up for the next run.';

test('when each dev server answers on the build machine, no forward starts', async () => {
  const runner = fake([0]);
  const { lines, run } = link(servers, runner);
  await run;
  expect(lines).toEqual([]);
  expect(runner.calls).toEqual([
    [
      'ssh',
      '-o',
      'BatchMode=yes',
      'builder',
      "zsh -lc 'curl -sf -o /dev/null -m 5 http://clutch.localhost:1355/'",
    ],
    [
      'ssh',
      '-o',
      'BatchMode=yes',
      'builder',
      "zsh -lc 'curl -sf -o /dev/null -m 5 http://api.clutch.localhost:1355/health'",
    ],
  ]);
});

test('a probe that fails starts the forward, and the probe after it passes', async () => {
  const runner = fake([1, 0]);
  const { lines, run } = link(servers, runner);
  await run;
  expect(lines).toEqual([forwardLine]);
  expect(runner.calls).toHaveLength(5);
  expect(runner.calls[2]).toEqual([
    'ssh',
    '-f',
    '-N',
    '-o',
    'BatchMode=yes',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ServerAliveInterval=30',
    '-R',
    '1355:127.0.0.1:1355',
    'builder',
  ]);
});

test('a forward that fails refuses, and the message names no machine', async () => {
  const runner = fake([1], 255, 'remote port forwarding failed for listen port 1355\n');
  const { run } = link(servers, runner);
  // The exact message holds no ssh name.
  await expect(run).rejects.toThrow(
    /^The build machine could not forward port 1355 to this machine: remote port forwarding failed for listen port 1355\. Another machine may hold that port\.$/u,
  );
});

test('a server that still does not answer after the forward refuses, and names its URL', async () => {
  const runner = fake([1, 1]);
  const { run } = link(servers, runner);
  await expect(run).rejects.toThrow(
    'The build machine cannot reach http://clutch.localhost:1355. Start the dev servers with `mise exec -- bun run dev`, then run the command again.',
  );
});

test('dev servers on two ports refuse before any probe', async () => {
  const runner = fake([0]);
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

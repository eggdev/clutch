import { expect, test } from 'bun:test';

import { fakeClock } from '@tools/github/fake-run';
import { isRead, isTransient, withRetry } from '@tools/github/gh-retry';
import type { Result, Run } from '@tools/github/stack';

/** A runner that answers each call in turn, and keeps the commands it ran. The last answer repeats. */
function sequence(answers: Array<Partial<Result>>) {
  const calls: Array<string> = [];
  const run: Run = (command) => {
    calls.push(command.join(' '));
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    return Promise.resolve({ ok: true, out: '', err: '', ...answer });
  };
  return { run, calls };
}

const unavailable = { ok: false, err: 'HTTP 503: No server is currently available' };
const notFound = { ok: false, err: 'HTTP 404: Not Found' };

test('a transient failure is retried, and the read then succeeds', async () => {
  const gh = sequence([unavailable, { ok: true, out: 'main\n' }]);
  const clock = fakeClock();
  const result = await withRetry(
    gh.run,
    clock,
  )(['gh', 'repo', 'view', '--json', 'defaultBranchRef']);
  expect(result).toMatchObject({ ok: true, out: 'main\n' });
  expect(gh.calls).toHaveLength(2);
  expect(clock.slept).toBe(2000);
});

test('a failure that is not transient is not retried', async () => {
  const gh = sequence([notFound]);
  const clock = fakeClock();
  const result = await withRetry(gh.run, clock)(['gh', 'api', 'repos/eggdev/clutch']);
  expect(result.err).toBe('HTTP 404: Not Found');
  expect(gh.calls).toHaveLength(1);
  expect(clock.slept).toBe(0);
});

test('a write is never retried, even on a 5xx that may have taken effect', async () => {
  const writes = [
    ['gh', 'pr', 'merge', '7', '--auto', '--merge'],
    ['gh', 'pr', 'comment', '7', '--body', 'x'],
    ['gh', 'workflow', 'run', 'auto-merge.yml', '-f', 'pr=7'],
    ['gh', 'label', 'create', 'kind/fix'],
    ['gh', 'api', '--method', 'DELETE', 'repos/eggdev/clutch/issues/7/labels/a'],
    ['gh', 'api', '-X', 'POST', 'repos/eggdev/clutch/issues/7/labels'],
    ['gh', 'api', 'repos/eggdev/clutch/issues/7/labels', '-f', 'labels[]=a'],
    ['git', 'push', 'origin', 'clutch/cl-1-x'],
  ];
  for (const command of writes) {
    const gh = sequence([unavailable, { ok: true }]);
    const clock = fakeClock();
    const result = await withRetry(gh.run, clock)(command);
    expect(result.ok).toBe(false);
    expect(gh.calls).toHaveLength(1);
    expect(clock.slept).toBe(0);
  }
});

test('three transient failures fail with the last error', async () => {
  const gh = sequence([
    { ok: false, err: 'HTTP 502: Bad Gateway' },
    { ok: false, err: 'read: connection reset by peer' },
    unavailable,
    { ok: true, out: 'never reached' },
  ]);
  const clock = fakeClock();
  const result = await withRetry(gh.run, clock)(['gh', 'pr', 'list', '--state', 'open']);
  expect(result).toMatchObject({ ok: false, err: unavailable.err });
  expect(gh.calls).toHaveLength(3);
  expect(clock.slept).toBe(7000);
});

test('the transient patterns are the 5xx, no server, timeout and connection reset', () => {
  const transient = [
    'HTTP 500: Internal Server Error',
    'HTTP 502: Bad Gateway',
    'HTTP 503: No server is currently available',
    'Get "https://api.github.com": net/http: request canceled (Client.Timeout exceeded)',
    'read tcp: connection reset by peer',
  ];
  for (const err of transient) {
    expect(isTransient({ ok: false, out: '', err })).toBe(true);
  }
  expect(isTransient({ ok: false, out: '', err: 'HTTP 404: Not Found' })).toBe(false);
  expect(isTransient({ ok: false, out: '', err: 'HTTP 422: Validation Failed' })).toBe(false);
});

test('a read is a gh command that writes nothing', () => {
  const reads = [
    ['gh', 'api', 'repos/eggdev/clutch/pulls/7/files'],
    ['gh', 'api', '--method', 'GET', 'repos/eggdev/clutch'],
    ['gh', 'api', '-XGET', 'repos/eggdev/clutch'],
    ['gh', 'api', '--paginate', 'repos/eggdev/clutch/commits/a/check-runs?per_page=100'],
    ['gh', 'pr', 'view', '7', '--json', 'state'],
    ['gh', 'pr', 'list', '--state', 'open'],
    ['gh', 'repo', 'view', '--json', 'nameWithOwner'],
    ['gh', 'run', 'list', '--workflow', 'auto-merge.yml'],
    ['gh', 'run', 'view', '12'],
  ];
  for (const command of reads) {
    expect(isRead(command)).toBe(true);
  }
  const writes = [
    ['gh', 'api', '--method', 'PATCH', 'repos/eggdev/clutch'],
    ['gh', 'api', '-X', 'DELETE', 'repos/eggdev/clutch/issues/7/labels/a'],
    ['gh', 'api', '--method=POST', 'repos/eggdev/clutch'],
    ['gh', 'api', '-XPOST', 'repos/eggdev/clutch'],
    ['gh', 'api', 'repos/eggdev/clutch/issues/7/labels', '-f', 'labels[]=a'],
    ['gh', 'api', 'repos/eggdev/clutch', '-F', 'number=7'],
    ['gh', 'api', 'graphql', '--field', 'query=mutation{}'],
    ['gh', 'api', 'repos/eggdev/clutch', '--input', '-'],
    ['gh', 'pr', 'merge', '7'],
    ['gh', 'pr', 'comment', '7', '--body', 'x'],
    ['gh', 'label', 'create', 'kind/fix'],
    ['gh', 'workflow', 'run', 'auto-merge.yml'],
    ['git', 'fetch', 'origin'],
    ['bun', 'tools/clutch.ts', 'risk'],
  ];
  for (const command of writes) {
    expect(isRead(command)).toBe(false);
  }
});

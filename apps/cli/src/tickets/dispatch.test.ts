import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { gitRepo } from '@/testing/git-repo';

const main = path.join(import.meta.dir, '..', 'main.ts');

const config =
  'schemaVersion: 1\nproject: shop\ntemplate:\n  repo: eggdev/clutch\n  mode: sync\ncapabilities: {}\ntickets:\n  prefix: SH\n';

/** A phase file with the limits and the phase entries of one test. */
const phaseFile = (limits: string, phases: string) =>
  `schemaVersion: 1\nlimits: ${limits}\nwork_thread: { provider: claudeAgent, model: opus }\nphases:\n${phases}`;

const triageOwn =
  '  - { id: triage, thread: own, provider: claudeAgent, model: haiku, prompt: Triage. }\n';

const fakeT3 = (log: string) => `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (process.env.FAKE_T3_FAIL) { console.error('The T3 Code server is not running.'); process.exit(1); }
const count = fs.readFileSync(${JSON.stringify(log)}, 'utf-8').trim().split('\\n').length;
if (args[1] === 'start') console.log(JSON.stringify({ threadId: 'thread-' + count, projectId: 'p', runId: 'r' }));
if (args[1] === 'show') console.log(JSON.stringify({ thread: { threadId: args[3], worktreePath: process.env.FAKE_WORKTREE ?? null }, messages: [] }));
if (args[1] === 'send') console.log(JSON.stringify({ delivery: 'queued' }));
`;

type Row = { phase: string; status: string; thread: string | null; blockedReason: string | null };
type Output = {
  status?: string;
  message?: string;
  ticket: { id: string; phases: Array<Row>; links: Array<{ kind: string; value: string }> };
  event: { data: Row } | null;
  dispatch: Array<{ kind: string; reason?: string }>;
};

/** The JSON lines of a file. Empty when it does not exist. */
async function jsonLines<T>(file: string) {
  const text = await readFile(file, 'utf-8').catch(() => '');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

/** A project with a phase file, a fake `t3` on the PATH and its own state and home folders. */
async function project(phases: string, files: Record<string, string> = {}) {
  const repo = await gitRepo({ 'clutch.yaml': config, '.clutch/phases.yaml': phases, ...files });
  const folder = await mkdtemp(path.join(tmpdir(), 'dispatch-'));
  const log = path.join(folder, 't3-calls.jsonl');
  await mkdir(path.join(folder, 'bin'));
  await mkdir(path.join(folder, 'home'));
  await writeFile(path.join(folder, 'bin', 't3'), fakeT3(log));
  await chmod(path.join(folder, 'bin', 't3'), 0o755);
  const env = {
    ...process.env,
    PATH: `${path.join(folder, 'bin')}:${process.env.PATH}`,
    XDG_STATE_HOME: path.join(folder, 'state'),
    HOME: path.join(folder, 'home'),
    FAKE_WORKTREE: repo.root,
  };
  return {
    root: repo.root,
    async tickets(args: Array<string>, extra: Record<string, string> = {}) {
      const proc = Bun.spawn([process.execPath, main, 'tickets', ...args], {
        cwd: repo.root,
        env: { ...env, ...extra },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      return { code, json: JSON.parse(stdout) as Output };
    },
    calls: () => jsonLines<Array<string>>(log),
    log: () =>
      jsonLines<Record<string, string>>(
        path.join(folder, 'state', 'clutch', 'shop', 'dispatch.jsonl'),
      ),
    [Symbol.asyncDispose]: async () => {
      await repo[Symbol.asyncDispose]();
      await rm(folder, { recursive: true, force: true });
    },
  };
}

type Project = Awaited<ReturnType<typeof project>>;

const requirements = '--now a --expected b --location c --acceptance d --major no'.split(' ');

/** Adds a held ticket with a route of `phases`, then releases it and finishes triage. */
async function routed(shop: Project, title: string, phases: string) {
  const { json } = await shop.tickets(['add', title, '--description', 'x', '--hold']);
  const { id } = json.ticket;
  await shop.tickets(['edit', id, ...requirements]);
  await shop.tickets(['route', id, '--phases', phases, '--reason', 'Clear.']);
  await shop.tickets(['release', id]);
  return { id, done: await shop.tickets(['phase', id, 'triage', 'done']) };
}

const status = (output: { json: Output }, phase: string) =>
  output.json.ticket.phases.find((row) => row.phase === phase);

test('tickets add starts one thread, and a second dispatch starts none', async () => {
  await using shop = await project(phaseFile('{ threads: 6, device: 2 }', triageOwn));
  const added = await shop.tickets(['add', 'Fix the login', '--description', 'It breaks.']);
  expect(added.code).toBe(0);
  expect(status(added, 'triage')).toMatchObject({ status: 'in_progress', thread: 'thread-1' });
  const calls = await shop.calls();
  expect(calls).toHaveLength(1);
  expect(calls[0].slice(0, 9)).toEqual([
    'thread',
    'start',
    '--json',
    '--title',
    'SH-1000 triage: Fix the login',
    '--provider',
    'claudeAgent',
    '--model',
    'haiku',
  ]);
  expect(calls[0].at(-1)).toContain('clutch tickets phase SH-1000 triage done');
  expect(await shop.tickets(['dispatch'])).toMatchObject({ code: 0, json: { dispatch: [] } });
  expect(await shop.calls()).toHaveLength(1);
});

test('with limits.threads 1, the second work phase starts after the first ticket is done', async () => {
  const build = '  - { id: build, thread: work, prompt: Build., skills: [deliver] }\n';
  await using shop = await project(phaseFile('{ threads: 1, device: 2 }', build));
  const first = await routed(shop, 'First', 'build');
  expect(status(first.done, 'build')).toMatchObject({ status: 'in_progress', thread: 'thread-1' });
  expect(first.done.json.ticket.links).toEqual([
    { kind: 'branch', value: 'clutch/sh-1000-first' },
    { kind: 'worktree', value: shop.root },
  ]);
  const calls = await shop.calls();
  expect(calls[0]).toContain('--worktree');
  expect(calls[0].slice(-4, -1)).toEqual(['--branch', 'clutch/sh-1000-first', shop.root]);
  expect(calls[1]).toEqual(['thread', 'show', '--json', 'thread-1']);

  const second = await routed(shop, 'Second', 'build');
  expect(status(second.done, 'build')?.status).toBe('ready');
  expect(second.done.json.dispatch).toMatchObject([
    { kind: 'skip', reason: 'limits.threads is 1.' },
  ]);

  const done = await shop.tickets(['phase', first.id, 'build', 'done']);
  expect(done.json.dispatch).toMatchObject([{ kind: 'start' }]);
  const shown = await shop.tickets(['show', second.id]);
  expect(status(shown, 'build')?.status).toBe('in_progress');
  // Triage has no entry, so each release logs a skip for it too.
  const log = await shop.log();
  expect(log.map((line) => `${line.ticket} ${line.phase} ${line.kind}`)).toEqual([
    'SH-1000 triage skip',
    'SH-1000 build start',
    'SH-1001 triage skip',
    'SH-1001 build skip',
    'SH-1001 build start',
  ]);
});

test('with limits.device 2, a third phase that needs a device stays ready', async () => {
  const triage = '  - { id: triage, thread: own, prompt: Triage., needs: [device] }\n';
  await using shop = await project(phaseFile('{ threads: 6, device: 2 }', triage));
  for (const title of ['One', 'Two']) {
    const added = await shop.tickets(['add', title, '--description', 'x']);
    expect(status(added, 'triage')?.status).toBe('in_progress');
  }
  const third = await shop.tickets(['add', 'Three', '--description', 'x']);
  expect(status(third, 'triage')?.status).toBe('ready');
  expect(third.json.dispatch).toMatchObject([{ kind: 'skip', reason: 'limits.device is 2.' }]);
  expect(await shop.calls()).toHaveLength(2);
});

test('the second work phase sends its prompt to the work thread, and a status prompt follows the status', async () => {
  const phases = [
    '  - { id: build, thread: work, prompt: Build., check: "true" }',
    '  - id: review',
    '    thread: work',
    '    prompt: Review.',
    '    statuses: { blocked: { prompt: Ask the owner. } }',
    '',
  ].join('\n');
  await using shop = await project(phaseFile('{ threads: 6, device: 2 }', phases));
  const { id } = await routed(shop, 'Fix', 'build,review');
  const built = await shop.tickets(['phase', id, 'build', 'done']);
  expect(built.code).toBe(0);
  const blocked = await shop.tickets(['phase', id, 'review', 'blocked', '--reason', 'Which?']);
  expect(status(blocked, 'review')).toMatchObject({ status: 'blocked', thread: 'thread-1' });
  const calls = await shop.calls();
  expect(calls.map((call) => call.slice(0, 3))).toEqual([
    ['thread', 'start', '--json'],
    ['thread', 'show', '--json'],
    ['thread', 'send', 'thread-1'],
    ['thread', 'send', 'thread-1'],
  ]);
  expect(calls[2].at(-1)).toStartWith('Review.');
  expect(calls[3].at(-1)).toStartWith('Ask the owner.');
});

test('done exits 1 and keeps the status when the check fails or the owner has not approved', async () => {
  const phases = [
    '  - { id: build, thread: work, prompt: Build., check: "test -f ok || { echo broken; exit 1; }" }',
    '  - { id: review, thread: work, prompt: Review., advance: owner }',
    '',
  ].join('\n');
  await using shop = await project(phaseFile('{ threads: 6, device: 2 }', phases));
  const { id } = await routed(shop, 'Fix', 'build,review');
  const refused = await shop.tickets(['phase', id, 'build', 'done']);
  expect(refused).toMatchObject({ code: 1, json: { status: 'error' } });
  expect(refused.json.message).toContain('broken');
  expect(status(await shop.tickets(['show', id]), 'build')?.status).toBe('in_progress');

  // The check runs in the worktree that the thread reported.
  await writeFile(path.join(shop.root, 'ok'), '');
  const built = await shop.tickets(['phase', id, 'build', 'done']);
  expect(status(built, 'review')?.status).toBe('in_progress');
  const unapproved = await shop.tickets(['phase', id, 'review', 'done']);
  expect(unapproved).toMatchObject({ code: 1 });
  expect(unapproved.json.message).toContain('--approved-by owner');
  const quote = ['--approved-by', 'owner', '--quote', 'Ship it.'];
  const approved = await shop.tickets(['phase', id, 'review', 'done', ...quote]);
  expect(approved).toMatchObject({ code: 0 });
  expect(approved.json.event?.data.blockedReason).toBe('Approved by owner: "Ship it."');
});

test('when t3 fails, the phase is ready again and the log has one line with the error', async () => {
  await using shop = await project(phaseFile('{ threads: 6, device: 2 }', triageOwn));
  const added = await shop.tickets(['add', 'Fix', '--description', 'x'], { FAKE_T3_FAIL: '1' });
  expect(added.code).toBe(0);
  expect(status(added, 'triage')).toMatchObject({ status: 'ready', thread: null });
  expect(status(added, 'triage')?.blockedReason).toContain('The T3 Code server is not running.');
  const log = await shop.log();
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ kind: 'fail', ticket: 'SH-1000', phase: 'triage' });
  expect(log[0].error).toContain('The T3 Code server is not running.');
  await shop.tickets(['dispatch']);
  expect(status(await shop.tickets(['show', 'SH-1000']), 'triage')?.status).toBe('in_progress');
});

test('a ready phase with no entry stays ready, and phases --check names a skill that is not installed', async () => {
  const build = '  - { id: build, thread: work, prompt: Build., skills: [deliver, nowhere] }\n';
  await using shop = await project(phaseFile('{ threads: 6, device: 2 }', build), {
    '.agents/skills/deliver/SKILL.md': '# Deliver\n',
  });
  const added = await shop.tickets(['add', 'Fix', '--description', 'x']);
  expect(status(added, 'triage')?.status).toBe('ready');
  expect(added.json.dispatch).toMatchObject([
    { kind: 'skip', reason: 'The phase file has no entry.' },
  ]);
  expect(await shop.calls()).toEqual([]);
  expect(await shop.tickets(['phases', '--check'])).toMatchObject({
    code: 1,
    json: { message: 'The skill nowhere is not installed.' },
  });
});

test('phases --check exits 1 on an unknown key or phase, and 0 on a valid file', async () => {
  const bad = '  - { id: lint, thread: work, prompt: Lint., colour: red }\n';
  await using shop = await project(phaseFile('{ threads: 6, device: 2 }', bad));
  const checked = await shop.tickets(['phases', '--check']);
  expect(checked.code).toBe(1);
  expect(checked.json.message).toContain('phases[0].id has a value that is not allowed.');
  expect(checked.json.message).toContain('phases[0] has an unknown key: colour.');
  await writeFile(
    path.join(shop.root, '.clutch', 'phases.yaml'),
    phaseFile('{ threads: 6, device: 2 }', triageOwn),
  );
  expect(await shop.tickets(['phases', '--check'])).toMatchObject({ code: 0 });
});

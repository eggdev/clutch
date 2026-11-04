import { afterEach, expect, test } from 'bun:test';
import { chmod, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { agentEnv, limits, readAgentOutput } from '@/bench/harness';
import type { ClaudeSummary } from '@/bench/harness';
import { renderResult } from '@/bench/report';
import { runPair } from '@/bench/run';
import type { Suite } from '@/bench/suite';
import { gitOrThrow } from '@/git';
import { gitRepo } from '@/testing/git-repo';

const main = path.join(import.meta.dir, '..', 'main.ts');
const summary = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 4,
} satisfies ClaudeSummary);

/**
 * A stand-in `claude` in its own folder. It keeps its prompt, arguments,
 * folder, remotes, history and API key in `seen/`, then runs `body`.
 */
async function fakeClaude(body: string) {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'bench-bin-')));
  const seen = path.join(dir, 'seen');
  const script = [
    '#!/bin/sh',
    `n=$(date +%s%N); mkdir -p ${seen}/$n`,
    `cat > ${seen}/$n/prompt`,
    `echo "$@" > ${seen}/$n/args`,
    `pwd > ${seen}/$n/cwd`,
    `git remote > ${seen}/$n/remotes`,
    `git log --all --oneline | wc -l | tr -d ' ' > ${seen}/$n/commits`,
    `echo "\${ANTHROPIC_API_KEY:-none}" > ${seen}/$n/key`,
    body,
  ].join('\n');
  await writeFile(path.join(dir, 'claude'), `${script}\n`);
  await chmod(path.join(dir, 'claude'), 0o755);
  return {
    dir,
    /** Each call's files, in the order of the calls. */
    calls: async () => {
      const names = await readdir(seen).catch(() => []);
      const read = (name: string, file: string) =>
        readFile(path.join(seen, name, file), 'utf-8').then((text) => text.trim());
      return Promise.all(
        names.toSorted().map(async (name) => ({
          prompt: await read(name, 'prompt'),
          args: await read(name, 'args'),
          cwd: await read(name, 'cwd'),
          remotes: await read(name, 'remotes'),
          commits: await read(name, 'commits'),
          key: await read(name, 'key'),
        })),
      );
    },
    [Symbol.asyncDispose]: () => rm(dir, { recursive: true, force: true }),
  };
}

const exists = (file: string) => Bun.file(path.join(file, '.git', 'HEAD')).exists();

const models =
  'models:\n  - id: big\n    harness: claude\n  - id: small\n    harness: claude\n  - id: local\n    harness: qwen\n';
const runner =
  'description: A box.\nmachine: box\nt3_environment: local\nworkspace: worktree\nsetup:\n  - touch .setup-ran\n';
const agent =
  '---\nrole: implement\ndescription: Builds.\nharness: claude\nmodel: big\nrunner: box\n---\n\nDo the work.\n';
const issue = '# CL-001: Write the answer\n\nWrite answer.txt.\n';

function benchmark(commit: string, configs = ['big', 'small']) {
  const items = configs.map((model) => `  - name: ${model}\n    model: ${model}\n`).join('');
  return [
    '---',
    'description: Compares models.',
    'agent: implement',
    `configs:\n${items.trimEnd()}`,
    'tasks:',
    '  - name: alpha',
    `    commit: ${commit}`,
    '    issue: .clutch/issues/CL-001.md',
    '    check: test -f answer.txt && test -f .setup-ran',
    '  - name: beta',
    `    commit: ${commit}`,
    '    issue: .clutch/issues/CL-001.md',
    '    check: test -d "$CLUTCH_BENCH_REPO/.git" && grep -q big answer.txt',
    '---',
    '',
    'What it measures.',
    '',
  ].join('\n');
}

/** A repo with a factory tree and an issue, and a `demo` suite pinned to its first commit. */
async function project(configs?: Array<string>) {
  const repo = await gitRepo({
    'factory/models.yaml': models,
    'factory/runners/box.yaml': runner,
    'factory/agents/implement/agent.md': agent,
    '.clutch/issues/CL-001.md': issue,
  });
  const commit = await gitOrThrow(repo.root, 'rev-parse', 'HEAD');
  await repo.write({ 'factory/benchmarks/demo/benchmark.md': benchmark(commit, configs) });
  return { repo, commit };
}

/** Runs `clutch bench` in `cwd`. Its logs and clones go in the repo's parent folder, which the test removes. */
async function clutch(cwd: string, bin: string, ...args: Array<string>) {
  const proc = Bun.spawn([process.execPath, main, 'bench', ...args], {
    cwd,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TMPDIR: path.dirname(cwd),
      ANTHROPIC_API_KEY: 'secret',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

test('a whole run grades each pair, writes the result and removes each clone', async () => {
  const { repo, commit } = await project();
  await using _ = repo;
  await using fake = await fakeClaude(
    `model=$(echo "$@" | sed 's/.*--model \\([a-z]*\\).*/\\1/'); echo "$model" > answer.txt; echo '${summary}'`,
  );
  const run = await clutch(repo.root, fake.dir, 'demo');
  expect(run.stderr).toBe('');
  expect(run.code).toBe(0);
  const head = await gitOrThrow(repo.root, 'rev-parse', 'HEAD');
  const folder = path.join(repo.root, 'factory/benchmarks/demo/results');
  const [name] = await readdir(folder);
  expect(name).toMatch(new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${head.slice(0, 7)}\\.json$`, 'u'));
  const result = JSON.parse(await readFile(path.join(folder, name), 'utf-8'));
  expect(result).toMatchObject({ benchmark: 'demo', commit: head, agent: 'implement', limits });
  const pairs = result.runs.map(
    (pair: Record<string, unknown>) => `${pair.task} ${pair.config} ${pair.pass} ${pair.exit}`,
  );
  expect(pairs).toEqual([
    'alpha big true done',
    'alpha small true done',
    'beta big true done',
    'beta small false done',
  ]);
  expect(result.runs[0]).toMatchObject({ model: 'big', lines: 1, files: 2, turns: 4 });
  expect(run.stdout).toContain('Task   Config  Result  Exit  Time  Lines  Turns');
  expect(run.stdout).toContain('small   small  1/2');
  expect(run.stdout).toContain('Wrote factory/benchmarks/demo/results/');

  const calls = await fake.calls();
  expect(calls).toHaveLength(4);
  for (const call of calls) {
    expect(call.args).toStartWith('--print --model ');
    expect(call.args).toContain(`--max-turns ${limits.turns}`);
    expect(call.prompt).toStartWith('Do the work.');
    expect(call.prompt).toContain(`a scratch clone of commit ${commit}`);
    expect(call.prompt).toEndWith(issue.trim());
    expect({ remotes: call.remotes, commits: call.commits, key: call.key }).toEqual({
      remotes: '',
      commits: '1',
      key: 'none',
    });
    expect(await exists(call.cwd)).toBe(false);
  }

  expect(await clutch(repo.root, fake.dir, 'demo')).toMatchObject({ code: 0 });
  const both = await readdir(folder);
  expect(both.toSorted()).toEqual([name.replace('.json', '-2.json'), name]);
});

test('--task and --config run some pairs and write no result', async () => {
  const { repo } = await project();
  await using _ = repo;
  await using fake = await fakeClaude(`echo big > answer.txt; echo '${summary}'`);
  const run = await clutch(repo.root, fake.dir, 'demo', '--task', 'beta', '--config', 'small');
  expect(run.code).toBe(0);
  expect(run.stdout).toContain('beta with small: pass (done');
  expect(run.stdout).toContain('A run with --config or --task writes no result file.');
  expect(await fake.calls()).toHaveLength(1);
  const results = await readdir(path.join(repo.root, 'factory/benchmarks/demo')).then((items) =>
    items.includes('results'),
  );
  expect(results).toBe(false);
  const json = await clutch(repo.root, fake.dir, 'demo', '--task', 'alpha', '--json');
  expect(JSON.parse(json.stdout).runs).toHaveLength(2);
});

test('a wrong name, a wrong flag value or a harness bench cannot run is an error', async () => {
  const { repo, commit } = await project();
  await using _ = repo;
  await using fake = await fakeClaude(`echo '${summary}'`);
  expect(await clutch(repo.root, fake.dir, 'nope')).toMatchObject({
    code: 1,
    stderr: expect.stringContaining('No benchmarks/nope/benchmark.md. The suites: demo.'),
  });
  expect(await clutch(repo.root, fake.dir, 'demo', '--config', 'huge')).toMatchObject({
    code: 1,
    stderr: expect.stringContaining('No config named huge. Pass --config with one of: big, small.'),
  });
  await repo.write({
    'factory/benchmarks/demo/benchmark.md': benchmark(commit, ['big', 'local']),
  });
  expect(await clutch(repo.root, fake.dir, 'demo')).toMatchObject({
    code: 1,
    stderr: expect.stringContaining('clutch bench runs only claude models today.'),
  });
  await repo.write({ 'factory/benchmarks/demo/benchmark.md': benchmark(commit, ['big']) });
  expect(await clutch(repo.root, fake.dir, 'demo')).toMatchObject({
    code: 1,
    stderr: expect.stringContaining('The factory tree has problems.'),
  });
  expect(await fake.calls()).toEqual([]);
});

const saved = { ...limits };
const savedPath = process.env.PATH;
afterEach(() => {
  Object.assign(limits, saved);
  process.env.PATH = savedPath;
});

async function runOne(body: string, setup = ['touch .setup-ran']) {
  const { repo, commit } = await project();
  const fake = await fakeClaude(body);
  process.env.PATH = `${fake.dir}:${savedPath}`;
  const suite: Suite = {
    name: 'demo',
    agent: 'implement',
    prompt: 'Do the work.',
    setup,
    configs: [{ name: 'big', model: 'big', harness: 'claude' }],
    tasks: [{ name: 'alpha', commit, issue: '.clutch/issues/CL-001.md', check: 'true' }],
  };
  const log = path.join(repo.parent, 'run.log');
  const result = await runPair(repo.root, suite, suite.tasks[0], suite.configs[0], log);
  const calls = await fake.calls();
  await fake[Symbol.asyncDispose]();
  await repo[Symbol.asyncDispose]();
  return { result, calls };
}

test('a timeout stops the agent and each process it started, and removes the clone', async () => {
  limits.minutes = 0.02;
  const { result, calls } = await runOne('sleep 60 & echo $! > child.pid; wait');
  expect(result).toMatchObject({ exit: 'timeout', pass: true, lines: 1 });
  expect(await exists(calls[0].cwd)).toBe(false);
});

test('a failed agent and a failed setup are exits, and both remove the clone', async () => {
  const failed = await runOne('echo broken >&2; exit 3');
  expect(failed.result).toMatchObject({ exit: 'error', pass: true, lines: 0 });
  expect(await exists(failed.calls[0].cwd)).toBe(false);
  const setup = await runOne(`echo '${summary}'`, ['false']);
  expect(setup.result).toMatchObject({ exit: 'setup', pass: false, seconds: 0 });
  expect(setup.calls).toEqual([]);
});

test('the summary line gives the exit and the turns', () => {
  expect(readAgentOutput(0, false, `log\n${summary}\n`)).toEqual({ exit: 'done', turns: 4 });
  const maxed = JSON.stringify({
    type: 'result',
    subtype: 'error_max_turns',
    is_error: true,
    num_turns: 80,
  } satisfies ClaudeSummary);
  expect(readAgentOutput(1, false, maxed)).toEqual({ exit: 'turns', turns: 80 });
  expect(readAgentOutput(0, true, '')).toEqual({ exit: 'timeout', turns: undefined });
  expect(readAgentOutput(1, false, 'not json')).toEqual({ exit: 'error', turns: undefined });
});

test('an agent gets no API key and no setting of the session that starts it', () => {
  expect(
    agentEnv({
      PATH: '/bin',
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_AUTH_TOKEN: 't',
      CLAUDECODE: '1',
      CLAUDE_EFFORT: 'low',
      CLAUDE_CODE_SESSION_ID: 's',
      CLAUDE_CONFIG_DIR: '/home/me/.claude',
      AI_AGENT: 'claude',
    }),
  ).toEqual({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/home/me/.claude' });
});

test('the report shows each pair, then each config', () => {
  const run = { model: 'big', exit: 'done' as const, files: 1 };
  const text = renderResult({
    benchmark: 'demo',
    date: '2026-11-05T00:00:00.000Z',
    commit: 'abc1234',
    agent: 'implement',
    limits,
    runs: [
      { ...run, task: 'alpha', config: 'big', pass: true, seconds: 75, lines: 12, turns: 9 },
      { ...run, task: 'beta', config: 'big', pass: false, seconds: 5, lines: 0 },
    ],
  });
  expect(text).toBe(
    [
      'Task   Config  Result  Exit  Time   Lines  Turns',
      'alpha  big     pass    done  1m15s  12     9',
      'beta   big     fail    done  5s     0      -',
      '',
      'Config  Model  Passed  Time   Lines',
      'big     big    1/2     1m20s  12',
    ].join('\n'),
  );
});

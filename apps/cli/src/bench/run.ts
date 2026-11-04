import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { agentCommand, agentEnv, limits, readAgentOutput } from '@/bench/harness';
import type { Exit } from '@/bench/harness';
import type { BenchConfig, BenchTask, Suite } from '@/bench/suite';
import { git, gitOrThrow } from '@/git';

/** The outcome of one task with one config. */
export type PairResult = {
  task: string;
  config: string;
  model: string;
  pass: boolean;
  exit: Exit;
  seconds: number;
  lines: number;
  files: number;
  turns?: number;
};

/** The scratch checkouts that exist now, so a signal handler can remove them. */
export const liveCheckouts = new Set<string>();

type Exec = { code: number; timedOut: boolean; stdout: string };

/**
 * Runs `command` in its own process group, and kills the whole group after
 * `minutes`, so no child of an agent outlives the run. Output goes to `log`.
 */
function exec(
  command: Array<string>,
  options: { cwd: string; env: Record<string, string>; input?: string; minutes: number },
  log: WriteStream,
) {
  return new Promise<Exec>((resolve, reject) => {
    const [file, ...args] = command;
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let timedOut = false;
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      log.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => log.write(chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-(child.pid ?? 0), 'SIGKILL');
      } catch {
        // The group has already ended.
      }
    }, options.minutes * 60_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, timedOut, stdout });
    });
    child.stdin.end(options.input ?? '');
  });
}

const shell = (command: string) => ['sh', '-c', command];

/** The prompt of a run: the agent's prompt, the rules of a benchmark run, then the issue. */
function benchPrompt(agentPrompt: string, task: BenchTask, issue: string) {
  return [
    agentPrompt,
    '---',
    '# Benchmark run',
    `This run builds the issue below in a scratch clone of commit ${task.commit}. The clone has no remote, and a check grades its files after you stop.`,
    [
      '- Build the issue in this checkout. Keep each change in the working tree. You can commit, but do not push.',
      '- Skip each step that needs GitHub or the network: a branch, a push, a pull request, `bun run pr` and `gh`.',
      '- Run the tests that the issue names before you stop.',
    ].join('\n'),
    `## The issue: ${task.issue}`,
    issue.trim(),
  ].join('\n\n');
}

/**
 * Clones `commit` alone from `repo` into the empty folder `dir`, so the run
 * sees no later history and no remote. Returns git's message when a step fails.
 */
async function cloneInto(dir: string, repo: string, commit: string) {
  const steps = [
    ['init', '--quiet', '--initial-branch=bench'],
    ['config', 'user.name', 'clutch bench'],
    ['config', 'user.email', 'bench@clutch.invalid'],
    ['config', 'commit.gpgsign', 'false'],
    ['fetch', '--quiet', '--depth', '1', repo, commit],
    ['checkout', '--quiet', '--detach', 'FETCH_HEAD'],
  ];
  for (const step of steps) {
    const result = await git(dir, ...step);
    if (!result.ok) {
      return `git ${step.join(' ')} failed: ${result.err}\n`;
    }
  }
  return '';
}

/** The lines and files that differ from `commit`, with new files. */
async function changed(dir: string, commit: string) {
  await gitOrThrow(dir, 'add', '--all');
  const numstat = await git(dir, 'diff', '--cached', '--numstat', commit);
  const rows = numstat.out ? numstat.out.split('\n') : [];
  let lines = 0;
  for (const row of rows) {
    const [added, deleted] = row.split('\t');
    lines += (Number(added) || 0) + (Number(deleted) || 0);
  }
  return { lines, files: rows.length };
}

/**
 * Runs one task with one config: clone the commit, run the runner's setup,
 * run the agent with the issue, count the changed lines, run the check.
 * The clone is removed at the end, also after a failure.
 */
export async function runPair(
  repo: string,
  suite: Suite,
  task: BenchTask,
  config: BenchConfig,
  logFile: string,
): Promise<PairResult> {
  const command = agentCommand(config.harness, config.model);
  const log = createWriteStream(logFile);
  const env = agentEnv(process.env);
  const base = { task: task.name, config: config.name, model: config.model };
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'clutch-bench-')));
  liveCheckouts.add(dir);
  try {
    const cloneError = await cloneInto(dir, repo, task.commit);
    log.write(cloneError);
    const issue = cloneError
      ? null
      : await readFile(path.join(dir, task.issue), 'utf-8').catch(() => null);
    let setupOk = issue !== null;
    log.write(setupOk || cloneError ? '' : `No ${task.issue} at ${task.commit}.\n`);
    for (const step of setupOk ? suite.setup : []) {
      log.write(`$ ${step}\n`);
      const result = await exec(shell(step), { cwd: dir, env, minutes: limits.checkMinutes }, log);
      if (result.code !== 0 || result.timedOut) {
        setupOk = false;
        break;
      }
    }
    if (!setupOk || issue === null) {
      return { ...base, pass: false, exit: 'setup', seconds: 0, lines: 0, files: 0 };
    }
    log.write(`$ ${command.join(' ')}\n`);
    const started = performance.now();
    const input = benchPrompt(suite.prompt, task, issue);
    const agent = await exec(command, { cwd: dir, env, input, minutes: limits.minutes }, log);
    const seconds = Math.round((performance.now() - started) / 1000);
    const { exit, turns } = readAgentOutput(agent.code, agent.timedOut, agent.stdout);
    const diff = await changed(dir, task.commit);
    log.write(`\n$ ${task.check}\n`);
    const check = await exec(
      shell(task.check),
      { cwd: dir, env: { ...env, CLUTCH_BENCH_REPO: repo }, minutes: limits.checkMinutes },
      log,
    );
    const pass = check.code === 0 && !check.timedOut;
    return { ...base, pass, exit, seconds, ...diff, ...(turns === undefined ? {} : { turns }) };
  } finally {
    await new Promise((resolve) => {
      log.end(resolve);
    });
    await rm(dir, { recursive: true, force: true });
    liveCheckouts.delete(dir);
  }
}

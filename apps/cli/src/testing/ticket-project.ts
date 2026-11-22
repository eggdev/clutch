import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { gitRepo } from '@/testing/git-repo';

/**
 * A project for the tests of `clutch tickets`: a git repo with a phase file,
 * a fake `t3` and a fake `gh` on the PATH, and its own state and home folders.
 */

export const main = path.join(import.meta.dir, '..', 'main.ts');

const config =
  'schemaVersion: 1\nproject: shop\ntemplate:\n  repo: eggdev/clutch\n  mode: sync\ncapabilities: {}\ntickets:\n  prefix: SH\n';

/** A phase file with the limits and the phase entries of one test. */
export const phaseFile = (limits: string, phases: string) =>
  `schemaVersion: 1\nlimits: ${limits}\nwork_thread: { provider: claudeAgent, model: opus }\nphases:\n${phases}`;

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

/** A fake `gh` that prints the state of each pull request: FAKE_GH_STATE, or OPEN. */
const fakeGh = `#!${process.execPath}
console.log(process.env.FAKE_GH_STATE ?? 'OPEN');
`;

type Row = { phase: string; status: string; thread: string | null; blockedReason: string | null };
type Output = {
  status?: string;
  message?: string;
  ticket: {
    id: string;
    holdReason: string | null;
    route: Array<string>;
    phases: Array<Row>;
    links: Array<{ kind: string; value: string }>;
  };
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
export async function project(phases: string, files: Record<string, string> = {}) {
  const repo = await gitRepo({ 'clutch.yaml': config, '.clutch/phases.yaml': phases, ...files });
  const folder = await mkdtemp(path.join(tmpdir(), 'dispatch-'));
  const log = path.join(folder, 't3-calls.jsonl');
  await mkdir(path.join(folder, 'bin'));
  await mkdir(path.join(folder, 'home'));
  await writeFile(path.join(folder, 'bin', 't3'), fakeT3(log));
  await writeFile(path.join(folder, 'bin', 'gh'), fakeGh);
  await chmod(path.join(folder, 'bin', 't3'), 0o755);
  await chmod(path.join(folder, 'bin', 'gh'), 0o755);
  const env = {
    ...process.env,
    PATH: `${path.join(folder, 'bin')}:${process.env.PATH}`,
    XDG_STATE_HOME: path.join(folder, 'state'),
    HOME: path.join(folder, 'home'),
    FAKE_WORKTREE: repo.root,
  };
  return {
    root: repo.root,
    home: path.join(folder, 'home'),
    async tickets(args: Array<string>, extra: Record<string, string> = {}, cwd = repo.root) {
      const proc = Bun.spawn([process.execPath, main, 'tickets', ...args], {
        cwd,
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

export type Project = Awaited<ReturnType<typeof project>>;

export const requirements = '--now a --expected b --location c --acceptance d --major no'.split(
  ' ',
);

/** Adds a held ticket with a route of `phases`, then releases it and finishes triage. */
export async function routed(shop: Project, title: string, phases: string, env = {}) {
  const { json } = await shop.tickets(['add', title, '--description', 'x', '--hold']);
  const { id } = json.ticket;
  await shop.tickets(['edit', id, ...requirements]);
  await shop.tickets(['route', id, '--phases', phases, '--reason', 'Clear.']);
  await shop.tickets(['release', id]);
  return { id, done: await shop.tickets(['phase', id, 'triage', 'done'], env) };
}

export const status = (output: { json: Output }, phase: string) =>
  output.json.ticket.phases.find((row) => row.phase === phase);

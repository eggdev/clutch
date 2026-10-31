import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { git, gitOrThrow } from '@/git';
import { issuesCommand } from '@/issues-command';
import { gitBackend } from '@/worktree/git-backend';
import { formatWorktrees, listWorktrees } from '@/worktree/list';
import type { FindPr } from '@/worktree/list';
import { newWorktree } from '@/worktree/new';
import type { NewWorktreeSteps } from '@/worktree/new';
import { removeWorktree } from '@/worktree/remove';
import { worktreeSettings } from '@/worktree/settings';

/**
 * The main checkout of the repository that holds `cwd`. From inside a task
 * checkout, it is still the main one, so the settings and the worktree root
 * stay the same.
 */
async function mainCheckout(cwd: string) {
  const common = await gitOrThrow(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  return path.dirname(common);
}

/** The remote default branch, such as `origin/main`, or `main` without a remote. */
async function defaultBase(root: string) {
  const remote = await git(root, 'rev-parse', '--abbrev-ref', 'origin/HEAD');
  return remote.ok ? remote.out : 'main';
}

async function hasDevScript(cwd: string) {
  const text = await readFile(path.join(cwd, 'package.json'), 'utf-8').catch(() => '');
  if (!text) {
    return false;
  }
  const manifest = JSON.parse(text) as { scripts?: Record<string, string> };
  return Boolean(manifest.scripts?.dev);
}

async function run(command: Array<string>, cwd: string) {
  const proc = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: out.trim(), err: err.trim() };
}

/** The real side effects of `clutch worktree new`. */
function realSteps(repoRoot: string, base: string): NewWorktreeSteps {
  const remote = base.includes('/') ? base.slice(0, base.indexOf('/')) : null;
  return {
    backend: gitBackend(repoRoot),
    fetch: () =>
      remote ? git(repoRoot, 'fetch', '--quiet', remote) : Promise.resolve({ ok: true, err: '' }),
    shell: (command, cwd) =>
      Bun.spawn(['sh', '-c', command], { cwd, stdio: ['inherit', 'inherit', 'inherit'] }).exited,
    startIssue: (issue, cwd) => issuesCommand(['set', issue, 'in_progress'], cwd),
    devCheck: async (cwd) => {
      const bun = Bun.which('bun');
      if (!bun || !(await hasDevScript(cwd))) {
        return null;
      }
      const result = await run([bun, 'run', 'dev', '--check'], cwd);
      return result.out || result.err || null;
    },
    log: (line) => console.log(line),
  };
}

/**
 * Stops the dev servers of the checkout at `cwd` through its own `dev --stop`,
 * as a command, never an import. It runs only when a dev run there left its
 * record, because a `dev` script without `--stop` would start servers instead.
 */
async function stopServers(cwd: string) {
  const bun = Bun.which('bun');
  if (!bun || !(await Bun.file(path.join(cwd, '.data/dev-run.json')).exists())) {
    return false;
  }
  const result = await run([bun, 'run', 'dev', '--stop'], cwd);
  if (result.code !== 0) {
    throw new Error(`bun run dev --stop failed in ${cwd}: ${result.err || result.out}`);
  }
  return true;
}

/** The PR of `branch` from gh, or null when gh is missing, signed out, or finds none. */
const findPr =
  (repoRoot: string): FindPr =>
  async (branch) => {
    const gh = Bun.which('gh');
    if (!gh) {
      return null;
    }
    const result = await run([gh, 'pr', 'view', branch, '--json', 'number,url,state'], repoRoot);
    return result.code === 0 ? JSON.parse(result.out) : null;
  };

async function runCommand(args: Array<string>, cwd: string): Promise<number> {
  const [action, ...rest] = args;
  const repoRoot = await mainCheckout(cwd);
  if (action === 'new') {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { issue: { type: 'string' }, base: { type: 'string' } },
    });
    const base = values.base ?? (await defaultBase(repoRoot));
    await newWorktree(
      {
        repoRoot,
        slug: positionals[0],
        issue: values.issue,
        base,
        settings: await worktreeSettings(repoRoot),
      },
      realSteps(repoRoot, base),
    );
    return 0;
  }
  if (action === 'rm') {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { force: { type: 'boolean' }, base: { type: 'string' } },
    });
    await removeWorktree(
      {
        slug: positionals[0],
        force: values.force ?? false,
        base: values.base ?? (await defaultBase(repoRoot)),
        settings: await worktreeSettings(repoRoot),
      },
      { backend: gitBackend(repoRoot), stopServers, log: (line) => console.log(line) },
    );
    return 0;
  }
  if (action === 'list') {
    const { values } = parseArgs({ args: rest, options: { json: { type: 'boolean' } } });
    const worktrees = await listWorktrees(gitBackend(repoRoot), findPr(repoRoot));
    console.log(values.json ? JSON.stringify(worktrees, null, 2) : formatWorktrees(worktrees));
    return 0;
  }
  throw new Error(
    'Run clutch worktree new <slug> [--issue CL-NNN] [--base REF], clutch worktree list [--json], or clutch worktree rm <slug> [--force].',
  );
}

/** `clutch worktree`: a separate checkout for each task, through the git backend. */
export async function worktreeCommand(args: Array<string>, cwd: string): Promise<number> {
  try {
    return await runCommand(args, cwd);
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

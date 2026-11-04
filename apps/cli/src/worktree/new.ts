import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { loadRunner } from '@/factory/runner-file';
import type { WorktreeBackend, WorktreeRecord } from '@/worktree/backend';
import { branchName, checkSlug } from '@/worktree/names';
import { worktreeSettings } from '@/worktree/settings';
import type { WorktreeSettings } from '@/worktree/settings';

/** The side effects of `clutch worktree new`, so a test can replace each one. */
export type NewWorktreeSteps = {
  readonly backend: WorktreeBackend;
  /** Fetches the base. A failure only warns, so the command works offline from a local base. */
  readonly fetch: () => Promise<{ ok: boolean; err: string }>;
  /** Runs one setup or check command in `cwd` with the terminal attached, and returns its exit code. */
  readonly shell: (command: string, cwd: string) => Promise<number>;
  /** Marks `issue` in_progress in the checkout at `cwd`. */
  readonly startIssue: (issue: string, cwd: string) => Promise<number>;
  /** The output of the project's `dev --check` in `cwd`, or null when it has no dev script. */
  readonly devCheck: (cwd: string) => Promise<string | null>;
  readonly log: (line: string) => void;
};

export type NewWorktreeOptions = {
  readonly repoRoot: string;
  readonly slug: string | undefined;
  readonly issue?: string;
  readonly base: string;
  /** Where the checkouts go and what to copy, from the main checkout, because the new one does not exist yet. */
  readonly settings: Pick<WorktreeSettings, 'root' | 'copy'>;
  /** A runner in the factory tree. Its `setup` runs before the project's setup. */
  readonly runner?: string;
  /** Runs `worktree.check` after the setup. */
  readonly check?: boolean;
};

/** The result of `worktree.check` in the new checkout. */
type CheckResult = { command: string; exitCode: number; passed: boolean };

/**
 * The commands that the new checkout runs, from its own `clutch.yaml` and
 * factory tree. So a branch that changes them runs its own version, and a
 * stale main checkout changes nothing.
 */
async function commandsOf(checkout: string, runnerName: string | undefined) {
  const own = await worktreeSettings(checkout);
  const runner = runnerName ? await loadRunner(checkout, runnerName) : null;
  if (runner && runner.workspace !== 'worktree') {
    throw new Error(
      `The runner ${runner.name} has workspace ${runner.workspace}, so its agents work in the main checkout and take no worktree.`,
    );
  }
  const machineSetup = runner
    ? runner.setup.map((command) => ({ label: `Runner ${runner.name} setup`, command }))
    : [];
  const setup = [...machineSetup, ...own.setup.map((command) => ({ label: 'Setup', command }))];
  return { runner, setup, check: own.check };
}

/** Copies each `copy` file that exists in the main checkout to the new one. */
async function copyFiles(from: string, to: string, files: ReadonlyArray<string>) {
  const copied: Array<string> = [];
  for (const file of files) {
    const source = path.join(from, file);
    if (await Bun.file(source).exists()) {
      await mkdir(path.dirname(path.join(to, file)), { recursive: true });
      await copyFile(source, path.join(to, file));
      copied.push(file);
    }
  }
  return copied;
}

/**
 * `clutch worktree new`: a checkout of a new branch from `base`, in its own
 * folder under the worktree root, with the copied files and the setup done.
 * Each checkout has its own ports and its own `.data`, so it runs beside the
 * others. With `check`, it then runs the project's check and returns its
 * result. A failed check keeps the checkout, so a person can look.
 */
export async function newWorktree(options: NewWorktreeOptions, steps: NewWorktreeSteps) {
  const slug = checkSlug(options.slug);
  const branch = branchName(slug, options.issue);
  const target = path.join(options.settings.root, slug);
  if (await Bun.file(path.join(target, '.git')).exists()) {
    throw new Error(`${target} already holds a checkout. Pick another slug.`);
  }
  const fetched = await steps.fetch();
  if (!fetched.ok) {
    steps.log(
      `Could not fetch, so the checkout starts from the local ${options.base}: ${fetched.err}`,
    );
  }
  await mkdir(options.settings.root, { recursive: true });
  const created: WorktreeRecord = await steps.backend.create({
    slug,
    branch,
    base: options.base,
    path: target,
  });
  let commands: Awaited<ReturnType<typeof commandsOf>>;
  try {
    commands = await commandsOf(created.path, options.runner);
  } catch (error) {
    // Nothing ran in the checkout yet, so it holds no work to keep.
    await steps.backend.remove({ path: created.path, force: true });
    await steps.backend.deleteBranch(branch);
    throw new Error(`${(error as Error).message} The new checkout is removed.`, { cause: error });
  }
  const copied = await copyFiles(options.repoRoot, created.path, options.settings.copy);
  for (const { label, command } of commands.setup) {
    steps.log(`${label}: ${command}`);
    const code = await steps.shell(command, created.path);
    if (code !== 0) {
      throw new Error(
        `Setup command "${command}" exited ${code} in ${created.path}. The checkout exists. Fix the command, run it there, or remove the checkout.`,
      );
    }
  }
  if (options.issue) {
    const code = await steps.startIssue(options.issue, created.path);
    if (code !== 0) {
      throw new Error(`clutch issues set ${options.issue} in_progress failed in ${created.path}.`);
    }
  }
  steps.log(`Path: ${created.path}`);
  steps.log(`Branch: ${branch} (from ${options.base})`);
  if (copied.length) {
    steps.log(`Copied: ${copied.join(', ')}`);
  }
  const dev = await steps.devCheck(created.path);
  if (dev) {
    // dev --check exits 1 while any server is down, which a new checkout always is.
    steps.log(`Dev servers (start them with bun run dev in the checkout):\n${dev}`);
  }
  let check: CheckResult | null = null;
  if (options.check) {
    steps.log(`Check: ${commands.check}`);
    const exitCode = await steps.shell(commands.check, created.path);
    check = { command: commands.check, exitCode, passed: exitCode === 0 };
    steps.log(
      check.passed
        ? 'The check passed.'
        : `The check exited ${exitCode}. The checkout stays at ${created.path}, so a person can look.`,
    );
  }
  return { ...created, branch, copied, runner: commands.runner?.name ?? null, check };
}

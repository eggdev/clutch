import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { WorktreeBackend, WorktreeRecord } from '@/worktree/backend';
import { branchName, checkSlug } from '@/worktree/names';
import type { WorktreeSettings } from '@/worktree/settings';

/** The side effects of `clutch worktree new`, so a test can replace each one. */
export type NewWorktreeSteps = {
  readonly backend: WorktreeBackend;
  /** Fetches the base. A failure only warns, so the command works offline from a local base. */
  readonly fetch: () => Promise<{ ok: boolean; err: string }>;
  /** Runs one setup command in `cwd` with the terminal attached, and returns its exit code. */
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
  readonly settings: WorktreeSettings;
};

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
 * others.
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
  const copied = await copyFiles(options.repoRoot, created.path, options.settings.copy);
  for (const command of options.settings.setup) {
    steps.log(`Setup: ${command}`);
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
  return { ...created, branch, copied };
}

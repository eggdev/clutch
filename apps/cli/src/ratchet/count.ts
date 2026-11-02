import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { git, gitOrThrow } from '@/git';
import { compareCounts, countText, parseCommandCounts } from '@/ratchet/compare';
import type { Counts } from '@/ratchet/compare';
import type { Ratchet } from '@/ratchet/config';

/** The tracked files that `glob` matches, in the working tree or at `ref`. */
async function trackedFiles(root: string, glob: string, ref?: string) {
  const out = ref
    ? await gitOrThrow(root, 'ls-tree', '-r', '--name-only', ref)
    : await gitOrThrow(root, 'ls-files');
  const match = new Bun.Glob(glob);
  return out.split('\n').filter((file) => file && match.match(file));
}

/** The text of `file` in the working tree, or at `ref`. A file that is gone reads as empty. */
async function fileText(root: string, file: string, ref?: string) {
  if (ref) {
    const shown = await git(root, 'show', `${ref}:${file}`);
    return shown.ok ? shown.out : '';
  }
  return readFile(path.join(root, file), 'utf-8').catch(() => '');
}

/** Counts a pattern ratchet in `files`. A file with no match is left out. */
async function countFiles(root: string, pattern: string, files: Array<string>, ref?: string) {
  const counts: Counts = {};
  for (const file of files) {
    const count = countText(await fileText(root, file, ref), pattern);
    if (count > 0) {
      counts[file] = count;
    }
  }
  return counts;
}

/** Runs a command ratchet in `root` and reads its `path:count` lines. */
async function runCommand(root: string, command: string) {
  const proc = Bun.spawn(['sh', '-c', command], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`The ratchet command failed: ${command}\n${err.trim()}`);
  }
  return parseCommandCounts(out);
}

/** The counts of a ratchet in the working tree. */
export async function countNow(root: string, ratchet: Ratchet) {
  if (ratchet.command) {
    return runCommand(root, ratchet.command);
  }
  return countFiles(root, ratchet.pattern ?? '', await trackedFiles(root, ratchet.files));
}

/**
 * Checks one ratchet. A pattern ratchet also compares each file that the
 * change touches with the merge base. A command ratchet runs on the working
 * tree only, so it compares with the baseline.
 */
export async function checkRatchet(root: string, ratchet: Ratchet, base: string | null) {
  const now = await countNow(root, ratchet);
  if (!base || !ratchet.pattern) {
    return { now, ...compareCounts(ratchet, now) };
  }
  const match = new Bun.Glob(ratchet.files);
  const diff = await gitOrThrow(root, 'diff', '--name-only', base);
  const touched = diff.split('\n').filter((file) => file && match.match(file));
  const counts = await countFiles(root, ratchet.pattern, touched, base);
  return { now, ...compareCounts(ratchet, now, { counts, touched }) };
}

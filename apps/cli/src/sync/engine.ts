import { randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow } from '@/git';
import { localFile, safeRelative } from '@/review-source';

/**
 * The sync engine. It plans how a target folder moves to a set of source
 * files, and applies the plan. A file that the target changed by hand is a
 * conflict: its hash matches neither the last install record nor the
 * baseline. Writes are symlink-safe. `clutch sync` and `clutch install` use
 * it.
 */

/** One file: its git mode, its bytes and their fingerprint. */
export type SyncFile = { mode: string; content: Buffer; hash: string };

/** The files to install, the hashes of older known copies, and the paths the source owns. */
export type SyncSource = {
  files: Map<string, SyncFile>;
  baseline: Map<string, string>;
  roots: Array<string>;
};

/** The hashes that the last install wrote, by path. */
export type SyncRecord = { files: Record<string, string> };

export type Change = { path: string; action: 'add' | 'update' | 'remove' };

export type Plan = {
  changes: Array<Change>;
  conflicts: Array<string>;
  inspected: Map<string, string | null>;
};

function managed(source: SyncSource, filename: string): boolean {
  return source.roots.some((root) =>
    root.endsWith('/') ? filename.startsWith(root) : filename === root,
  );
}

export async function writeEntry(root: string, filename: string, file: SyncFile): Promise<void> {
  const target = path.join(root, filename);
  const temporary = `${target}.clutch-${randomUUID()}`;
  await mkdir(path.dirname(target), { recursive: true });
  try {
    if (file.mode === '120000') {
      const link = file.content.toString();
      const resolved = path.resolve(path.dirname(target), link);
      if (!resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error(`Review symlink escapes project: ${filename}`);
      }
      await symlink(link, temporary);
    } else {
      await writeFile(temporary, file.content);
      await chmod(temporary, file.mode === '100755' ? 0o755 : 0o644);
    }
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
  }
}

async function pruneEmpty(root: string, filename: string): Promise<void> {
  let directory = path.dirname(path.join(root, filename));
  while (directory !== root) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (['ENOTEMPTY', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        return;
      }
      throw error;
    }
    directory = path.dirname(directory);
  }
}

async function planDesired(
  root: string,
  source: SyncSource,
  manifest: SyncRecord,
  planned: Plan,
  removals: Map<string, string>,
) {
  const { changes, conflicts, inspected } = planned;
  for (const [filename, file] of source.files) {
    const current = await localFile(root, filename);
    inspected.set(filename, current?.hash ?? null);
    removals.delete(filename);
    if (current?.hash === file.hash) {
      continue;
    }
    if (
      current &&
      current.hash !== manifest.files[filename] &&
      current.hash !== source.baseline.get(filename)
    ) {
      conflicts.push(filename);
    } else {
      changes.push({ path: filename, action: current ? 'update' : 'add' });
    }
  }
}

async function planRemovals(
  root: string,
  source: SyncSource,
  planned: Plan,
  removals: Map<string, string>,
) {
  const { changes, conflicts, inspected } = planned;
  for (const [filename, hash] of removals) {
    safeRelative(filename);
    const current = await localFile(root, filename);
    inspected.set(filename, current?.hash ?? null);
    if (!current) {
      continue;
    }
    if (!managed(source, filename) || current.hash !== hash) {
      conflicts.push(filename);
    } else {
      changes.push({ path: filename, action: 'remove' });
    }
  }
}

/**
 * Plans the changes that move `root` to `source`. `recordPath` is the file
 * that holds `record`. The plan inspects it too, so `apply` can see it change.
 */
export async function plan(
  root: string,
  source: SyncSource,
  record: SyncRecord,
  recordPath: string,
  previous: SyncFile | null,
): Promise<Plan> {
  const changes: Array<Change> = [];
  const conflicts: Array<string> = [];
  const inspected = new Map<string, string | null>([[recordPath, previous?.hash ?? null]]);
  const removals = new Map(Object.entries(record.files));
  for (const [filename, hash] of source.baseline) {
    if (!source.files.has(filename) && managed(source, filename)) {
      removals.set(filename, hash);
    }
  }
  const planned = { changes, conflicts, inspected };
  await planDesired(root, source, record, planned, removals);
  await planRemovals(root, source, planned, removals);
  return planned;
}

/**
 * Applies `planned` to `root`. The paths it inspected must be clean in git,
 * and must still match the plan, before the first write. `skip` holds paths
 * that the caller writes itself, such as the install record.
 */
export async function apply(
  root: string,
  source: SyncSource,
  planned: Plan,
  skip: string,
): Promise<void> {
  const { changes, inspected } = planned;
  // Unrelated work may stay dirty. Managed paths must be clean, so the owner can
  // restore them alone after an interrupted install.
  const managedPaths = [...inspected.keys()].map((filename) => `:(literal)${filename}`);
  const dirty = await gitOrThrow(
    root,
    'status',
    '--porcelain',
    '--untracked-files=all',
    '--',
    ...managedPaths,
  );
  if (dirty) {
    throw new Error(
      `Commit or stash changes to these managed files before a sync; --check is read-only.\n${dirty}`,
    );
  }
  // Check the complete preflight again before the first mutation.
  for (const [filename, hash] of inspected) {
    const current = await localFile(root, filename);
    if (current?.hash !== (hash ?? undefined)) {
      throw new Error(`File changed after review preflight: ${filename}`);
    }
  }
  for (const change of changes.filter((entry) => entry.path !== skip)) {
    if (change.action === 'remove') {
      await unlink(path.join(root, change.path));
      await pruneEmpty(root, change.path);
    } else {
      const file = source.files.get(change.path);
      if (!file) {
        throw new Error(`Missing source entry: ${change.path}`);
      }
      await writeEntry(root, change.path, file);
    }
  }
}

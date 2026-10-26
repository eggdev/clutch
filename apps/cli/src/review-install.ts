import { randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow } from '@apps/cli/src/git';
import type { ReviewFile, ReviewSource } from '@apps/cli/src/review-source';
import { loadReviewSource, localFile, safeRelative } from '@apps/cli/src/review-source';

const manifestPath = '.review/tooling.json';
type Manifest = { schemaVersion: 1; templateCommit: string; files: Record<string, string> };
type Change = { path: string; action: 'add' | 'update' | 'remove' };

export type ReviewInstallResult = {
  schemaVersion: 1;
  status: 'installed' | 'unchanged' | 'planned' | 'conflict';
  templateCommit: string;
  changes: Array<Change>;
  conflicts: Array<string>;
  nextAction: 'setup-verification';
};

function managed(source: ReviewSource, filename: string): boolean {
  return source.roots.some((root) =>
    root.endsWith('/') ? filename.startsWith(root) : filename === root,
  );
}

async function writeEntry(root: string, filename: string, file: ReviewFile): Promise<void> {
  const target = path.join(root, filename);
  const temporary = `${target}.review-${randomUUID()}`;
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

type Plan = {
  changes: Array<Change>;
  conflicts: Array<string>;
  inspected: Map<string, string | null>;
};

async function planDesired(
  root: string,
  source: ReviewSource,
  manifest: Manifest,
  plan: Plan,
  removals: Map<string, string>,
) {
  const { changes, conflicts, inspected } = plan;
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
  source: ReviewSource,
  plan: Plan,
  removals: Map<string, string>,
) {
  const { changes, conflicts, inspected } = plan;
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

async function preflight(
  root: string,
  source: ReviewSource,
  manifest: Manifest,
  previous: ReviewFile | null,
): Promise<Plan> {
  const changes: Array<Change> = [];
  const conflicts: Array<string> = [];
  const inspected = new Map<string, string | null>([[manifestPath, previous?.hash ?? null]]);
  const removals = new Map(Object.entries(manifest.files));
  for (const [filename, hash] of source.baseline) {
    if (!source.files.has(filename) && managed(source, filename)) {
      removals.set(filename, hash);
    }
  }
  const plan = { changes, conflicts, inspected };
  await planDesired(root, source, manifest, plan, removals);
  await planRemovals(root, source, plan, removals);
  return plan;
}

function readManifest(previous: ReviewFile | null): Manifest {
  const manifest: Manifest = previous
    ? JSON.parse(previous.content.toString())
    : {
        schemaVersion: 1,
        templateCommit: '',
        files: {},
      };
  if (manifest.schemaVersion !== 1 || !manifest.files || typeof manifest.files !== 'object') {
    throw new Error('Unsupported .review/tooling.json; reconcile it before installation.');
  }
  return manifest;
}

export async function installReview(options: {
  root: string;
  template: string;
  check?: boolean;
}): Promise<ReviewInstallResult> {
  const root = await gitOrThrow(options.root, 'rev-parse', '--show-toplevel');
  const source = await loadReviewSource(options.template);
  const previous = await localFile(root, manifestPath);
  const manifest = readManifest(previous);
  const { changes, conflicts, inspected } = await preflight(root, source, manifest, previous);
  const updated: Manifest = {
    schemaVersion: 1,
    templateCommit: source.commit,
    files: Object.fromEntries([...source.files].map(([filename, file]) => [filename, file.hash])),
  };
  const content = Buffer.from(`${JSON.stringify(updated, null, 2)}\n`);
  if (!previous || !previous.content.equals(content)) {
    changes.push({ path: manifestPath, action: previous ? 'update' : 'add' });
  }
  const pending = changes.length ? 'planned' : 'unchanged';
  const result: ReviewInstallResult = {
    schemaVersion: 1,
    status: conflicts.length ? 'conflict' : pending,
    templateCommit: source.commit,
    changes,
    conflicts,
    nextAction: 'setup-verification',
  };
  if (conflicts.length || options.check || !changes.length) {
    return result;
  }
  if (await gitOrThrow(root, 'status', '--porcelain')) {
    throw new Error(
      'Commit or stash project changes before installing review tooling; --check is read-only.',
    );
  }
  // Check the complete preflight again before the first mutation.
  for (const [filename, hash] of inspected) {
    const current = await localFile(root, filename);
    if (current?.hash !== (hash ?? undefined)) {
      throw new Error(`File changed after review preflight: ${filename}`);
    }
  }
  for (const change of changes.filter((entry) => entry.path !== manifestPath)) {
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
  await writeEntry(root, manifestPath, { mode: '100644', content, hash: '' });
  return { ...result, status: 'installed' };
}

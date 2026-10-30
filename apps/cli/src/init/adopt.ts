import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow } from '@/git';
import { fingerprint, localFile } from '@/review-source';
import type { SyncSource } from '@/sync/engine';

/** Every git blob that each path has had in the Clutch history. */
async function historicalBlobs(template: string, roots: Array<string>) {
  const log = await gitOrThrow(
    template,
    'log',
    '--no-abbrev',
    '--format=',
    '--raw',
    '--',
    ...roots,
  );
  const blobs = new Map<string, Set<string>>();
  for (const line of log.split('\n')) {
    const match = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) \w+\t(.+)$/u.exec(line);
    if (match) {
      const [, blob, file] = match;
      blobs.set(file, (blobs.get(file) ?? new Set()).add(blob));
    }
  }
  return blobs;
}

/** The git blob id of a file's bytes, as `git hash-object` gives it. */
function blobId(content: Buffer) {
  const hasher = new Bun.CryptoHasher('sha1');
  hasher.update(`blob ${content.length}\0`);
  hasher.update(content);
  return hasher.digest('hex');
}

/**
 * The lineage of a project that already holds Clutch files. A managed file that
 * matches some earlier Clutch version is an unchanged copy, so sync may update
 * it. A file that matches none was edited, so it stays a decision for a person.
 */
export async function adoptedLineage(root: string, template: string, managed: SyncSource) {
  const blobs = await historicalBlobs(template, managed.roots);
  const files: Record<string, string> = {};
  for (const file of managed.files.keys()) {
    const mine = await localFile(root, file);
    if (mine && mine.mode !== '120000') {
      const content = await readFile(path.join(root, file));
      if (blobs.get(file)?.has(blobId(content))) {
        files[file] = fingerprint(mine.mode, content);
      }
    }
  }
  return files;
}

import { gitOrThrow } from '@/git';
import type { ReviewFile } from '@/review-source';
import { loadReviewSource, localFile } from '@/review-source';
import { apply, plan, writeEntry } from '@/sync/engine';
import type { Change } from '@/sync/engine';

const manifestPath = '.review/tooling.json';
type Manifest = { schemaVersion: 1; templateCommit: string; files: Record<string, string> };

export type ReviewInstallResult = {
  schemaVersion: 1;
  status: 'installed' | 'unchanged' | 'planned' | 'conflict';
  templateCommit: string;
  changes: Array<Change>;
  conflicts: Array<string>;
  nextAction: 'setup-verification';
};

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
  const { changes, conflicts, inspected } = await plan(
    root,
    source,
    manifest,
    manifestPath,
    previous,
  );
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
  await apply(root, source, { changes, conflicts, inspected }, manifestPath);
  await writeEntry(root, manifestPath, { mode: '100644', content, hash: '' });
  return { ...result, status: 'installed' };
}

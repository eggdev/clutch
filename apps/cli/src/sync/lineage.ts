import { localFile } from '@/review-source';
import type { Change } from '@/sync/engine';
import { pinFile } from '@/sync/pin';
import { lineagePath } from '@/sync/source';
import type { ClutchSource } from '@/sync/source';

/** The older record of a project that has only the review tooling. Sync moves it into the lineage. */
export const reviewRecord = '.review/tooling.json';

/** `.clutch/lineage.json`: what the last sync or install wrote, and the Clutch commit it came from. */
type Lineage = {
  schemaVersion: 1;
  templateRepo: string;
  templateCommit: string;
  /** The Clutch release of `templateCommit`. Absent for a commit between releases. */
  release?: string;
  files: Record<string, string>;
  /** Managed files the project kept over Clutch's copy, with the Clutch hash it declined. */
  kept?: Record<string, string>;
};

/** The last lineage. A project that only has review tooling starts from `.review/tooling.json`. */
export async function readLineage(root: string) {
  const current = await localFile(root, lineagePath);
  const legacy = current ? null : await localFile(root, reviewRecord);
  const record = current ?? legacy;
  const parsed = record ? (JSON.parse(record.content.toString()) as Partial<Lineage>) : {};
  return {
    previous: current,
    legacy,
    files: parsed.files ?? {},
    kept: parsed.kept ?? {},
    release: parsed.release ?? null,
    commit: parsed.templateCommit ?? null,
  };
}

export type ProjectLineage = Awaited<ReturnType<typeof readLineage>>;

const under = (roots: Array<string>, file: string) =>
  roots.some((root) => (root.endsWith('/') ? file.startsWith(root) : file === root));

/** Entries of `record` that a sync scoped to `roots` must keep as they are. */
function outside(record: Record<string, string>, roots: Array<string> | null) {
  return roots
    ? Object.fromEntries(Object.entries(record).filter(([file]) => !under(roots, file)))
    : {};
}

/** The lineage after this sync. A scoped sync keeps the records of the files outside its scope. */
export function nextLineage(input: {
  repo: string | undefined;
  source: ClutchSource;
  lineage: ProjectLineage;
  scope: Array<string> | null;
  kept: Record<string, string>;
  pinHash: string | undefined;
}): Lineage {
  const { source, lineage, scope } = input;
  const next: Lineage = {
    schemaVersion: 1,
    templateRepo: input.repo ?? '',
    templateCommit: source.commit,
    ...(source.release ? { release: source.release } : {}),
    files: {
      ...outside(lineage.files, scope),
      ...Object.fromEntries([...source.managed.files].map(([file, entry]) => [file, entry.hash])),
      ...(input.pinHash ? { [pinFile]: input.pinHash } : {}),
    },
  };
  const kept = { ...outside(lineage.kept, scope), ...input.kept };
  if (Object.keys(kept).length > 0) {
    next.kept = kept;
  }
  return next;
}

/** The changes to the lineage, the old pin in clutch.yaml and the old review record. */
export function recordChanges(
  lineage: ProjectLineage,
  lineageText: string,
  unpinned: string | null,
): Array<Change> {
  const changes: Array<Change> = [];
  if (lineage.previous?.content.toString() !== lineageText) {
    changes.push({ path: lineagePath, action: lineage.previous ? 'update' : 'add' });
  }
  if (unpinned) {
    changes.push({ path: 'clutch.yaml', action: 'update' });
  }
  if (lineage.legacy) {
    changes.push({ path: reviewRecord, action: 'remove' });
  }
  return changes;
}

/** The lineage entries that the managed plan records. The pin is planned apart, so its entry is not in the plan. */
export function managedRecord(lineage: ProjectLineage, scope: Array<string> | null) {
  const record = scope
    ? Object.fromEntries(Object.entries(lineage.files).filter(([file]) => under(scope, file)))
    : lineage.files;
  return Object.fromEntries(Object.entries(record).filter(([file]) => file !== pinFile));
}

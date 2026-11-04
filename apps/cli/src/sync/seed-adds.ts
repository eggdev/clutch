import { git } from '@/git';
import { localFile } from '@/review-source';
import type { SyncFile } from '@/sync/engine';
import { releaseCommit, seedChangesSince } from '@/sync/seed-changes';
import type { ClutchSource } from '@/sync/source';

/** The Clutch commit of the project's last sync: its release, else its commit. */
async function baseCommit(template: string, last: { release: string | null; commit: string }) {
  if (last.release) {
    return releaseCommit(template, last.release);
  }
  const found = await git(template, 'rev-parse', '--verify', '--quiet', `${last.commit}^{commit}`);
  if (!found.ok) {
    throw new Error(`the commit ${last.commit.slice(0, 12)} is not in ${template}`);
  }
  return found.out;
}

/** The files of `paths` that Clutch added between `base` and `target`. */
async function addedPaths(template: string, base: string, target: string, paths: Array<string>) {
  const diff = await git(
    template,
    '--literal-pathspecs',
    'diff',
    '--name-only',
    '--no-renames',
    '--diff-filter=A',
    '-z',
    base,
    target,
    '--',
    ...paths,
  );
  if (!diff.ok) {
    throw new Error(diff.err);
  }
  const names = new Set(diff.out.split('\0'));
  return paths.filter((file) => names.has(file));
}

/**
 * The seed files that this sync adds. A file qualifies when its entry in
 * `clutch.files.yaml` has `add_on_sync`, Clutch added it after the project's
 * last sync, and the project has no file at its path. So sync adds each file
 * once, as install does, and the project owns it after that. A file that the
 * project deleted after its sync is not added again. `last` is null when the
 * project has no lineage: then each such file that the project lacks is new.
 * When the last sync's commit cannot be read, nothing is added, and the note says why.
 */
async function seedAdds(input: {
  root: string;
  template: string;
  last: { release: string | null; commit: string } | null;
  source: ClutchSource;
}): Promise<{ files: Map<string, SyncFile>; note: string | null }> {
  const { source, last } = input;
  const files = new Map<string, SyncFile>();
  const candidates: Array<string> = [];
  for (const file of source.addOnSync) {
    if (!(await localFile(input.root, file))) {
      candidates.push(file);
    }
  }
  if (candidates.length === 0 || last?.commit === source.commit) {
    return { files, note: null };
  }
  let added = candidates;
  if (last) {
    try {
      const base = await baseCommit(input.template, last);
      added = await addedPaths(input.template, base, source.commit, candidates);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        files,
        note: `Could not read the Clutch commit of the last sync, so sync added no new seed file: ${message}.`,
      };
    }
  }
  for (const file of added) {
    files.set(file, source.seed.get(file) as SyncFile);
  }
  return { files, note: null };
}

/**
 * The seed part of a sync: the seed files that it adds, the project's seed
 * pages that Clutch changed, and a note when either could not be read.
 */
export async function planSeeds(input: {
  root: string;
  template: string;
  lineage: { release: string | null; commit: string | null };
  source: ClutchSource;
  repo?: string;
}) {
  const { root, template, lineage, source } = input;
  const last = lineage.commit ? { release: lineage.release, commit: lineage.commit } : null;
  const added = await seedAdds({ root, template, last, source });
  const changed = await seedChangesSince({
    root,
    template,
    from: lineage.release,
    source,
    repo: input.repo,
  });
  const notes = [changed.note, added.note].filter((note) => note !== null);
  return {
    adds: added.files,
    changes: changed.changes,
    note: notes.length > 0 ? notes.join(' ') : null,
  };
}

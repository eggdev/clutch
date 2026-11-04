import { localFile } from '@/review-source';
import type { SyncFile } from '@/sync/engine';
import type { ClutchSource } from '@/sync/source';

/**
 * The seed files that this sync adds. A file qualifies when its entry in
 * `clutch.files.yaml` has `add_on_sync`, the project has no file at its path,
 * and `seeded` in `.clutch/lineage.json` does not list it. Install and sync
 * list each such file in `seeded`, so sync adds a file once, and the project
 * owns it after that. A file that the project deleted is not added again.
 */
export async function seedAdds(root: string, source: ClutchSource, seeded: Array<string>) {
  const listed = new Set(seeded);
  const adds = new Map<string, SyncFile>();
  for (const file of source.addOnSync) {
    if (!listed.has(file) && !(await localFile(root, file))) {
      adds.set(file, source.seed.get(file) as SyncFile);
    }
  }
  return adds;
}

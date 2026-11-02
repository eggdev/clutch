import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Detection } from '@/doctor/detect';
import { backwardMoves, refuseBackward } from '@/doctor/one-way';

export const baselineFile = '.clutch/doctor-baseline.json';

const rank: Record<string, number> = { missing: 0, partial: 1, present: 2 };

/** The detected status of each capability when the baseline was last raised, or nothing. */
export async function readBaseline(root: string): Promise<Record<string, string> | undefined> {
  try {
    return JSON.parse(await readFile(path.join(root, baselineFile), 'utf-8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/**
 * The new baseline from `detections`. An unknown detection keeps its old
 * value. A lower status than the old baseline is a downgrade, and the write
 * refuses it unless `allowDowngrade` is set.
 */
export function nextBaseline(
  detections: Array<Pick<Detection, 'id' | 'status'>>,
  old: Record<string, string> = {},
  allowDowngrade = false,
) {
  const next: Record<string, string> = {};
  for (const { id, status } of detections.toSorted((a, b) => a.id.localeCompare(b.id))) {
    // An unknown detection keeps its old value.
    if (status !== 'unknown') {
      next[id] = status;
    } else if (old[id]) {
      next[id] = old[id];
    }
  }
  refuseBackward(
    backwardMoves(old, next, (before, after) => rank[before] > rank[after]),
    allowDowngrade,
    (list) =>
      `The baseline only moves up. These would go down: ${list}. Restore them, or pass --allow-downgrade and ask the owner to review.`,
  );
  return next;
}

export async function writeBaseline(root: string, baseline: Record<string, string>) {
  await writeFile(path.join(root, baselineFile), `${JSON.stringify(baseline, null, 2)}\n`);
}

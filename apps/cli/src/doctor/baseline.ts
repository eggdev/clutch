import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Detection } from '@/doctor/detect';

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
  const downgrades: Array<string> = [];
  for (const { id, status } of detections.toSorted((a, b) => a.id.localeCompare(b.id))) {
    const before = old[id];
    if (status === 'unknown') {
      if (before) {
        next[id] = before;
      }
      continue;
    }
    if (before && rank[before] > rank[status]) {
      downgrades.push(`${id} ${before} -> ${status}`);
    }
    next[id] = status;
  }
  if (downgrades.length > 0 && !allowDowngrade) {
    throw new Error(
      `The baseline only moves up. These would go down: ${downgrades.join(', ')}. Restore them, or pass --allow-downgrade and ask the owner to review.`,
    );
  }
  return next;
}

export async function writeBaseline(root: string, baseline: Record<string, string>) {
  await writeFile(path.join(root, baselineFile), `${JSON.stringify(baseline, null, 2)}\n`);
}

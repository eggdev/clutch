import { backwardMoves, refuseBackward } from '@/doctor/one-way';
import type { Ratchet } from '@/ratchet/config';

/** The violations of a rule in one tree, by path. A path with none is left out. */
export type Counts = Record<string, number>;

/** How many times `pattern` matches `text`. */
export function countText(text: string, pattern: string) {
  return [...text.matchAll(new RegExp(pattern, 'gu'))].length;
}

/** `path:count` lines from a ratchet command, with the zero counts left out. */
export function parseCommandCounts(output: string): Counts {
  const counts: Counts = {};
  for (const line of output.split('\n')) {
    const match = /^(.+):(\d+)\s*$/u.exec(line.trim());
    if (match && Number(match[2]) > 0) {
      counts[match[1]] = (counts[match[1]] ?? 0) + Number(match[2]);
    }
  }
  return counts;
}

type Finding = { path: string; from: number; to: number; against: 'base' | 'baseline' };

/**
 * Compares the counts now with the baseline, and with the merge base for the
 * files the change touches. A count above either one is a raise, and fails.
 * A count below the baseline is a drop that the change has not recorded: the
 * check exits 2 until `clutch ratchet update` lowers the baseline.
 */
export function compareCounts(
  ratchet: Pick<Ratchet, 'counts'>,
  now: Counts,
  base?: { counts: Counts; touched: Array<string> },
) {
  const raised: Array<Finding> = [];
  const dropped: Array<Finding> = [];
  const paths = new Set([...Object.keys(ratchet.counts), ...Object.keys(now)]);
  for (const path of [...paths].toSorted()) {
    const to = now[path] ?? 0;
    const allowed = ratchet.counts[path] ?? 0;
    if (to > allowed) {
      raised.push({ path, from: allowed, to, against: 'baseline' });
    } else if (to < allowed) {
      dropped.push({ path, from: allowed, to, against: 'baseline' });
    }
  }
  // As Bar Savvy's check-lint-suppressions does: a touched file may not gain one.
  for (const path of base?.touched ?? []) {
    const from = base?.counts[path] ?? 0;
    const to = now[path] ?? 0;
    if (to > from && !raised.some((item) => item.path === path)) {
      raised.push({ path, from, to, against: 'base' });
    }
  }
  let code = 0;
  if (raised.length > 0) {
    code = 1;
  } else if (dropped.length > 0) {
    code = 2;
  }
  return { raised, dropped, code };
}

/**
 * The baseline after an update: the counts now. An update only lowers a
 * count, so a raise throws, through the same one-way rule as the doctor
 * baseline.
 */
export function nextCounts(ratchet: Pick<Ratchet, 'counts'>, now: Counts) {
  const next: Counts = {};
  for (const [path, count] of Object.entries(now)) {
    if (count > 0) {
      next[path] = count;
    }
  }
  const before = { ...ratchet.counts };
  // A path new to the ratchet counts as zero before, so any count there is a raise.
  for (const path of Object.keys(next)) {
    before[path] ??= 0;
  }
  refuseBackward(
    backwardMoves(before, next, (from, to) => to > from),
    false,
    (list) => `A ratchet only goes down. These would go up: ${list}. Fix the new violations first.`,
  );
  return next;
}

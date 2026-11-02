import { git } from '@/git';
import { releaseParts } from '@/release';

/** How long `sync --check` only warns, when clutch.yaml sets no `template.grace_days`. */
export const defaultGraceDays = 14;

export type Grace = {
  /** True when the project may stay behind for now: `sync --check` warns and exits 0. */
  within: boolean;
  message: string;
};

const dayMs = 86_400_000;

/** Negative when release `a` comes before `b`, from their version numbers. */
const compareReleases = (a: Array<number>, b: Array<number>) =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Whether a project at release `from` may stay behind release `to` for now, as
 * Renovate lets a dependency update wait. It may when both releases share a
 * major version, and the oldest release that it lacks, `firstMissing`, came out
 * no more than `days` days before `now`. A new major version never waits.
 */
export function graceFor(input: {
  from: string;
  to: string;
  firstMissing: { tag: string; date: Date } | null;
  days: number;
  now: Date;
}): Grace {
  const { from, to, firstMissing, days, now } = input;
  const [fromMajor] = releaseParts(from) ?? [];
  const [toMajor] = releaseParts(to) ?? [];
  if (fromMajor === undefined || fromMajor !== toMajor) {
    return {
      within: false,
      message: `The project is at Clutch ${from}, and ${to} is a new major version. Run clutch sync.`,
    };
  }
  if (!firstMissing) {
    return {
      within: false,
      message: `The project is at Clutch ${from}, behind ${to}, and the date of the next release is unknown. Run clutch sync.`,
    };
  }
  const age = Math.floor((now.getTime() - firstMissing.date.getTime()) / dayMs);
  const left = days - age;
  if (left < 0) {
    return {
      within: false,
      message: `The project is at Clutch ${from}, behind ${to}. ${firstMissing.tag} came out ${age} days ago, past the ${days}-day grace window. Run clutch sync, or merge the open Clutch sync PR.`,
    };
  }
  return {
    within: true,
    message: `warning: the project is at Clutch ${from}, behind ${to}. ${firstMissing.tag} came out ${age} days ago, so this passes for ${left} more days (template.grace_days is ${days}). Merge the Clutch sync PR, or run clutch sync.`,
  };
}

/**
 * The oldest release in the Clutch checkout `template` after `from`, up to and
 * including `to`, with the date of its commit. Null when the checkout lacks
 * the tags, such as a shallow clone.
 */
export async function firstReleaseAfter(template: string, from: string, to: string) {
  const fromParts = releaseParts(from);
  const toParts = releaseParts(to);
  const tags = await git(template, 'tag', '--list', 'v*');
  if (!fromParts || !toParts || !tags.ok) {
    return null;
  }
  const missing = tags.out
    .split('\n')
    .flatMap((tag) => {
      const parts = releaseParts(tag.trim());
      return parts && compareReleases(parts, fromParts) > 0 && compareReleases(parts, toParts) <= 0
        ? [{ tag: tag.trim(), parts }]
        : [];
    })
    .toSorted((a, b) => compareReleases(a.parts, b.parts));
  const first = missing[0];
  if (!first) {
    return null;
  }
  const date = await git(template, 'log', '-1', '--format=%cI', `${first.tag}^{commit}`);
  return date.ok && date.out.trim() ? { tag: first.tag, date: new Date(date.out.trim()) } : null;
}

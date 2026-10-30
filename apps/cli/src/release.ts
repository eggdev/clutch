import { git } from '@/git';

const releaseTag = /^v(\d+)\.(\d+)\.(\d+)$/u;

/** The newest `vX.Y.Z` tag in `tags`, or null. */
export function newestRelease(tags: Array<string>) {
  const versions = tags.flatMap((tag) => {
    const match = releaseTag.exec(tag.trim());
    return match ? [{ tag: tag.trim(), parts: match.slice(1).map(Number) }] : [];
  });
  versions.sort(
    (a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2],
  );
  return versions[0]?.tag ?? null;
}

/**
 * The latest Clutch release in the Clutch checkout `template`: its newest
 * `vX.Y.Z` tag. Every merge to main is a release, so this is the newest Clutch
 * that a project can take. It reads the local tags and never fetches.
 */
export async function latestRelease(template: string) {
  const tags = await git(template, 'tag', '--list', 'v*');
  const tag = tags.ok ? newestRelease(tags.out.split('\n')) : null;
  if (!tag) {
    throw new Error(
      `${template} has no Clutch release tag. Run git fetch --tags there, or pass --to <commit>.`,
    );
  }
  return tag;
}

/** The release tag of `commit` in `template`, or null when the commit is not a release. */
export async function releaseAt(template: string, commit: string) {
  const tags = await git(template, 'tag', '--points-at', commit, '--list', 'v*');
  return tags.ok ? newestRelease(tags.out.split('\n')) : null;
}

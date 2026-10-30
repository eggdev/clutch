/**
 * The bot rule: when a bot's pull request may merge without a person at the
 * `bots` step of auto-merge. A Renovate PR may when its diff changes only
 * dependency versions, lockfiles and changesets. Renovate already waits out
 * the 3-day release age (`minimumReleaseAge` in renovate.json). A gardening
 * PR may when its risk tier is low. See
 * .agents/skills/deliver/references/pull-requests.md#auto-merge.
 */

/** One changed file of a pull request, as `gh api repos/<repo>/pulls/<n>/files` gives it. */
export type ChangedFile = { filename: string; patch?: string };

/** The bot whose pull request this is, from its head branch, or null. */
export function botKind(headRefName: string) {
  if (headRefName.startsWith('renovate/')) {
    return 'renovate';
  }
  return headRefName.startsWith('gardening/') ? 'gardening' : null;
}

/**
 * The files that skip the line-by-line version check in `renovateProblems`.
 * `bun.lock` is generated: CI's `bun install --frozen-lockfile` fails unless
 * it matches the package.json versions, which this rule does check. Renovate's
 * own changeset, `.changeset/renovate-*.md`, is release-note text that runs no
 * code.
 */
const free = [/^bun\.lock$/u, /^\.changeset\/renovate-[\w.-]+\.md$/u];

/** A file that may change only on lines that each set a version, and how such a line looks. */
const versionOnly: Array<[RegExp, RegExp]> = [
  // "name": "1.2.3", in any package.json, or "packageManager": "bun@1.4.2". A
  // changed script or any other value is not a version, so it fails.
  [/(?:^|\/)package\.json$/u, /^\s*"[^"]+":\s*"(?:[~^]?v?\d[\w.+-]*|[\w-]+@[~^]?\d[\w.+-]*)",?$/u],
  // An action pinned to a commit, with the version as a comment.
  [
    /^\.github\/workflows\/[\w.-]+\.ya?ml$/u,
    /^\s*(?:-\s+)?uses:\s+\S+@[0-9a-f]{40}(?:\s+#\s*\S+)?$/u,
  ],
  // tool = "1.2.3" in mise.toml, or "latest" or "lts". A task's run = "..."
  // is not a version, so it fails.
  [/^mise\.toml$/u, /^\s*["\w./:@-]+\s*=\s*"(?:[~^]?v?\d[\w.+-]*|latest|lts)"$/u],
];

/** The added and removed lines of a unified diff, without their `+` or `-`. */
function changedLines(patch: string) {
  return patch
    .split('\n')
    .filter((line) => /^[+-]/u.test(line) && !/^(?:\+\+\+|---) /u.test(line))
    .map((line) => line.slice(1))
    .filter((line) => line.trim() !== '');
}

/** Why a Renovate PR's diff is more than a version bump. None means it passes the bot rule. */
export function renovateProblems(files: Array<ChangedFile>) {
  const problems: Array<string> = [];
  for (const file of files) {
    if (free.some((pattern) => pattern.test(file.filename))) {
      continue;
    }
    const rule = versionOnly.find(([pattern]) => pattern.test(file.filename));
    if (!rule) {
      problems.push(`${file.filename} is not a dependency file.`);
    } else if (file.patch === undefined) {
      problems.push(`${file.filename} has no diff to check.`);
    } else {
      const other = changedLines(file.patch).find((line) => !rule[1].test(line));
      if (other !== undefined) {
        problems.push(`${file.filename} changes more than a version: ${other.trim()}`);
      }
    }
  }
  return problems;
}

/**
 * The bot rule: when a bot's pull request may merge without a person at the
 * `bots` step of auto-merge. A Renovate PR may when its diff changes only
 * dependency versions, lockfiles and changesets. Renovate already waits out
 * the 3-day release age (`minimumReleaseAge` in renovate.json). A gardening
 * PR may when its risk tier is low or medium, and it proposes no rule, or the
 * owner approved its head. A Clutch sync PR may when it changes only what
 * `clutch sync` writes.
 * A revert PR is judged in auto-merge.ts,
 * since it needs the reverted PR. See
 * .agents/skills/deliver/references/pull-requests.md#auto-merge.
 */

/**
 * One changed file of a pull request, from `gh api repos/<repo>/pulls/<n>/files`.
 * GitHub gives no patch for a large file, a binary file or a pure rename.
 * `previous` is the old path of a renamed file.
 */
export type ChangedFile = { filename: string; patch?: string; previous?: string };

/**
 * The bot whose pull request this is, from its head branch, or null. The
 * Revert workflow opens a `revert/<number>` PR as the release bot.
 */
export function botKind(headRefName: string) {
  if (headRefName.startsWith('renovate/')) {
    return 'renovate';
  }
  if (headRefName.startsWith('clutch-sync/')) {
    return 'clutch-sync';
  }
  if (headRefName.startsWith('revert/')) {
    return 'revert';
  }
  return headRefName.startsWith('gardening/') ? 'gardening' : null;
}

/** The number of the pull request that a `revert/<number>` branch reverts, or null. */
export function revertedPr(headRefName: string) {
  return /^revert\/(\d+)$/u.exec(headRefName)?.[1] ?? null;
}

/**
 * The file that skips the line-by-line version check in `renovateProblems`:
 * Renovate's own changeset, `.changeset/renovate-*.md`, is release-note text
 * that runs no code.
 */
const free = [/^\.changeset\/renovate-[\w.-]+\.md$/u];

/** The lockfile, whose package entries `lockfileProblems` checks. */
const lockfile = /^bun\.lock$/u;

/** The npm registry. A package entry with no registry uses it. */
const npmRegistry = 'https://registry.npmjs.org/';

/** A package entry: `"name": ["name@1.2.3", "<registry>", ...`. */
const lockEntry = /^\s*"[^"]+":\s*\["([^"]+)"(?:,\s*"([^"]*)")?/u;

/**
 * Why an added lockfile line points a package away from the npm registry.
 * CI's `bun install --frozen-lockfile` checks that the lockfile matches the
 * package.json versions, but not where a package comes from. So each added
 * package entry must name a version from the npm registry, or a workspace
 * folder of this repository. A git, URL, file or link source fails.
 */
function lockfileProblems(file: string, patch: string) {
  const problems: Array<string> = [];
  for (const line of patch.split('\n').filter((row) => row.startsWith('+'))) {
    const entry = lockEntry.exec(line.slice(1));
    if (!entry) {
      continue;
    }
    const [, spec, registry = ''] = entry;
    const source = spec.slice(spec.lastIndexOf('@') + 1);
    const version = /^v?\d[\w.+-]*$/u.test(source) || source.startsWith('workspace:');
    if (!version) {
      problems.push(`${file} takes ${spec} from outside the npm registry.`);
    } else if (registry !== '' && !registry.startsWith(npmRegistry)) {
      problems.push(`${file} takes ${spec} from ${registry}, not ${npmRegistry}.`);
    }
  }
  return problems;
}

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
    if (lockfile.test(file.filename)) {
      problems.push(
        ...(file.patch === undefined
          ? [`${file.filename} has no diff to check.`]
          : lockfileProblems(file.filename, file.patch)),
      );
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

/**
 * The files that a Clutch sync PR may change besides the managed files in its
 * `.clutch/lineage.json`: the lineage itself, the PR's changeset, clutch.yaml
 * (sync drops an old pin), the files that sync merges (the `merge` rule in
 * Clutch's clutch.files.yaml), and the TypeScript references that `nx sync`
 * writes.
 */
const syncExtras = [
  /^\.clutch\/lineage\.json$/u,
  /^\.changeset\/clutch-sync\.md$/u,
  /^clutch\.yaml$/u,
  /^(?:package\.json|\.gitignore|\.gitattributes|\.claude\/settings\.json|\.codex\/hooks\.json)$/u,
  /(?:^|\/)tsconfig(?:\.[\w-]+)?\.json$/u,
];

/**
 * Why a Clutch sync PR's diff is more than a sync. `managed` holds the managed
 * files that the PR's lineage lists. The lockfile may change, from the npm
 * registry only. None means it passes the bot rule.
 */
export function syncProblems(files: Array<ChangedFile>, managed: ReadonlySet<string>) {
  return files.flatMap((file) => {
    if (lockfile.test(file.filename)) {
      return file.patch === undefined
        ? [`${file.filename} has no diff to check.`]
        : lockfileProblems(file.filename, file.patch);
    }
    if (managed.has(file.filename) || syncExtras.some((pattern) => pattern.test(file.filename))) {
      return [];
    }
    return [`${file.filename} is not a file that clutch sync writes.`];
  });
}

/** The page of review rules. A gardening PR that adds a line to it proposes a rule. */
const reviewRules = 'docs/contributing/review.md';

/**
 * An added line of a patch that is not blank. The patch of the files listing
 * starts at the first hunk and has no `+++` file line, so each line that
 * starts with `+` is an added line. The space class leaves out the line end,
 * so a blank added line never counts.
 */
const addsLine = /^\+[^\S\n]*\S/mu;

/** Why a gardening PR waits for the owner when it proposes a rule. */
export const ruleHold = 'The gardening pass proposes a rule. The owner approves a new rule.';

/**
 * Why a gardening PR may not merge without a person. Its risk tier must be low
 * or medium. It proposes a rule when it adds a line to the review rules, or
 * changes a file that `guardrails` (the patterns of tools/guardrail-files.json)
 * matches. Such a PR waits until the owner approves its head. A PR that only
 * deletes rules merges as before.
 */
export function gardeningProblems(
  files: Array<ChangedFile>,
  tier: string,
  guardrails: Array<string>,
  ownerApproved: boolean,
) {
  const problems: Array<string> = [];
  if (!['low', 'medium'].includes(tier)) {
    problems.push(`The gardening PR's risk tier is ${tier}, not low or medium.`);
  }
  if (ownerApproved) {
    return problems;
  }
  const globs = guardrails.map((pattern) => new Bun.Glob(pattern));
  const guardrail = (name: string) => globs.some((glob) => glob.match(name));
  const rules = files.filter((file) => {
    // A rename away from a rule file removes that rule, so the old path counts too.
    if (
      file.previous === reviewRules ||
      (file.previous !== undefined && guardrail(file.previous))
    ) {
      return true;
    }
    if (file.filename === reviewRules) {
      // With no patch, the PR may add a rule that this code cannot see.
      return file.patch === undefined || addsLine.test(file.patch);
    }
    return guardrail(file.filename);
  });
  if (rules.length > 0) {
    problems.push(`${ruleHold} It changes ${rules.map((file) => file.filename).join(', ')}.`);
  }
  return problems;
}

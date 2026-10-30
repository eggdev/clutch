import { findBase } from '@tools/check-migrations';
import { changesetDir, packageName, parseChangeset } from '@tools/release/changeset';

/**
 * Every merge to main is a release, so each change carries a changeset that
 * says its bump. This check compares the working tree with the same base commit
 * as check-migrations. A change to the tracker alone needs none, and neither
 * does a release, which consumes changesets. See
 * docs/contributing/setup/releases.md.
 */
function git(root: string, ...args: Array<string>) {
  const run = Bun.spawnSync(['git', '-C', root, ...args]);
  return run.exitCode === 0 ? run.stdout.toString().trim() : '';
}

const exempt = (file: string) => file.startsWith('.clutch/') || file.startsWith(`${changesetDir}/`);

/** The commit that release.yml pushes: its subject and its author. */
const releaseSubject = /^chore\(release\): v\d+\.\d+\.\d+$/u;
const releaseAuthor = '41898282+github-actions[bot]@users.noreply.github.com';

/** The files a release writes: the changelog, the root version and the consumed changesets. */
function releaseOutput(status: string, file: string) {
  if (file.startsWith(`${changesetDir}/`)) {
    return status === 'D';
  }
  return status === 'M' && (file === 'CHANGELOG.md' || file === 'package.json');
}

/**
 * Whether the range from `base` only releases. It touches release output and
 * the tracker alone, and it consumes a changeset, or each of its commits is a
 * release commit. Code, a new file or an untracked file is never a release.
 */
function onlyReleases(root: string, base: string, untracked: Array<string>) {
  const changes = git(root, 'diff', '--name-status', '--no-renames', base)
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t') as [string, string]);
  if (
    untracked.length > 0 ||
    !changes.every(([status, file]) => file.startsWith('.clutch/') || releaseOutput(status, file))
  ) {
    return false;
  }
  if (changes.some(([status, file]) => status === 'D' && file.startsWith(`${changesetDir}/`))) {
    return true;
  }
  const commits = git(root, 'log', '--format=%ae%x09%s', `${base}..HEAD`)
    .split('\n')
    .filter(Boolean);
  return (
    commits.length > 0 &&
    commits.every((line) => {
      const [author, subject] = line.split('\t');
      return author === releaseAuthor && releaseSubject.test(subject);
    })
  );
}

export async function checkChangeset(root: string, base: string | null): Promise<Array<string>> {
  if (!base) {
    return [];
  }
  const changed = git(root, 'diff', '--name-only', base).split('\n').filter(Boolean);
  const untracked = git(root, 'ls-files', '--others', '--exclude-standard')
    .split('\n')
    .filter(Boolean);
  const files = [...changed, ...untracked];
  if (!files.some((file) => !exempt(file)) || onlyReleases(root, base, untracked)) {
    return [];
  }
  const name = await packageName(root);
  for (const file of files.filter(
    (item) => item.startsWith(`${changesetDir}/`) && item.endsWith('.md'),
  )) {
    const text = await Bun.file(`${root}/${file}`)
      .text()
      .catch(() => '');
    if (parseChangeset(file, text, name)) {
      return [];
    }
  }
  return [
    `This change has no changeset in ${changesetDir}/. Run mise exec -- bun run pr open, which writes one from the conventional PR title. Or add ${changesetDir}/<name>.md with the frontmatter "clutch": patch, minor or major, and a one-line summary.`,
  ];
}

if (import.meta.main) {
  const root = process.cwd();
  const problems = await checkChangeset(root, findBase(root, process.env.CHECK_BASE));
  if (problems.length > 0) {
    console.error(`Changeset check failed.\n${problems.join('\n')}`);
    process.exit(1);
  }
  console.log('The change carries a changeset, or needs none.');
}

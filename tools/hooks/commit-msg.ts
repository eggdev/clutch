import { readFileSync } from 'node:fs';

/**
 * Commit messages follow Conventional Commits: `type(scope)!: subject`. The type
 * decides the version bump of a release: `fix` is a patch, `feat` is a minor, and
 * `!` is a major. Git's own merge, revert, fixup and squash messages pass.
 * See docs/contributing/setup/checks.md#git-hooks.
 */
export const commitTypes = [
  'feat',
  'fix',
  'docs',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
];

const header = new RegExp(`^(${commitTypes.join('|')})(\\([\\w./-]+\\))?!?: \\S`, 'u');
const gitMade = /^(Merge |Revert "|fixup! |squash! |amend! )/u;
const maxLength = 72;

/** The problem with a commit message or a PR title, or nothing when it follows the convention. */
export function conventionalProblem(message: string) {
  const first =
    message
      .split('\n')
      .find((line) => line.trim() && !line.startsWith('#'))
      ?.trim() ?? '';
  if (gitMade.test(first)) {
    return;
  }
  if (!header.test(first)) {
    return `"${first}" is not a conventional commit. Start with a type, such as "fix: ..." or "feat(cli): ...". Types: ${commitTypes.join(', ')}. Add "!" before ":" for a breaking change.`;
  }
  return first.length > maxLength
    ? `The first line has ${first.length} characters. Keep it to ${maxLength}.`
    : undefined;
}

if (import.meta.main) {
  const file = process.argv[2];
  const problem = file
    ? conventionalProblem(readFileSync(file, 'utf-8'))
    : 'commit-msg: no message file.';
  if (problem) {
    console.error(`commit-msg: ${problem}`);
    process.exit(1);
  }
}

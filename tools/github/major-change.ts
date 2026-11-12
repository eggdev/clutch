import { gh } from '@tools/github/auto-merge-enable';
import type { ChangedFile } from '@tools/github/bot-rule';
import type { Run } from '@tools/github/stack';
import { bumpOf } from '@tools/release/changeset';

/**
 * A pull request is a major change when its title has `!` before the colon, or
 * when a changeset in its diff names a major bump. The owner signs off a major
 * change, so it waits for his approval of the head, whatever its risk tier.
 */

/** The changed files of a pull request, with their diffs. */
export async function changedFiles(
  run: Run,
  repo: string,
  pr: string,
): Promise<Array<ChangedFile>> {
  const out = await gh(
    run,
    'api',
    '--paginate',
    `repos/${repo}/pulls/${pr}/files?per_page=100`,
    '--jq',
    '.[] | {filename, patch}',
  );
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChangedFile);
}

/** Whether a changeset's patch adds a line that names a major bump, such as `'clutch': major`. */
const addsMajor = (patch = '') =>
  patch
    .split('\n')
    .some((line) => line.startsWith('+') && !line.startsWith('+++') && /:\s*major\b/u.test(line));

/** Why pull request `pr` is a major change, or nothing. Each changeset that names a major bump gives one reason. */
export async function majorChange(run: Run, repo: string, pr: string): Promise<Array<string>> {
  const title = await gh(run, 'api', `repos/${repo}/pulls/${pr}`, '--jq', '.title');
  const reasons: Array<string> = [];
  if (bumpOf(title) === 'major') {
    reasons.push('its title has "!" before the colon');
  }
  for (const file of await changedFiles(run, repo, pr)) {
    if (
      file.filename.startsWith('.changeset/') &&
      file.filename.endsWith('.md') &&
      addsMajor(file.patch)
    ) {
      reasons.push(`the changeset ${file.filename} names a major bump`);
    }
  }
  return reasons;
}

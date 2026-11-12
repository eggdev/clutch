import { gh } from '@tools/github/auto-merge-enable';
import type { ChangedFile } from '@tools/github/bot-rule';
import type { Run } from '@tools/github/stack';
import { bumpOf } from '@tools/release/changeset';

/** Whether a changeset's patch adds a line that names a major bump, such as `'clutch': major`. */
const addsMajor = (patch = '') =>
  patch
    .split('\n')
    .some((line) => line.startsWith('+') && !line.startsWith('+++') && /:\s*major\b/u.test(line));

/**
 * Why pull request `pr` is a major change, or nothing. It is one when its title
 * has `!` before the colon, or when a changeset in its `changed` files names a
 * major bump. Each such changeset gives one reason. The owner signs off a major
 * change, so the merge judge holds it for his approval of the head, whatever its
 * risk tier. See `blockers` in `tools/github/auto-merge-rules.ts`.
 */
export async function majorChange(
  run: Run,
  repo: string,
  pr: string,
  changed: Array<ChangedFile>,
): Promise<Array<string>> {
  const title = await gh(run, 'api', `repos/${repo}/pulls/${pr}`, '--jq', '.title');
  const reasons: Array<string> = [];
  if (bumpOf(title) === 'major') {
    reasons.push('its title has "!" before the colon');
  }
  for (const file of changed) {
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

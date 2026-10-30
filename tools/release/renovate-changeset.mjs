/**
 * Renovate runs this as a post-upgrade task (renovate.json), so each Renovate
 * branch carries the changeset that check-changeset asks for. Renovate's
 * container has Node.js but not Bun, so this is plain JavaScript. It reads the
 * branch name and the PR title from the data file that Renovate writes, one per
 * line, and writes a patch changeset named after the branch. See
 * docs/contributing/setup/dependencies.md#renovate.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** The changeset path and text for one Renovate branch. */
export function renovateChangeset(data, name) {
  const [branch = '', ...title] = data.split('\n');
  const slug = branch.trim().replaceAll(/[^\w-]+/gu, '-');
  const summary = title.join(' ').trim() || 'Update dependencies';
  return {
    file: `.changeset/${slug || 'renovate'}.md`,
    text: `---\n"${name}": patch\n---\n\n${summary}\n`,
  };
}

const dataFile = process.env.RENOVATE_POST_UPGRADE_COMMAND_DATA_FILE;
if (dataFile) {
  const { name } = JSON.parse(readFileSync('package.json', 'utf-8'));
  const { file, text } = renovateChangeset(readFileSync(dataFile, 'utf-8'), name);
  writeFileSync(file, text);
}

import { appendFile, writeFile } from 'node:fs/promises';

import { applyRelease } from '@tools/release/changeset';

/**
 * Runs one release in the current folder: the version, CHANGELOG.md and no
 * pending changesets. It writes the changelog section to the notes file, and
 * tells the release workflow the version through GITHUB_OUTPUT.
 */
const notes = process.argv[2];
const result = await applyRelease(process.cwd(), new Date().toISOString().slice(0, 10));
const output = process.env.GITHUB_OUTPUT;
if (result) {
  if (notes) {
    await writeFile(notes, result.section);
  }
  if (output) {
    await appendFile(output, `released=true\nversion=${result.version}\n`);
  }
  console.log(`Release ${result.version}.`);
} else {
  if (output) {
    await appendFile(output, 'released=false\n');
  }
  console.log('No pending changesets, so there is nothing to release.');
}

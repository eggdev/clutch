import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  applyRelease,
  bumpOf,
  changelogSection,
  changesetText,
  nextVersion,
  parseChangeset,
  prependSection,
} from '@tools/release/changeset';
import type { Changeset } from '@tools/release/changeset';

test('a conventional title decides the bump', () => {
  expect(bumpOf('fix(cli): keep the value')).toBe('patch');
  expect(bumpOf('docs: explain it')).toBe('patch');
  expect(bumpOf('feat(sync): add keep or take')).toBe('minor');
  expect(bumpOf('feat(sync)!: drop the pin')).toBe('major');
  expect(bumpOf('fix!: change the exit code')).toBe('major');
});

test('a changeset round-trips, and a file for another package is ignored', () => {
  const text = changesetText('clutch', 'minor', 'feat: add clutch init');
  expect(parseChangeset('.changeset/a.md', text, 'clutch')).toEqual({
    file: '.changeset/a.md',
    bump: 'minor',
    summary: 'feat: add clutch init',
  });
  expect(
    parseChangeset('.changeset/b.md', '---\n"@repo/cli": patch\n---\n\nfix: x\n', 'clutch'),
  ).toBeUndefined();
});

const set = (bump: Changeset['bump'], summary: string): Changeset => ({
  file: `${summary}.md`,
  bump,
  summary,
});

test('the largest bump decides the next version', () => {
  expect(nextVersion('0.0.0', [set('patch', 'a')])).toBe('0.0.1');
  expect(nextVersion('0.3.4', [set('patch', 'a'), set('minor', 'b')])).toBe('0.4.0');
  expect(nextVersion('1.2.3', [set('minor', 'a'), set('major', 'b')])).toBe('2.0.0');
});

test('a section groups the summaries by bump, and the newest section comes first', () => {
  const section = changelogSection('0.4.0', '2026-10-30', [
    set('patch', 'fix: keep the value'),
    set('minor', 'feat: add init'),
  ]);
  expect(section).toBe(
    '## 0.4.0 (2026-10-30)\n\n### Features\n\n- feat: add init\n\n### Fixes and maintenance\n\n- fix: keep the value\n',
  );
  expect(prependSection('# Changelog\n', section)).toBe(`# Changelog\n\n${section}`);
  expect(prependSection(`# Changelog\n\n## 0.3.0 (2026-10-01)\n\n- old\n`, section)).toBe(
    `# Changelog\n\n${section}\n## 0.3.0 (2026-10-01)\n\n- old\n`,
  );
});

test('a release bumps package.json, writes the changelog and removes the changesets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'release-'));
  try {
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'clutch', version: '0.1.0' }),
    );
    await mkdir(path.join(root, '.changeset'));
    await writeFile(
      path.join(root, '.changeset/a.md'),
      changesetText('clutch', 'minor', 'feat: add init'),
    );
    await writeFile(path.join(root, '.changeset/README.md'), '# Changesets\n');
    expect(await applyRelease(root, '2026-10-30')).toMatchObject({ version: '0.2.0' });
    expect(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf-8')).version).toBe(
      '0.2.0',
    );
    expect(await readFile(path.join(root, 'CHANGELOG.md'), 'utf-8')).toContain(
      '## 0.2.0 (2026-10-30)',
    );
    expect(await Bun.file(path.join(root, '.changeset/a.md')).exists()).toBe(false);
    expect(await Bun.file(path.join(root, '.changeset/README.md')).exists()).toBe(true);
    expect(await applyRelease(root, '2026-10-30')).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

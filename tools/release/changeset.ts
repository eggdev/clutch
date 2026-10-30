import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Changesets for Clutch. Each PR adds one file in `.changeset/` with the
 * changesets frontmatter, `"clutch": patch | minor | major`, and a one-line
 * summary. A release folds every pending changeset into one version and one
 * CHANGELOG.md section. See docs/contributing/setup/releases.md.
 */
export const changesetDir = '.changeset';
const releasePackage = 'clutch';

export type Bump = 'patch' | 'minor' | 'major';
export type Changeset = { file: string; bump: Bump; summary: string };

const rank: Record<Bump, number> = { patch: 0, minor: 1, major: 2 };
const header = /^(\w+)(\([^)]*\))?(!)?: /u;

/** The bump that a conventional PR title implies: `!` is major, `feat` is minor, and the rest are patch. */
export function bumpOf(title: string): Bump {
  const match = header.exec(title);
  if (match?.[3]) {
    return 'major';
  }
  return match?.[1] === 'feat' ? 'minor' : 'patch';
}

export function changesetText(bump: Bump, summary: string) {
  return `---\n"${releasePackage}": ${bump}\n---\n\n${summary}\n`;
}

/** Reads one changeset file. Returns nothing when it does not hold a bump for Clutch. */
export function parseChangeset(file: string, text: string): Changeset | undefined {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(text);
  const bump =
    match &&
    new RegExp(`^["']?${releasePackage}["']?:\\s*(patch|minor|major)\\s*$`, 'mu').exec(match[1]);
  return match && bump ? { file, bump: bump[1] as Bump, summary: match[2].trim() } : undefined;
}

async function readChangesets(root: string) {
  let names: Array<string>;
  try {
    names = await readdir(path.join(root, changesetDir));
  } catch {
    return [];
  }
  const changesets: Array<Changeset> = [];
  for (const name of names
    .filter((item) => item.endsWith('.md') && item !== 'README.md')
    .toSorted()) {
    const file = `${changesetDir}/${name}`;
    const parsed = parseChangeset(file, await readFile(path.join(root, file), 'utf-8'));
    if (parsed) {
      changesets.push(parsed);
    }
  }
  return changesets;
}

/** The next version after `current`, for the largest bump of `changesets`. */
export function nextVersion(current: string, changesets: Array<Changeset>) {
  const [major, minor, patch] = current.split('.').map(Number);
  let bump: Bump = 'patch';
  for (const { bump: next } of changesets) {
    if (rank[next] > rank[bump]) {
      bump = next;
    }
  }
  if (bump === 'major') {
    return `${major + 1}.0.0`;
  }
  return bump === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

const headings: Record<Bump, string> = {
  major: 'Breaking changes',
  minor: 'Features',
  patch: 'Fixes and maintenance',
};

/** One CHANGELOG.md section: the version, the date, and the summaries grouped by bump. */
export function changelogSection(version: string, date: string, changesets: Array<Changeset>) {
  const groups = (['major', 'minor', 'patch'] as const)
    .map((bump) => [bump, changesets.filter((item) => item.bump === bump)] as const)
    .filter(([, items]) => items.length > 0)
    .map(
      ([bump, items]) =>
        `### ${headings[bump]}\n\n${items.map((item) => `- ${item.summary}`).join('\n')}`,
    );
  return `## ${version} (${date})\n\n${groups.join('\n\n')}\n`;
}

/** Puts `section` after the title of `changelog`, so the newest release is first. */
export function prependSection(changelog: string, section: string) {
  const title = '# Changelog\n';
  const body = changelog.startsWith(title)
    ? changelog.slice(title.length).replace(/^\n+/u, '')
    : changelog;
  return `${title}\n${section}${body ? `\n${body}` : ''}`;
}

/** Writes the release: the version in package.json, the CHANGELOG.md section, and no pending changesets. */
export async function applyRelease(root: string, date: string) {
  const changesets = await readChangesets(root);
  if (changesets.length === 0) {
    return;
  }
  const manifestPath = path.join(root, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
  const version = nextVersion(manifest.version, changesets);
  manifest.version = version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const changelogPath = path.join(root, 'CHANGELOG.md');
  const changelog = await readFile(changelogPath, 'utf-8').catch(() => '# Changelog\n');
  const section = changelogSection(version, date, changesets);
  await writeFile(changelogPath, prependSection(changelog, section));
  for (const item of changesets) {
    await rm(path.join(root, item.file));
  }
  return { version, section };
}

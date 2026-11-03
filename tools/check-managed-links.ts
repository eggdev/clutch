import { readFileSync } from 'node:fs';
import path from 'node:path';

import { blankFences } from '@tools/docs-files';
import { parse } from 'yaml';

/**
 * What a managed file may link. `clutch sync` replaces a managed file, so its
 * links must resolve in every project that gets it. A managed Markdown link, and
 * a `docs/` page named in a workflow or a devcontainer file, must point at a path
 * that a project gets: a managed or merge path, or a seed that install writes.
 * A capability page is linked by its GitHub URL, because a project's copy is
 * written once at install and can be older than the link. See
 * docs/contributing/capabilities/index.md and clutch.files.yaml.
 */
type Rule = 'managed' | 'merge' | 'seed';
type Entry = { path: string; rule: Rule };
export type FilesList = { files: Array<Entry>; exclude?: Array<string>; retired?: Array<string> };

export const capabilityDocs = 'docs/contributing/capabilities/';
const githubBlob = 'https://github.com/eggdev/clutch/blob/main/';
/** Workflow and devcontainer files name a docs page in plain text, and a reader clicks it. */
const textSurfaces = ['.github/', '.devcontainer/'];

const covers = (entry: string, file: string) =>
  entry.endsWith('/') ? file.startsWith(entry) : file === entry;

/** The rule that decides `file`, or `excluded` or `none` when sync and install never write it. */
export function ruleOf(list: FilesList, file: string): Rule | 'excluded' | 'none' {
  if ((list.exclude ?? []).some((item) => covers(item, file))) {
    return 'excluded';
  }
  const entry = list.files
    .filter((item) => covers(item.path, file))
    .toSorted((a, b) => b.path.length - a.path.length)[0];
  return entry?.rule ?? 'none';
}

/** The repo paths that a managed file names, with the line of each: Markdown link targets, and `docs/` paths in text. */
export function referencesOf(
  file: string,
  content: string,
): Array<{ line: number; target: string }> {
  const references: Array<{ line: number; target: string }> = [];
  const lines = blankFences(content).split('\n');
  for (const [index, text] of lines.entries()) {
    if (file.endsWith('.md')) {
      for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/gu)) {
        const target = match[1].replace(/[?#].*$/u, '');
        if (target && !/^[a-z][a-z0-9+.-]*:/iu.test(target) && !target.startsWith('/')) {
          references.push({
            line: index + 1,
            target: path.normalize(path.join(path.dirname(file), target)),
          });
        }
      }
    }
    if (textSurfaces.some((surface) => file.startsWith(surface))) {
      for (const match of text.matchAll(/(?<![\w./-])(docs\/[\w./-]+\.(?:md|ya?ml))/gu)) {
        references.push({ line: index + 1, target: match[1] });
      }
    }
  }
  return references;
}

/** The problems in the managed files: each link that a project does not get, and each capability page linked by path. */
export function findProblems(
  list: FilesList,
  tracked: Array<string>,
  read: (file: string) => string,
): Array<string> {
  const problems: Array<string> = [];
  for (const file of tracked) {
    const surface = file.endsWith('.md') || textSurfaces.some((prefix) => file.startsWith(prefix));
    if (!surface || ruleOf(list, file) !== 'managed') {
      continue;
    }
    for (const { line, target } of referencesOf(file, read(file))) {
      if (target.startsWith(capabilityDocs)) {
        problems.push(
          `${file}:${line}: links \`${target}\` by path. Link it by its GitHub URL, ${githubBlob}${target}, because a project's copy of a capability page can be older than this link.`,
        );
      } else if (['none', 'excluded'].includes(ruleOf(list, target))) {
        problems.push(
          `${file}:${line}: links \`${target}\`, which sync and install never write, so a project does not get it. Link it by its GitHub URL, or make it a managed or seed path in clutch.files.yaml.`,
        );
      }
    }
  }
  return problems;
}

export async function checkManagedLinks(root: string): Promise<Array<string>> {
  const list = parse(await Bun.file(path.join(root, 'clutch.files.yaml')).text()) as FilesList;
  const listing = await Bun.$`git -C ${root} ls-files`.text();
  const tracked = listing.split('\n').filter(Boolean);
  return findProblems(list, tracked, (file) => readFileSync(path.join(root, file), 'utf-8'));
}

if (import.meta.main) {
  const problems = await checkManagedLinks(process.cwd());
  if (problems.length) {
    console.error(
      [
        `Managed link check failed (${problems.length}).`,
        'A managed file replaces the copy in each project, so its links must resolve there.',
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('Managed files link only to paths that a project gets.');
  }
}

import { parse } from 'yaml';

import { gitBytes, safeRelative, tree } from '@/review-source';
import type { SyncFile, SyncSource } from '@/sync/engine';

const filesList = 'clutch.files.yaml';
/** The record of what the last sync or install wrote, in each project. */
export const lineagePath = '.clutch/lineage.json';
const rules = new Set(['managed', 'merge', 'seed']);

type Entry = { path: string; rule: 'managed' | 'merge' | 'seed'; capability?: string };
type FilesList = {
  version: number;
  baseline?: string;
  files: Array<Entry>;
  retired?: Array<string>;
  exclude?: Array<string>;
};

/** What one Clutch commit puts in a project: managed files for the engine, plus merge and seed files. */
export type ClutchSource = {
  commit: string;
  managed: SyncSource;
  merge: Map<string, SyncFile>;
  seed: Map<string, SyncFile>;
};

const covers = (entry: string, file: string) =>
  entry.endsWith('/') ? file.startsWith(entry) : file === entry;

function checkList(list: FilesList) {
  if (list.version !== 1 || !Array.isArray(list.files)) {
    throw new Error(`${filesList}: expected version: 1 and a files list.`);
  }
  for (const entry of list.files) {
    safeRelative(entry.path);
    if (!rules.has(entry.rule)) {
      throw new Error(
        `${filesList}: ${entry.path} has the rule ${entry.rule}. Use managed, merge or seed.`,
      );
    }
  }
  for (const item of [...(list.retired ?? []), ...(list.exclude ?? [])]) {
    safeRelative(item);
  }
}

/** The rule for `file`: the entry with the longest path that covers it. */
function ruleFor(list: FilesList, file: string) {
  return list.files
    .filter((entry) => covers(entry.path, file))
    .toSorted((a, b) => b.path.length - a.path.length)[0]?.rule;
}

/** Reads `clutch.files.yaml` and the files it names at `revision` in the Clutch checkout `template`. */
export async function loadClutchSource(template: string, revision: string): Promise<ClutchSource> {
  const commitBytes = await gitBytes(template, ['rev-parse', '--verify', `${revision}^{commit}`]);
  const commit = commitBytes.toString().trim();
  const exists = Bun.spawnSync(['git', 'cat-file', '-e', `${commit}:${filesList}`], {
    cwd: template,
  });
  if (exists.exitCode !== 0) {
    throw new Error(
      `Clutch ${commit.slice(0, 12)} has no ${filesList}, so sync cannot read it. Pass --latest, or --to a newer Clutch commit.`,
    );
  }
  const listBytes = await gitBytes(template, ['show', `${commit}:${filesList}`]);
  const list = parse(listBytes.toString()) as FilesList;
  checkList(list);
  const excluded = list.exclude ?? [];
  const all = await tree(
    template,
    commit,
    list.files.map((entry) => entry.path),
  );
  const managed = new Map<string, SyncFile>();
  const merge = new Map<string, SyncFile>();
  const seed = new Map<string, SyncFile>();
  const byRule = { managed, merge, seed };
  for (const [file, content] of all) {
    if (!excluded.some((item) => covers(item, file))) {
      byRule[ruleFor(list, file) ?? 'seed'].set(file, content);
    }
  }
  for (const entry of list.files) {
    if (![...all.keys()].some((file) => covers(entry.path, file))) {
      throw new Error(`${filesList}: ${entry.path} matches no committed file.`);
    }
  }
  let baseline = new Map<string, string>();
  if (list.baseline) {
    safeRelative(list.baseline);
    const bytes = await gitBytes(template, ['show', `${commit}:${list.baseline}`]);
    const parsed = JSON.parse(bytes.toString()) as { files: Record<string, string> };
    baseline = new Map(Object.entries(parsed.files));
  }
  const roots = [
    ...list.files.filter((entry) => entry.rule === 'managed').map((entry) => entry.path),
    ...(list.retired ?? []),
  ];
  return { commit, managed: { files: managed, baseline, roots }, merge, seed };
}

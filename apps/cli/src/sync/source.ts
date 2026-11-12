import { parse } from 'yaml';

import { gitProgram } from '@/git';
import { releaseAt } from '@/release';
import { fingerprint, gitBytes, safeRelative, tree } from '@/review-source';
import type { SyncFile, SyncSource } from '@/sync/engine';
import { pinFile, pinVersion, setPin } from '@/sync/pin';

const filesList = 'clutch.files.yaml';
/** The record of what the last sync or install wrote, in each project. */
export const lineagePath = '.clutch/lineage.json';
const rules = new Set(['managed', 'merge', 'seed']);

type Entry = {
  path: string;
  rule: 'managed' | 'merge' | 'seed';
  capability?: string;
  group?: string;
  /** A seed entry only: sync adds a file here that the project lacks, once. See sync/seed-adds.ts. */
  add_on_sync?: boolean;
};
type FilesList = {
  version: number;
  files: Array<Entry>;
  /** Hashes of older Clutch copies, by path. */
  known?: Record<string, string>;
  retired?: Array<string>;
  exclude?: Array<string>;
};

/** What one Clutch commit puts in a project: managed files for the engine, plus merge and seed files. */
export type ClutchSource = {
  commit: string;
  /** The release tag of `commit`, or null for a commit between releases. */
  release: string | null;
  managed: SyncSource;
  merge: Map<string, SyncFile>;
  seed: Map<string, SyncFile>;
  /** The seed files under an `add_on_sync` entry. Sync adds each one that the project lacks, once. */
  addOnSync: Set<string>;
  /** Clutch's `mise.toml`, whose pin sync moves on its own. See sync/pin.ts. Null when not selected. */
  pin: SyncFile | null;
};

/** Clutch's `mise.toml` with its pin set to the release that it syncs to, so install and sync write the same pin. */
function pinned(file: SyncFile | null, release: string | null): SyncFile | null {
  const text = file?.content.toString();
  const content = text && release ? setPin(text, pinVersion(release)) : null;
  if (!file || content === null) {
    return file;
  }
  return {
    mode: file.mode,
    content: Buffer.from(content),
    hash: fingerprint(file.mode, Buffer.from(content)),
  };
}

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
    if (entry.add_on_sync !== undefined && (entry.add_on_sync !== true || entry.rule !== 'seed')) {
      throw new Error(
        `${filesList}: ${entry.path} has add_on_sync. Only a seed entry takes it, and only as true.`,
      );
    }
  }
  for (const item of [...(list.retired ?? []), ...(list.exclude ?? [])]) {
    safeRelative(item);
  }
}

/** The entry that decides `file`: the one with the longest path that covers it. */
function entryFor(list: FilesList, file: string) {
  return list.files
    .filter((entry) => covers(entry.path, file))
    .toSorted((a, b) => b.path.length - a.path.length)[0];
}

/** Whether `--only` selects this entry: by group, by capability, or by a path under it. */
function selected(entry: Entry | undefined, file: string, only?: string) {
  return (
    !only ||
    entry?.group === only ||
    entry?.capability === only ||
    covers(only.endsWith('/') ? only : `${only}/`, file) ||
    file === only
  );
}

const projectVerify = (file: string) =>
  file.startsWith('.agents/skills/verify/') || file === '.claude/skills/verify';

/**
 * Reads `clutch.files.yaml` and the files it names at `revision` in the Clutch
 * checkout `template`. `only` keeps the entries of one group or capability,
 * or the files under one path.
 */
export async function loadClutchSource(
  template: string,
  revision: string,
  only?: string,
): Promise<ClutchSource> {
  const commitBytes = await gitBytes(template, ['rev-parse', '--verify', `${revision}^{commit}`]);
  const commit = commitBytes.toString().trim();
  const exists = Bun.spawnSync([gitProgram, 'cat-file', '-e', `${commit}:${filesList}`], {
    cwd: template,
  });
  if (exists.exitCode !== 0) {
    throw new Error(
      `Clutch ${commit.slice(0, 12)} has no ${filesList}, so sync cannot read it. Run sync without --to for the latest release, or pass --to a newer release tag.`,
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
  const addOnSync = new Set<string>();
  for (const [file, content] of all) {
    const entry = entryFor(list, file);
    if (!excluded.some((item) => covers(item, file)) && selected(entry, file, only)) {
      if (projectVerify(file)) {
        throw new Error('Project-specific verify must be generated, never distributed by sync.');
      }
      byRule[entry?.rule ?? 'seed'].set(file, content);
      if (entry?.add_on_sync) {
        addOnSync.add(file);
      }
    }
  }
  for (const entry of list.files) {
    if (![...all.keys()].some((file) => covers(entry.path, file))) {
      throw new Error(`${filesList}: ${entry.path} matches no committed file.`);
    }
  }
  // The pin in mise.toml is planned apart from the managed files, so a release never asks about it.
  const release = await releaseAt(template, commit);
  const pin = pinned(managed.get(pinFile) ?? null, release);
  managed.delete(pinFile);
  const baseline = new Map(Object.entries(list.known ?? {}));
  const roots = [
    ...list.files
      .filter(
        (entry) =>
          entry.rule === 'managed' &&
          entry.path !== pinFile &&
          (!only || selected(entry, entry.path, only)),
      )
      .map((entry) => entry.path),
    ...(list.retired ?? []),
  ];
  return {
    commit,
    release,
    managed: { files: managed, baseline, roots },
    merge,
    seed,
    addOnSync,
    pin,
  };
}

import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseDocument } from 'yaml';

import { loadClutchConfig } from '@/clutch-config/load';
import { formatFile, formatText } from '@/format';
import { gitOrThrow } from '@/git';
import { mergers } from '@/install-template';
import { localFile } from '@/review-source';
import { apply, plan, writeEntry } from '@/sync/engine';
import type { Change, SyncFile } from '@/sync/engine';
import { lineagePath, loadClutchSource } from '@/sync/source';

const reviewRecord = '.review/tooling.json';

type Lineage = {
  schemaVersion: 1;
  templateRepo: string;
  templateCommit: string;
  files: Record<string, string>;
  /** Managed files the project kept over Clutch's copy, with the Clutch hash it declined. */
  kept?: Record<string, string>;
};

export type SyncResult = {
  schemaVersion: 1;
  status: 'unchanged' | 'planned' | 'decisions' | 'synced';
  templateCommit: string;
  changes: Array<Change>;
  /** Managed files that the project edited. A person keeps or takes each one with --keep or --take. */
  decisions: Array<string>;
  /** package.json values where Clutch's copy won the merge. */
  mergeClashes: Array<{ file: string; key: string }>;
};

/** The last lineage. A project that only has review tooling starts from `.review/tooling.json`. */
async function readLineage(root: string) {
  const current = await localFile(root, lineagePath);
  const legacy = current ? null : await localFile(root, reviewRecord);
  const record = current ?? legacy;
  const parsed = record ? (JSON.parse(record.content.toString()) as Partial<Lineage>) : {};
  return { previous: current, legacy, files: parsed.files ?? {}, kept: parsed.kept ?? {} };
}

/**
 * Settles the edited managed files. `take` replaces a file with Clutch's copy,
 * or removes it when Clutch dropped it. `keep` leaves it and records the Clutch
 * hash it declined, so the same copy never asks again. The rest stay pending.
 */
function settle(
  planned: Awaited<ReturnType<typeof plan>>,
  files: Map<string, SyncFile>,
  kept: Record<string, string>,
  answers: { keep: Array<string>; take: Array<string> },
) {
  for (const file of [...answers.keep, ...answers.take].filter((id) => !id.includes('#'))) {
    if (!planned.conflicts.includes(file)) {
      throw new Error(
        `${file} needs no decision. Pass --keep or --take only for the files that sync lists.`,
      );
    }
  }
  const nextKept: Record<string, string> = {};
  const pending: Array<string> = [];
  for (const file of planned.conflicts) {
    const theirs = files.get(file);
    if (answers.take.includes(file)) {
      planned.changes.push({ path: file, action: theirs ? 'update' : 'remove' });
    } else if (theirs && (answers.keep.includes(file) || kept[file] === theirs.hash)) {
      nextKept[file] = theirs.hash;
    } else if (!answers.keep.includes(file)) {
      pending.push(file);
    }
  }
  planned.conflicts = pending;
  return nextKept;
}

/** A stable hash of one JSON value, so a kept value is asked again only when Clutch changes it. */
const valueHash = (value: unknown) =>
  new Bun.CryptoHasher('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Plans the merge files. Where the project and Clutch set different values, each
 * clash is a decision named `<file>#<key path>`. `take` lets Clutch's value win.
 * `keep`, or a value kept before that Clutch has not changed, keeps the project's.
 */
async function planMerges(
  root: string,
  merge: Map<string, SyncFile>,
  answers: { keep: Array<string>; take: Array<string> },
  kept: Record<string, string>,
) {
  const writes = new Map<string, string>();
  const changes: Array<Change> = [];
  const clashes: SyncResult['mergeClashes'] = [];
  const inspected = new Map<string, string | null>();
  const decisions: Array<string> = [];
  const asked = new Set<string>();
  const nextKept: Record<string, string> = {};
  for (const [file, theirs] of merge) {
    const mine = await localFile(root, file);
    inspected.set(file, mine?.hash ?? null);
    const template = theirs.content.toString();
    const fn = mergers[path.basename(file)];
    const own = mine?.content.toString().trimEnd() ?? '';
    const keepPaths = new Set<string>();
    for (const clash of mine ? fn(own, template).conflicts : []) {
      const id = `${file}#${clash.path}`;
      asked.add(id);
      if (answers.take.includes(id)) {
        continue;
      }
      if (answers.keep.includes(id) || kept[id] === valueHash(clash.template)) {
        keepPaths.add(clash.path);
        nextKept[id] = valueHash(clash.template);
      } else {
        decisions.push(id);
      }
    }
    const merged = mine
      ? fn(own, template, (key) => keepPaths.has(key))
      : { content: template, conflicts: [] };
    const content = file.endsWith('.json')
      ? await formatText(root, file, merged.content)
      : merged.content;
    clashes.push(...merged.conflicts.map((conflict) => ({ file, key: conflict.path })));
    if (content !== mine?.content.toString()) {
      writes.set(file, content);
      changes.push({ path: file, action: mine ? 'update' : 'add' });
    }
  }
  for (const id of [...answers.keep, ...answers.take].filter((answer) => answer.includes('#'))) {
    if (!asked.has(id)) {
      throw new Error(`${id} needs no decision. Pass --keep or --take only for what sync lists.`);
    }
  }
  return { writes, changes, clashes, inspected, decisions, kept: nextKept };
}

/** `clutch.yaml` with `template.commit` set to `commit`, or nothing when it already matches. */
async function pinnedConfig(root: string, commit: string) {
  const config = await localFile(root, 'clutch.yaml');
  if (!config) {
    return null;
  }
  const doc = parseDocument(config.content.toString());
  if (doc.getIn(['template', 'commit']) === commit) {
    return null;
  }
  doc.setIn(['template', 'commit'], commit);
  return doc.toString();
}

const under = (roots: Array<string>, file: string) =>
  roots.some((root) => (root.endsWith('/') ? file.startsWith(root) : file === root));

/** Entries of `record` that a sync scoped to `roots` must keep as they are. */
function outside(record: Record<string, string>, roots: Array<string> | null) {
  return roots
    ? Object.fromEntries(Object.entries(record).filter(([file]) => !under(roots, file)))
    : {};
}

/** The lineage after this sync. A scoped sync keeps the records of the files outside its scope. */
function nextLineage(input: {
  repo: string | undefined;
  source: Awaited<ReturnType<typeof loadClutchSource>>;
  lineage: Awaited<ReturnType<typeof readLineage>>;
  scope: Array<string> | null;
  kept: Record<string, string>;
}): Lineage {
  const { source, lineage, scope } = input;
  const next: Lineage = {
    schemaVersion: 1,
    templateRepo: input.repo ?? '',
    templateCommit: source.commit,
    files: {
      ...outside(lineage.files, scope),
      ...Object.fromEntries([...source.managed.files].map(([file, entry]) => [file, entry.hash])),
    },
  };
  const kept = { ...outside(lineage.kept, scope), ...input.kept };
  if (Object.keys(kept).length > 0) {
    next.kept = kept;
  }
  return next;
}

/** The changes to the lineage, the pin in clutch.yaml and the old review record. */
function recordChanges(
  lineage: Awaited<ReturnType<typeof readLineage>>,
  lineageText: string,
  pinned: string | null,
): Array<Change> {
  const changes: Array<Change> = [];
  if (lineage.previous?.content.toString() !== lineageText) {
    changes.push({ path: lineagePath, action: lineage.previous ? 'update' : 'add' });
  }
  if (pinned) {
    changes.push({ path: 'clutch.yaml', action: 'update' });
  }
  if (lineage.legacy) {
    changes.push({ path: reviewRecord, action: 'remove' });
  }
  return changes;
}

/** Writes the merged files, the lineage and the new pin, after the engine wrote the managed files. */
async function writeRest(
  root: string,
  merged: Map<string, string>,
  lineageText: string,
  pinned: string | null,
  legacy: boolean,
) {
  for (const [file, content] of merged) {
    await writeFile(path.join(root, file), content);
    if (file.endsWith('.json')) {
      await formatFile(root, file);
    }
  }
  await writeEntry(root, lineagePath, {
    mode: '100644',
    content: Buffer.from(lineageText),
    hash: '',
  });
  if (pinned) {
    await writeFile(path.join(root, 'clutch.yaml'), pinned);
  }
  if (legacy) {
    await unlink(path.join(root, reviewRecord));
  }
}

/**
 * Moves the project at `root` to the Clutch commit `to`, read from the Clutch
 * checkout `template`. Without `to`, it uses the commit that `clutch.yaml`
 * pins, or the checkout's HEAD. Seed files are never touched.
 */
export async function runSync(options: {
  root: string;
  template: string;
  to?: string;
  check?: boolean;
  keep?: Array<string>;
  take?: Array<string>;
  /** Sync only the entries of one group or capability, or the files under one path. */
  only?: string;
}): Promise<SyncResult> {
  const root = await gitOrThrow(options.root, 'rev-parse', '--show-toplevel');
  const loaded = await loadClutchConfig(root);
  const config = loaded.kind === 'loaded' ? loaded.config : undefined;
  const source = await loadClutchSource(
    options.template,
    options.to ?? config?.template.commit ?? 'HEAD',
    options.only,
  );
  const lineage = await readLineage(root);
  // A scoped sync plans only its own files, and keeps the lineage of the rest.
  const scope = options.only ? source.managed.roots : null;
  const record = scope
    ? Object.fromEntries(Object.entries(lineage.files).filter(([file]) => under(scope, file)))
    : lineage.files;
  const managed = await plan(
    root,
    source.managed,
    { files: record },
    lineagePath,
    lineage.previous,
  );
  const kept = settle(managed, source.managed.files, lineage.kept, {
    keep: options.keep ?? [],
    take: options.take ?? [],
  });
  const answers = { keep: options.keep ?? [], take: options.take ?? [] };
  const merges = await planMerges(root, source.merge, answers, lineage.kept);
  const next = nextLineage({
    repo: config?.template.repo,
    source,
    lineage,
    scope,
    kept: { ...kept, ...merges.kept },
  });
  const lineageText = `${JSON.stringify(next, null, 2)}\n`;
  const pinned = scope ? null : await pinnedConfig(root, source.commit);
  const changes = [
    ...managed.changes,
    ...merges.changes,
    ...recordChanges(lineage, lineageText, pinned),
  ];
  if (lineage.legacy) {
    managed.inspected.set(reviewRecord, lineage.legacy.hash);
  }
  const result: SyncResult = {
    schemaVersion: 1,
    status: 'unchanged',
    templateCommit: source.commit,
    changes,
    decisions: [...managed.conflicts, ...merges.decisions],
    mergeClashes: merges.clashes,
  };
  if (result.decisions.length > 0) {
    return { ...result, status: 'decisions' };
  }
  if (changes.length === 0) {
    return result;
  }
  if (options.check) {
    return { ...result, status: 'planned' };
  }
  for (const [file, hash] of merges.inspected) {
    managed.inspected.set(file, hash);
  }
  await apply(root, source.managed, managed, lineagePath);
  await writeRest(root, merges.writes, lineageText, pinned, lineage.legacy !== null);
  return { ...result, status: 'synced' };
}

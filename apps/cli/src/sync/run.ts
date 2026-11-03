import { existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseDocument } from 'yaml';

import { loadClutchConfig } from '@/clutch-config/load';
import { formatFile } from '@/format';
import { gitOrThrow } from '@/git';
import { latestRelease } from '@/release';
import { localFile } from '@/review-source';
import { apply, plan, writeEntry } from '@/sync/engine';
import type { Change, SyncFile } from '@/sync/engine';
import { planMerges } from '@/sync/merges';
import { pinFile, planPinFile } from '@/sync/pin';
import type { PinAnswer } from '@/sync/pin';
import { seedChangesSince } from '@/sync/seed-changes';
import type { SeedChange } from '@/sync/seed-changes';
import { lineagePath, loadClutchSource } from '@/sync/source';
import type { ClutchSource } from '@/sync/source';

const reviewRecord = '.review/tooling.json';

type Lineage = {
  schemaVersion: 1;
  templateRepo: string;
  templateCommit: string;
  /** The Clutch release of `templateCommit`. Absent for a commit between releases. */
  release?: string;
  files: Record<string, string>;
  /** Managed files the project kept over Clutch's copy, with the Clutch hash it declined. */
  kept?: Record<string, string>;
};

export type SyncResult = {
  schemaVersion: 1;
  status: 'unchanged' | 'planned' | 'decisions' | 'synced';
  templateCommit: string;
  /** The Clutch release that the sync targets, or null for a commit between releases. */
  release: string | null;
  /** The sync targets the latest release, not a `--to` revision. */
  latest: boolean;
  /** The Clutch release of the last sync, from `.clutch/lineage.json`, or null. */
  from: string | null;
  changes: Array<Change>;
  /** Managed files that the project edited. A person keeps or takes each one with --keep or --take. */
  decisions: Array<string>;
  /** package.json values where Clutch's copy won the merge. */
  mergeClashes: Array<{ file: string; key: string }>;
  /** Project-owned pages whose Clutch copy changed since the last sync. Information only. See sync/seed-changes.ts. */
  seedChanges: Array<SeedChange>;
  /** Why seedChanges could not be read, or null. */
  seedChangesNote: string | null;
};

/** The last lineage. A project that only has review tooling starts from `.review/tooling.json`. */
async function readLineage(root: string) {
  const current = await localFile(root, lineagePath);
  const legacy = current ? null : await localFile(root, reviewRecord);
  const record = current ?? legacy;
  const parsed = record ? (JSON.parse(record.content.toString()) as Partial<Lineage>) : {};
  return {
    previous: current,
    legacy,
    files: parsed.files ?? {},
    kept: parsed.kept ?? {},
    release: parsed.release ?? null,
  };
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

/** `clutch.yaml` without the pin that an older copy has, or nothing when it has none. */
async function unpinnedConfig(root: string) {
  const config = await localFile(root, 'clutch.yaml');
  if (!config) {
    return null;
  }
  const doc = parseDocument(config.content.toString());
  if (!doc.hasIn(['template', 'commit'])) {
    return null;
  }
  doc.deleteIn(['template', 'commit']);
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
  pinHash: string | undefined;
}): Lineage {
  const { source, lineage, scope } = input;
  const next: Lineage = {
    schemaVersion: 1,
    templateRepo: input.repo ?? '',
    templateCommit: source.commit,
    ...(source.release ? { release: source.release } : {}),
    files: {
      ...outside(lineage.files, scope),
      ...Object.fromEntries([...source.managed.files].map(([file, entry]) => [file, entry.hash])),
      ...(input.pinHash ? { [pinFile]: input.pinHash } : {}),
    },
  };
  const kept = { ...outside(lineage.kept, scope), ...input.kept };
  if (Object.keys(kept).length > 0) {
    next.kept = kept;
  }
  return next;
}

/** The changes to the lineage, the old pin in clutch.yaml and the old review record. */
function recordChanges(
  lineage: Awaited<ReturnType<typeof readLineage>>,
  lineageText: string,
  unpinned: string | null,
): Array<Change> {
  const changes: Array<Change> = [];
  if (lineage.previous?.content.toString() !== lineageText) {
    changes.push({ path: lineagePath, action: lineage.previous ? 'update' : 'add' });
  }
  if (unpinned) {
    changes.push({ path: 'clutch.yaml', action: 'update' });
  }
  if (lineage.legacy) {
    changes.push({ path: reviewRecord, action: 'remove' });
  }
  return changes;
}

/** Writes the merged files, the pin, the lineage and clutch.yaml without its old pin, after the engine wrote the managed files. */
async function writeRest(
  root: string,
  merged: Map<string, string>,
  lineageText: string,
  unpinned: string | null,
  legacy: boolean,
  pinText: string | null,
) {
  for (const [file, content] of merged) {
    // A fresh project may not have the folder yet, such as .codex/.
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
    if (file.endsWith('.json')) {
      await formatFile(root, file);
    }
  }
  if (pinText !== null) {
    await writeFile(path.join(root, pinFile), pinText);
  }
  await writeEntry(root, lineagePath, {
    mode: '100644',
    content: Buffer.from(lineageText),
    hash: '',
  });
  if (unpinned) {
    await writeFile(path.join(root, 'clutch.yaml'), unpinned);
  }
  if (legacy) {
    await unlink(path.join(root, reviewRecord));
  }
}

/** The owner's answer for the pin, if any. */
function pinAnswer(answers: { keep: Array<string>; take: Array<string> }): PinAnswer {
  if (answers.keep.includes(pinFile)) {
    return 'keep';
  }
  return answers.take.includes(pinFile) ? 'take' : undefined;
}

/** The pin's part of a sync: its plan, and the text to write when the file changes. */
async function pinStep(
  root: string,
  source: ClutchSource,
  lineage: Awaited<ReturnType<typeof readLineage>>,
  scope: Array<string> | null,
  answers: { keep: Array<string>; take: Array<string> },
) {
  const answer = pinAnswer(answers);
  const pin = scope
    ? null
    : await planPinFile(root, {
        template: source.pin,
        release: source.release,
        recorded: lineage.files[pinFile],
        kept: lineage.kept[pinFile],
        answer,
      });
  const answered = [...answers.keep, ...answers.take].includes(pinFile);
  if (answered && !pin?.plan.asked) {
    throw new Error(
      `${pinFile} needs no decision. Pass --keep or --take only for the files that sync lists.`,
    );
  }
  const content = pin?.plan.content ?? null;
  const changed = content !== null && content !== (pin?.file?.content.toString() ?? null);
  return {
    planned: pin !== null,
    file: pin?.file ?? null,
    text: changed ? content : null,
    changed,
    decision: pin?.plan.decision === true,
    kept: pin?.plan.kept,
    hash: pin?.plan.hash ?? lineage.files[pinFile],
  };
}

/** A folder counts when the project has it, or when this sync writes a file in it. */
const deliveredFolder = (root: string, source: ClutchSource) => (folder: string) =>
  existsSync(path.join(root, folder)) ||
  [...source.managed.files.keys()].some((file) => file.startsWith(folder));

/** The lineage entries that the managed plan records. The pin is planned apart, so its entry is not in the plan. */
function managedRecord(
  lineage: Awaited<ReturnType<typeof readLineage>>,
  scope: Array<string> | null,
) {
  const record = scope
    ? Object.fromEntries(Object.entries(lineage.files).filter(([file]) => under(scope, file)))
    : lineage.files;
  return Object.fromEntries(Object.entries(record).filter(([file]) => file !== pinFile));
}

/**
 * Moves the project at `root` to the Clutch revision `to`, read from the Clutch
 * checkout `template`. Without `to`, it uses the latest Clutch release. Seed
 * files are never touched.
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
  const repo = config?.template.repo;
  const source = await loadClutchSource(
    options.template,
    options.to ?? (await latestRelease(options.template)),
    options.only,
  );
  const lineage = await readLineage(root);
  // A scoped sync plans only its own files, and keeps the lineage of the rest.
  const scope = options.only ? source.managed.roots : null;
  const answers = { keep: options.keep ?? [], take: options.take ?? [] };
  const managed = await plan(
    root,
    source.managed,
    { files: managedRecord(lineage, scope) },
    lineagePath,
    lineage.previous,
  );
  const kept = settle(managed, source.managed.files, lineage.kept, {
    keep: answers.keep.filter((file) => file !== pinFile),
    take: answers.take.filter((file) => file !== pinFile),
  });
  const merges = await planMerges(
    root,
    source.merge,
    answers,
    lineage.kept,
    deliveredFolder(root, source),
  );
  const pin = await pinStep(root, source, lineage, scope, answers);
  const next = nextLineage({
    repo,
    source,
    lineage,
    scope,
    kept: {
      ...kept,
      ...merges.kept,
      ...(pin.kept === undefined ? {} : { [pinFile]: pin.kept }),
    },
    pinHash: pin.hash,
  });
  const lineageText = `${JSON.stringify(next, null, 2)}\n`;
  const unpinned = scope ? null : await unpinnedConfig(root);
  const changes = [
    ...managed.changes,
    ...merges.changes,
    ...(pin.changed ? [{ path: pinFile, action: pin.file ? 'update' : 'add' } as const] : []),
    ...recordChanges(lineage, lineageText, unpinned),
  ];
  if (lineage.legacy) {
    managed.inspected.set(reviewRecord, lineage.legacy.hash);
  }
  const seeds = await seedChangesSince({
    root,
    template: options.template,
    from: lineage.release,
    source,
    repo,
  });
  const result: SyncResult = {
    schemaVersion: 1,
    status: 'unchanged',
    templateCommit: source.commit,
    release: source.release,
    latest: options.to === undefined,
    from: lineage.release,
    changes,
    decisions: [...managed.conflicts, ...merges.decisions, ...(pin.decision ? [pinFile] : [])],
    mergeClashes: merges.clashes,
    seedChanges: seeds.changes,
    seedChangesNote: seeds.note,
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
  if (pin.planned) {
    managed.inspected.set(pinFile, pin.file?.hash ?? null);
  }
  await apply(root, source.managed, managed, lineagePath);
  await writeRest(root, merges.writes, lineageText, unpinned, lineage.legacy !== null, pin.text);
  return { ...result, status: 'synced' };
}

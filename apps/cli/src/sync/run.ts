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
import {
  managedRecord,
  nextLineage,
  readLineage,
  recordChanges,
  reviewRecord,
} from '@/sync/lineage';
import type { ProjectLineage } from '@/sync/lineage';
import { planMerges } from '@/sync/merges';
import { pinFile, planPinFile } from '@/sync/pin';
import type { PinAnswer } from '@/sync/pin';
import { seedAdds } from '@/sync/seed-adds';
import { seedChangesSince } from '@/sync/seed-changes';
import type { SeedChange } from '@/sync/seed-changes';
import { lineagePath, loadClutchSource } from '@/sync/source';
import type { ClutchSource } from '@/sync/source';

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

/** Writes the merged files, the new seed files, the pin, the lineage and clutch.yaml without its old pin, after the engine wrote the managed files. */
async function writeRest(
  root: string,
  merged: Map<string, string>,
  seeds: Map<string, SyncFile>,
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
  for (const [file, entry] of seeds) {
    await writeEntry(root, file, entry);
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
  lineage: ProjectLineage,
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

/**
 * Adds the files that sync writes outside the managed plan to `inspected`, so
 * apply checks them before its first write: each merge file, each new seed
 * file, which must still be absent, and the pin.
 */
function inspectOthers(
  inspected: Map<string, string | null>,
  merged: Map<string, string | null>,
  seeds: Map<string, SyncFile>,
  pin: Awaited<ReturnType<typeof pinStep>>,
) {
  for (const [file, hash] of merged) {
    inspected.set(file, hash);
  }
  for (const file of seeds.keys()) {
    inspected.set(file, null);
  }
  if (pin.planned) {
    inspected.set(pinFile, pin.file?.hash ?? null);
  }
}

/**
 * Moves the project at `root` to the Clutch revision `to`, read from the Clutch
 * checkout `template`. Without `to`, it uses the latest Clutch release. Sync
 * never changes a seed file. It adds a new one once, as sync/seed-adds.ts says.
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
  const added = await seedAdds(root, source, lineage.seeded);
  const changes = [
    ...managed.changes,
    ...merges.changes,
    ...[...added.keys()].map((file) => ({ path: file, action: 'add' }) as const),
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
  inspectOthers(managed.inspected, merges.inspected, added, pin);
  await apply(root, source.managed, managed, lineagePath);
  await writeRest(
    root,
    merges.writes,
    added,
    lineageText,
    unpinned,
    lineage.legacy !== null,
    pin.text,
  );
  return { ...result, status: 'synced' };
}

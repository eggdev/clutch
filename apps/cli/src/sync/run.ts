import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseDocument } from 'yaml';

import { loadClutchConfig } from '@/clutch-config/load';
import { formatFile, formatText } from '@/format';
import { gitOrThrow } from '@/git';
import { mergers } from '@/install-template';
import { localFile } from '@/review-source';
import { apply, plan, writeEntry } from '@/sync/engine';
import type { Change, SyncFile } from '@/sync/engine';
import { loadClutchSource } from '@/sync/source';

export const lineagePath = '.clutch/lineage.json';
const reviewRecord = '.review/tooling.json';

type Lineage = {
  schemaVersion: 1;
  templateRepo: string;
  templateCommit: string;
  files: Record<string, string>;
};

export type SyncResult = {
  schemaVersion: 1;
  status: 'unchanged' | 'planned' | 'decisions' | 'synced';
  templateCommit: string;
  changes: Array<Change>;
  /** Managed files that the project edited. A person decides to keep or take each one (CL-013b). */
  decisions: Array<string>;
  /** package.json values where Clutch's copy won the merge. */
  mergeClashes: Array<{ file: string; key: string }>;
};

/** The last lineage. A project that only has review tooling starts from `.review/tooling.json`. */
async function readLineage(root: string) {
  const current = await localFile(root, lineagePath);
  const legacy = current ? null : await localFile(root, reviewRecord);
  const record = current ?? legacy;
  const files = record
    ? (JSON.parse(record.content.toString()) as { files: Record<string, string> }).files
    : {};
  return { previous: current, files: files ?? {} };
}

async function planMerges(root: string, merge: Map<string, SyncFile>) {
  const writes = new Map<string, string>();
  const changes: Array<Change> = [];
  const clashes: SyncResult['mergeClashes'] = [];
  const inspected = new Map<string, string | null>();
  for (const [file, theirs] of merge) {
    const mine = await localFile(root, file);
    inspected.set(file, mine?.hash ?? null);
    const template = theirs.content.toString();
    const merged = mine
      ? mergers[path.basename(file)](mine.content.toString().trimEnd(), template)
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
  return { writes, changes, clashes, inspected };
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
}): Promise<SyncResult> {
  const root = await gitOrThrow(options.root, 'rev-parse', '--show-toplevel');
  const loaded = await loadClutchConfig(root);
  const config = loaded.kind === 'loaded' ? loaded.config : undefined;
  const source = await loadClutchSource(
    options.template,
    options.to ?? config?.template.commit ?? 'HEAD',
  );
  const lineage = await readLineage(root);
  const managed = await plan(
    root,
    source.managed,
    { files: lineage.files },
    lineagePath,
    lineage.previous,
  );
  const merges = await planMerges(root, source.merge);
  const next: Lineage = {
    schemaVersion: 1,
    templateRepo: config?.template.repo ?? '',
    templateCommit: source.commit,
    files: Object.fromEntries([...source.managed.files].map(([file, entry]) => [file, entry.hash])),
  };
  const lineageText = `${JSON.stringify(next, null, 2)}\n`;
  const pinned = await pinnedConfig(root, source.commit);
  const changes = [...managed.changes, ...merges.changes];
  if (lineage.previous?.content.toString() !== lineageText) {
    changes.push({ path: lineagePath, action: lineage.previous ? 'update' : 'add' });
  }
  if (pinned) {
    changes.push({ path: 'clutch.yaml', action: 'update' });
  }
  const result: SyncResult = {
    schemaVersion: 1,
    status: 'unchanged',
    templateCommit: source.commit,
    changes,
    decisions: managed.conflicts,
    mergeClashes: merges.clashes,
  };
  if (managed.conflicts.length > 0) {
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
  for (const [file, content] of merges.writes) {
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
  return { ...result, status: 'synced' };
}

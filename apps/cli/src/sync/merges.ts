import path from 'node:path';

import { formatText } from '@/format';
import { mergers } from '@/install-template';
import { localFile } from '@/review-source';
import type { Change, SyncFile } from '@/sync/engine';

/** The merged files of a sync: their writes, changes, clashes and decisions. See run.ts. */
export type MergeAnswers = { keep: Array<string>; take: Array<string> };

/** A stable hash of one JSON value, so a kept value is asked again only when Clutch changes it. */
const valueHash = (value: unknown) =>
  new Bun.CryptoHasher('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Plans the merge files. Where the project and Clutch set different values, each
 * clash is a decision named `<file>#<key path>`. `take` lets Clutch's value win.
 * `keep`, or a value kept before that Clutch has not changed, keeps the project's.
 */
export async function planMerges(
  root: string,
  merge: Map<string, SyncFile>,
  answers: MergeAnswers,
  kept: Record<string, string>,
  delivered: (folder: string) => boolean,
) {
  const writes = new Map<string, string>();
  const changes: Array<Change> = [];
  const clashes: Array<{ file: string; key: string }> = [];
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
      ? fn(own, template, (key) => keepPaths.has(key), delivered)
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

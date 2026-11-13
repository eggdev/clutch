import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { ManifestChange } from '@repo/sync/contract/change-doors';
import type { Manifest } from '@repo/sync/contract/manifest';
import type { Finding } from '@tools/findings';

/**
 * The rules of the committed contract snapshot, `contract.json`, for the
 * contract check in tools/check-contract.ts. See
 * docs/contributing/architecture/contract.md.
 */

/** The committed snapshot: the manifest, the digest of its base, and each one-way change since. */
export type Snapshot = Manifest & {
  readonly since: string | null;
  readonly breaks: ReadonlyArray<string>;
};

export const snapshotFile = 'contract.json';
/** The name of the check, which starts the id of each of its findings. */
export const check = 'check-contract';
export const write = 'mise exec -- bun tools/check-contract.ts --write';
/** The body of a manifest, as the snapshot holds it. */
const bodyOf = (manifest: Manifest) =>
  JSON.stringify([
    manifest.records,
    manifest.commands,
    manifest.loads,
    manifest.jobs,
    manifest.routes,
  ]);

/**
 * The problems of the committed snapshot. `base` is the manifest of the base
 * branch, or nothing when there is none to compare with. `changes` are the
 * differences from `base` to `manifest`.
 */
export function snapshotProblems(
  manifest: Manifest,
  committed: Snapshot | null,
  base: Manifest | null,
  changes: ReadonlyArray<ManifestChange>,
): Array<Finding> {
  if (!committed) {
    return [
      {
        id: `${check}/snapshot-missing`,
        file: snapshotFile,
        problem: 'is missing.',
        fix: `Run \`${write}\`, and commit it.`,
      },
    ];
  }
  if (bodyOf(committed) !== bodyOf(manifest) || committed.digest !== manifest.digest) {
    return [
      {
        id: `${check}/snapshot-stale`,
        file: snapshotFile,
        problem: 'does not match the contracts.',
        fix: `Run \`${write}\`, read the diff, and commit it.`,
      },
    ];
  }
  if (!base || base.digest === manifest.digest) {
    return [];
  }
  const oneWay = changes.filter((change) => change.door === 'one-way');
  const named = new Set(committed.breaks);
  const unnamed = oneWay.filter((change) => !named.has(change.id));
  if (unnamed.length) {
    return [
      {
        id: `${check}/one-way-change-not-named`,
        file: snapshotFile,
        problem: [
          'this change is a one-way door for installed builds. See docs/principles/two-way-doors.md.',
          ...unnamed.map((change) => `  ${change.id}: ${change.says}`),
        ].join('\n'),
        fix: `Keep the old shape, or add the new one beside it. When the owner agreed to the break, run \`${write} --accept-breaks\`.`,
      },
    ];
  }
  const ids = new Set(oneWay.map((change) => change.id));
  if (committed.since !== base.digest || committed.breaks.some((id) => !ids.has(id))) {
    return [
      {
        id: `${check}/breaks-stale`,
        file: snapshotFile,
        problem: '`since` and `breaks` do not describe the change from the base branch.',
        fix: `Run \`${write}\`.`,
      },
    ];
  }
  return [];
}

/** The snapshot that `git` holds at `base`, or nothing when the base has none. */
export function snapshotAt(root: string, base: string): Snapshot | null {
  const run = Bun.spawnSync(['git', '-C', root, 'show', `${base}:${snapshotFile}`]);
  return run.exitCode === 0 ? JSON.parse(run.stdout.toString()) : null;
}

/** The snapshot in the working tree, or nothing when it is missing. */
export function committedSnapshot(root: string): Snapshot | null {
  const file = path.join(root, snapshotFile);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : null;
}

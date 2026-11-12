import { expect, test } from 'bun:test';

import { app, decide, fake, head, merges } from '@tools/github/auto-merge-fake';
import type { Result } from '@tools/github/stack';

const sync = { headRefName: 'clutch-sync/latest', author: app };

const checkRun = (name: string, conclusion: string, id: number) =>
  JSON.stringify({ id, name, status: 'completed', conclusion, app: 'github-actions' });

/** The check runs of the head. `doctor` is the `clutch / doctor` run's conclusion, or null when the run is absent. */
const headChecks = (doctor: string | null, validate: string) =>
  [
    checkRun('validate', validate, 1),
    checkRun('agent-review', 'success', 2),
    ...(doctor === null ? [] : [checkRun('clutch / doctor', doctor, 3)]),
  ].join('\n');

const headRuns = (doctor: string | null, validate = 'success'): [string, Partial<Result>] => [
  `gh api --paginate repos/eggdev/clutch/commits/${head}/check-runs`,
  { out: headChecks(doctor, validate) },
];

/** The lineage at the head: a sync PR's managed files, none of which the pure sync fixtures change. */
const lineage: [string, Partial<Result>] = ['git show', { out: '{"files":{}}' }];

const syncFiles = (
  files: Array<{ filename: string; patch: string }>,
): [string, Partial<Result>] => [
  'gh api --paginate repos/eggdev/clutch/pulls/7/files',
  { out: files.map((file) => JSON.stringify(file)).join('\n') },
];

test('a sync with a file that clutch sync does not write holds', async () => {
  const gh = fake(
    [
      headRuns('success'),
      lineage,
      syncFiles([{ filename: 'apps/web/src/main.ts', patch: '+evil' }]),
    ],
    sync,
  );
  expect(await decide(gh, { mode: 'on', step: 'bots' })).toEqual([
    'Would not auto-merge at the step bots:\n- apps/web/src/main.ts is not a file that clutch sync writes.',
  ]);
  expect(merges(gh.calls)).toEqual([]);
});

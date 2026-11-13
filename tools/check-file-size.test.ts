import { expect, test } from 'bun:test';

import { checkFileSize } from '@tools/check-file-size';
import { formatFinding } from '@tools/findings';
import { inRepo } from '@tools/testing/in-repo';

/** The text that the check prints for each finding at `root`. */
async function fileSizeText(root: string) {
  const findings = await checkFileSize(root);
  return findings.map(formatFinding);
}

/** A file of `count` short lines. */
const sourceLines = (count: number) => 'x\n'.repeat(count);

test('file size holds AGENTS.md to 20 lines and each source file to the limit or its reasoned budget', async () => {
  const budgets = {
    limit: 10,
    files: {
      'tools/deep.ts': { lines: 15, reason: 'One parser with shared state.' },
      'tools/grown.ts': { lines: 12, reason: 'One plugin.' },
      'tools/small.ts': { lines: 20, reason: 'Was large.' },
      'tools/silent.ts': { lines: 20, reason: ' ' },
      'tools/gone.ts': { lines: 20, reason: 'Deleted.' },
    },
  };
  const findings = await inRepo(
    {
      'AGENTS.md': sourceLines(21),
      'tools/file-size-budgets.json': JSON.stringify(budgets),
      'tools/deep.ts': sourceLines(15),
      'tools/grown.ts': sourceLines(13),
      'tools/small.ts': sourceLines(10),
      'tools/silent.ts': sourceLines(11),
      'tools/large.ts': sourceLines(11),
      'packages/x/node_modules/dep.js': sourceLines(50),
    },
    checkFileSize,
  );
  // An id names the kind of problem. It stays when the message is reworded.
  expect(findings.map((finding) => [finding.id, finding.file])).toEqual([
    ['check-file-size/agents-file-over-budget', 'AGENTS.md'],
    ['check-file-size/budget-for-missing-file', 'tools/file-size-budgets.json'],
    ['check-file-size/over-budget', 'tools/grown.ts'],
    ['check-file-size/over-limit', 'tools/large.ts'],
    ['check-file-size/budget-without-reason', 'tools/silent.ts'],
    ['check-file-size/budget-not-needed', 'tools/small.ts'],
  ]);
  expect(findings.map(formatFinding)).toEqual([
    'AGENTS.md: 21 lines, budget 20. Move detail to the page that owns it.',
    'tools/file-size-budgets.json: tools/gone.ts does not exist. Delete its entry.',
    'tools/grown.ts: 13 lines, budget 12. Split the file, or raise the budget and update its reason in the same change.',
    'tools/large.ts: 11 lines, limit 10. Split the file, or add an entry with a reason to tools/file-size-budgets.json.',
    'tools/silent.ts: the budget entry has no reason. Say why the file stays deep.',
    'tools/small.ts: 10 lines is within the limit of 10. Delete its budget entry.',
  ]);
});

test('file size skips files that Git ignores, such as build output', async () => {
  expect(
    await inRepo(
      {
        '.gitignore': 'dist/\n',
        'tools/file-size-budgets.json': JSON.stringify({
          limit: 10,
          files: {},
        }),
        'apps/web/dist/bundle.js': sourceLines(50),
        'apps/web/src/large.ts': sourceLines(11),
      },
      (root) => {
        Bun.spawnSync(['git', 'init', '-q'], { cwd: root });
        return fileSizeText(root);
      },
    ),
  ).toEqual([
    'apps/web/src/large.ts: 11 lines, limit 10. Split the file, or add an entry with a reason to tools/file-size-budgets.json.',
  ]);
});

test('file size holds a nested AGENTS.md to 20 lines', async () => {
  expect(await inRepo({ 'apps/demo/AGENTS.md': sourceLines(21) }, fileSizeText)).toEqual([
    'apps/demo/AGENTS.md: 21 lines, budget 20. Move detail to the page that owns it.',
  ]);
});

test('file size accepts a nested AGENTS.md of 20 lines', async () => {
  expect(await inRepo({ 'apps/demo/AGENTS.md': sourceLines(20) }, fileSizeText)).toEqual([]);
});

test('file size holds the root AGENTS.md to 20 lines', async () => {
  expect(await inRepo({ 'AGENTS.md': sourceLines(21) }, fileSizeText)).toEqual([
    'AGENTS.md: 21 lines, budget 20. Move detail to the page that owns it.',
  ]);
});

test('file size skips an AGENTS.md under node_modules', async () => {
  expect(await inRepo({ 'node_modules/x/AGENTS.md': sourceLines(21) }, fileSizeText)).toEqual([]);
});

test('file size skips an AGENTS.md that Git ignores', async () => {
  expect(
    await inRepo({ '.gitignore': 'vendor/\n', 'vendor/x/AGENTS.md': sourceLines(21) }, (root) => {
      Bun.spawnSync(['git', 'init', '-q'], { cwd: root });
      return fileSizeText(root);
    }),
  ).toEqual([]);
});

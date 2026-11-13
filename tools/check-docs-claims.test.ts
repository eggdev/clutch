import { expect, test } from 'bun:test';

import { checkDocsClaims, findClaims, findPrincipleGaps } from '@tools/check-docs-claims';
import type { Enforcers } from '@tools/check-docs-claims';
import { inRepo } from '@tools/testing/in-repo';

const enforcers: Enforcers = {
  names: new Set([
    'check-file-size',
    'no-reexports',
    'repo-imports/no-reexports',
    'guard-guardrails',
  ]),
  root: '/nowhere',
};
const problems = (content: string, file = 'docs/contributing/a.md') =>
  findClaims(file, content, enforcers).map((claim) => `${claim.line}: ${claim.problem}`);

test('a claim that names no enforcer fails, from a real doc that promised a missing check', () => {
  expect(
    problems(
      '# Soft delete\n\n- Each query goes through one helper. A check rejects a query that skips the helper.\n',
    ),
  ).toEqual([
    '3: "A check rejects a query that skips the helper." claims enforcement but names no check, lint rule, test or hook that exists.',
  ]);
  expect(problems('A change that breaks a budget fails CI.\n')).toHaveLength(1);
  expect(problems('A test fails when a table that grows has no retention rule.\n')).toHaveLength(1);
});

test('a named enforcer that does not exist fails, and one that exists passes', () => {
  expect(problems('`check-retention` rejects a table with no retention rule.\n')).toEqual([
    '1: `check-retention` is not a check target, lint rule, test file or agent hook.',
  ]);
  expect(problems('`check-file-size` rejects a file over its budget.\n')).toEqual([]);
  expect(problems('`repo-imports/no-reexports` rejects each `export ... from`.\n')).toEqual([]);
  expect(problems('Codex cannot ask. `guard-guardrails` refuses the edit.\n')).toEqual([]);
});

test('plain words for real targets back a claim, and prose that only mentions a test passes', () => {
  expect(problems('A test global in production code fails the typecheck.\n')).toEqual([]);
  expect(problems('A rule that lint or a check can reject belongs in that tool.\n')).toEqual([]);
  expect(
    problems('The test declares it with `using`, so cleanup runs even when an assertion fails.\n'),
  ).toEqual([]);
  expect(problems('A test sets flag state through the Test Layer.\n')).toEqual([]);
});

test('decision records and kickoff slots are skipped', () => {
  const claim = 'A check rejects a query that skips the helper.\n';
  expect(problems(claim, 'docs/contributing/decisions/0001-x.md')).toEqual([]);
  expect(problems(`<!-- kickoff: ${claim} -->\n`)).toEqual([]);
});

test('the check reads targets, lint rules and hooks from the repository', async () => {
  expect(
    await inRepo(
      {
        'package.json': JSON.stringify({ nx: { targets: { 'check-file-size': {} } } }),
        'oxlint.config.ts': "export default { rules: { 'repo-imports/no-reexports': 'error' } };",
        '.agents/hooks/guard-guardrails.ts': '',
        'docs/contributing/a.md':
          '`check-file-size` rejects big files. `no-reexports` rejects re-exports. `guard-guardrails` refuses edits.\n\nA check rejects a missing helper.\n',
      },
      checkDocsClaims,
    ),
  ).toEqual([
    'docs/contributing/a.md:3: "A check rejects a missing helper." claims enforcement but names no check, lint rule, test or hook that exists.',
  ]);
});

const principlesTable = (rows: string) =>
  `| Principle | When to open it | Held by |\n| --- | --- | --- |\n${rows}`;
const gaps = (pages: Array<string>, rows: string, review = '') =>
  findPrincipleGaps(pages, principlesTable(rows), review, enforcers);

test('each principle page needs a row, and the message names the page', () => {
  expect(gaps(['a.md', 'b.md'], '| [A](./a.md) | Always | `check-file-size` |\n')).toEqual([
    'docs/principles/index.md: docs/principles/b.md has no row. Add one with its `Held by` cell.',
  ]);
});

test('a Held by cell that is empty or names a missing check fails', () => {
  expect(gaps(['a.md'], '| [A](./a.md) | Always |  |\n')).toEqual([
    'docs/principles/index.md:3: a.md has an empty `Held by` cell. Name the check, lint rule or test that holds it, in backticks, or write `Review only`.',
  ]);
  expect(gaps(['a.md'], '| [A](./a.md) | Always | `check-retention` (only part) |\n')).toEqual([
    'docs/principles/index.md:3: a.md: `check-retention` in its `Held by` cell is not a check target, lint rule, test file or agent hook.',
  ]);
  expect(
    gaps(['a.md'], '| [A](./a.md) | Always | `check-file-size`, `repo-imports/no-reexports` |\n'),
  ).toEqual([]);
});

test('a table with no Held by column leaves each of its rows empty', () => {
  expect(
    findPrincipleGaps(
      ['a.md'],
      '| Principle | When |\n| --- | --- |\n| [A](./a.md) | Always |\n',
      '',
      enforcers,
    ),
  ).toHaveLength(1);
});

test('a Review only principle needs its rule on the review page', () => {
  const row = '| [A](./a.md) | Always | Review only |\n';
  expect(gaps(['a.md'], row)).toEqual([
    'docs/principles/index.md:3: a.md is `Review only`, so docs/contributing/review.md needs its rule and a link to its page.',
  ]);
  expect(gaps(['a.md'], row, 'See [a](../principles/a.md).')).toEqual([]);
});

test('the check reads the principles index and its pages from the repository', async () => {
  expect(
    await inRepo(
      {
        'package.json': JSON.stringify({ nx: { targets: { 'check-file-size': {} } } }),
        'docs/principles/index.md': principlesTable(
          '| [A](./a.md) | Always | `check-file-size` |\n',
        ),
        'docs/principles/a.md': '# A\n',
        'docs/principles/new-rule.md': '# New rule\n',
      },
      checkDocsClaims,
    ),
  ).toEqual([
    'docs/principles/index.md: docs/principles/new-rule.md has no row. Add one with its `Held by` cell.',
  ]);
});

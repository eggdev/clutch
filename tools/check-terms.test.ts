import { expect, test } from 'bun:test';

import { checkTerms, findTerms, glossary, parseTerms } from '@tools/check-terms';
import { inRepo } from '@tools/testing/in-repo';

const table = [
  '# Glossary',
  '',
  '## Rejected words',
  '',
  '| Word          | Use instead |',
  '| ------------- | ----------- |',
  '| `mutation`    | command     |',
  '| `e.g.`        | for example |',
  '| `in order to` | to          |',
  '| `—`           | a period    |',
  '',
  '## Next',
  '',
  '| `ignored` | not in the table |',
].join('\n');

test('the glossary table is the list, and rows outside it are not', () => {
  expect(parseTerms(table).map((term) => term.word)).toEqual([
    'mutation',
    'e.g.',
    'in order to',
    '—',
  ]);
});

test('a rejected word fails in prose, and passes in code, links, comments and compounds', () => {
  const terms = parseTerms(table);
  const doc = [
    'A Mutation changes the store.',
    'Use a list, e.g. this one, in order to ship.',
    `One idea — then another.`,
    'The `mutation` field, [a link](./mutation.md) and mutation-testing pass.',
    '<!-- kickoff: the mutation queue -->',
    '```ts',
    'const mutation = 1;',
    '```',
  ].join('\n');
  expect(findTerms('docs/a.md', doc, terms).map((m) => `${m.line}:${m.column} ${m.word}`)).toEqual([
    '1:3 mutation',
    '2:13 e.g.',
    '2:28 in order to',
    '3:10 —',
  ]);
  expect(findTerms(glossary, doc, terms)).toEqual([]);
});

test('the check names each match with its replacement, and fails on a missing table', async () => {
  expect(
    await inRepo({ [glossary]: table, 'AGENTS.md': 'Define the mutation once.\n' }, checkTerms),
  ).toEqual(['AGENTS.md:1:12: `mutation`. Use command.']);
  expect(await inRepo({ [glossary]: '# Glossary\n', 'AGENTS.md': '' }, checkTerms)).toEqual([
    `${glossary}: the "Rejected words" table is missing or empty. Restore it.`,
  ]);
});

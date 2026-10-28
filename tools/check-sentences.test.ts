import { expect, test } from 'bun:test';

import { checkSentences, countWords, findLongSentences } from '@tools/check-sentences';
import { inRepo } from '@tools/testing/in-repo';

/** A long sentence from the docs before the rule: a list folded into one sentence. */
const folded =
  'A change is one-way when a copy outlives the deploy: a migration that ran, a\nsaved document on a device, a request shape that an installed build sends, a\nlink in a sent email, or deleted user data.\n';

test('inline code counts as one word, and a link counts as its text', () => {
  expect(
    countWords('Run `mise exec -- bun run validate` and read [the checks page](./checks.md).'),
  ).toBe(7);
});

test('a folded list fails with its line, and the same facts as a list pass', () => {
  expect(findLongSentences('docs/principles/two-way-doors.md', `# Doors\n\n${folded}`)).toEqual([
    'docs/principles/two-way-doors.md:3: 38 words, "A change is one-way when a copy outlives the deploy: a migra…"',
  ]);
  expect(
    findLongSentences(
      'docs/principles/two-way-doors.md',
      'A change is one-way when a copy outlives the deploy. Examples are:\n\n- a migration that ran\n- a saved document on a device\n',
    ),
  ).toEqual([]);
});

test('a bold lead sentence ends a sentence, and code, comments and tables are prose apart', () => {
  const page = [
    '---',
    `summary: ${'word '.repeat(30)}`,
    '---',
    '',
    '- **The gate settles needs before the first render.** It asks the system for a permission at the tap, and it waits for the record.',
    '',
    '```ts',
    `const long = '${'word '.repeat(30)}';`,
    '```',
    '',
    `<!-- kickoff: ${'word '.repeat(30)} -->`,
    '',
    '| Short cell | Another short cell |',
    '| ---------- | ------------------ |',
  ].join('\n');
  expect(findLongSentences('docs/principles/one-gate-per-feature.md', page)).toEqual([]);
});

test('only docs/ is checked, and decision records are skipped', async () => {
  expect(
    await inRepo(
      {
        'docs/principles/two-way-doors.md': folded,
        'docs/contributing/decisions/0001-a.md': folded,
        'AGENTS.md': folded,
        '.agents/skills/kickoff/SKILL.md': folded,
      },
      checkSentences,
    ),
  ).toEqual([
    'docs/principles/two-way-doors.md:1: 38 words, "A change is one-way when a copy outlives the deploy: a migra…"',
  ]);
});

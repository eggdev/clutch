import { expect, test } from 'bun:test';

import type { ClutchConfig } from '@/clutch-config/schema';
import { checkIntakeDoc, readIntakeSection } from '@/factory/intake-doc';
import { gitRepo } from '@/testing/git-repo';

const section = (github = '`factory`', linear = 'no label', tracker = '`status: todo`') =>
  [
    '# Tracker',
    '',
    '## Ready for the factory',
    '',
    `- GitHub: an issue with the label ${github}.`,
    `- Linear: ${linear}.`,
    `- Tracker: an issue file with ${tracker} and \`owner: agent\`, outside \`later\`.`,
    '',
    '## Frontmatter',
    '',
    '- GitHub: `not-this-section`.',
    '',
  ].join('\n');

const config = (intake?: Partial<Record<'github' | 'linear' | 'tracker', Array<string>>>) =>
  ({
    schemaVersion: 1,
    project: 'shop',
    template: { repo: 'eggdev/clutch', mode: 'sync' },
    capabilities: {},
    ...(intake
      ? { factory: { intake: { github: ['factory'], linear: [], tracker: ['todo'], ...intake } } }
      : {}),
  }) as ClutchConfig;

async function check(readme: string | null, settings?: ClutchConfig) {
  await using repo = await gitRepo(readme === null ? {} : { '.clutch/README.md': readme }, {
    git: false,
  });
  return checkIntakeDoc(repo.root, settings);
}

test('readIntakeSection reads each line of its own section only', () => {
  expect(readIntakeSection(section('`factory`, `agent`', '`Agent`'))).toEqual({
    github: ['factory', 'agent'],
    linear: ['Agent'],
    tracker: ['todo'],
  });
  expect(readIntakeSection('# Tracker\n\n## Frontmatter\n')).toBeNull();
});

test('a section that names the same values as factory.intake passes', async () => {
  expect(await check(section(), config({}))).toEqual([]);
  expect(await check(section())).toEqual([]);
  expect(
    await check(
      section('`factory`', '`Agent`', '`status: todo`, `status: blocked`'),
      config({
        linear: ['Agent'],
        tracker: ['blocked', 'todo'],
      }),
    ),
  ).toEqual([]);
});

test('a section that disagrees with factory.intake fails, and names the key and both values', async () => {
  expect(await check(section('`agent`'), config({}))).toEqual([
    {
      file: '.clutch/README.md',
      key: 'github',
      reason:
        'The section names `agent`, and factory.intake.github in clutch.yaml names `factory`.',
    },
  ]);
  const [linear] = await check(section(), config({ linear: ['Agent'] }));
  expect(linear?.reason).toBe(
    'The section names none, and factory.intake.linear in clutch.yaml names `Agent`.',
  );
  const [tracker] = await check(section('`factory`', 'none', '`status: review`'));
  expect(tracker?.reason).toBe(
    'The section names `review`, and the default factory.intake.tracker names `todo`.',
  );
});

test('factory.intake needs the section, and a section needs each line', async () => {
  const [noSection] = await check('# Tracker\n', config({}));
  const [noFile] = await check(null, config({}));
  expect([noSection?.key, noFile?.key]).toEqual(['', '']);
  expect(await check('# Tracker\n')).toEqual([]);
  expect(await check(null)).toEqual([]);
  const lines = section().replace(/^- Linear:.*\n/mu, '');
  expect(await check(lines, config({}))).toEqual([
    {
      file: '.clutch/README.md',
      key: 'linear',
      reason: 'The "Ready for the factory" section has no "- Linear:" line.',
    },
  ]);
});

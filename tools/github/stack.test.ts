import { expect, test } from 'bun:test';

import { ghVersion, pinnedGh, stackChain, stackExtensionVersion } from '@tools/github/stack';

test('the pinned gh comes from mise.toml, and the running one from gh --version', () => {
  expect(pinnedGh('[tools]\n# The GitHub CLI.\ngh = "2.103.3"\nbun = "1.4.2"\n')).toBe('2.103.3');
  expect(pinnedGh('[tools]\nbun = "1.4.2"\n')).toBeUndefined();
  expect(ghVersion('gh version 2.45.0 (2026-03-17 Ubuntu)\nhttps://github.com/cli/cli')).toBe(
    '2.45.0',
  );
});

test('the stack extension version comes from its row in gh extension list', () => {
  expect(
    stackExtensionVersion('gh stack\tgithub/gh-stack\tv0.3.0\ngh dash\tdlvhdr/gh-dash\tv4.0.0'),
  ).toBe('v0.3.0');
  expect(stackExtensionVersion('')).toBeUndefined();
});

const prs: Record<string, { number: number; base: string }> = {
  'cl-003': { number: 8, base: 'main' },
  'cl-004': { number: 9, base: 'cl-003' },
  'cl-007': { number: 10, base: 'cl-004' },
};
const lookup = (branch: string) => Promise.resolve(prs[branch]);

test('the chain under a base runs from the bottom PR up to the base', async () => {
  expect(await stackChain('cl-007', 'main', lookup)).toEqual([8, 9, 10]);
  expect(await stackChain('main', 'main', lookup)).toEqual([]);
});

test('a base with no open PR stops the chain with the fix', async () => {
  await expect(stackChain('cl-099', 'main', lookup)).rejects.toThrow(
    'No open PR has the head cl-099. Open that PR first, or pass --base main.',
  );
});

import { expect, test } from 'bun:test';

import { fake, head } from '@tools/github/auto-merge-fake';
import { contractBreaks } from '@tools/github/contract-breaks';
import type { Result } from '@tools/github/stack';

const contract = 'gh api repos/eggdev/clutch/contents/contract.json';

/** The changed files that `contractBreaks` reads, as `changedFiles` gives them. */
const changed = (...names: Array<string>) => names.map((filename) => ({ filename, patch: '' }));

/** A snapshot of the head that names `breaks`. */
const snapshot = (breaks: unknown): [string, Partial<Result>] => [
  contract,
  { out: JSON.stringify({ breaks }) },
];

const breaksOf = (gh: ReturnType<typeof fake>, ...names: Array<string>) =>
  contractBreaks(gh.run, 'eggdev/clutch', changed(...names), head);

test('contractBreaks gives each name the snapshot of the head names under breaks', async () => {
  const two = fake([snapshot(['A.one', 'B.two'])]);
  expect(await breaksOf(two, 'contract.json')).toEqual(['A.one', 'B.two']);
  expect(two.calls.find((call) => call.startsWith(contract))).toContain(`?ref=${head}`);
  expect(await breaksOf(fake([snapshot([])]), 'contract.json')).toEqual([]);
});

test('contractBreaks has no breaks when the head has no contract snapshot', async () => {
  const missing = fake([[contract, { ok: false, err: 'gh: Not Found (HTTP 404)' }]]);
  expect(await breaksOf(missing, 'contract.json')).toEqual([]);
});

test('contractBreaks refuses a snapshot whose breaks is not a list of strings', async () => {
  await expect(breaksOf(fake([snapshot('Note.title')]), 'contract.json')).rejects.toThrow(
    `contract.json at ${head}: \`breaks\` is not a list of strings.`,
  );
  await expect(breaksOf(fake([snapshot(['A', 1])]), 'contract.json')).rejects.toThrow(
    `contract.json at ${head}`,
  );
});

test('a pull request that does not change contract.json has no breaks, also when the snapshot of its head names one', async () => {
  const gh = fake([snapshot(['Note.title'])]);
  expect(await breaksOf(gh, 'bun.lock')).toEqual([]);
  expect(gh.calls.some((call) => call.startsWith(contract))).toBe(false);
});

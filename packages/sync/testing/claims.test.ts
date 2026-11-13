import { expect, test } from 'bun:test';

import { command, localChange } from '@repo/sync/contract/command';
import type { Tool } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { oneOf, text } from '@repo/sync/contract/fields';
import { proveClaims } from '@repo/sync/testing/claims';
import { testModel } from '@repo/sync/testing/pool-state';

const card = testModel('Card', { id: 'string', title: text({ max: 20, min: 1 }) });

const tool = (does: Tool['does'], idempotent = true): Tool => ({
  does,
  idempotent,
  closed: true,
  says: 'A test command.',
});

const rename = command('cards/rename', {
  input: { id: 'string', title: text({ max: 20, min: 1 }) },
  waits: 'local',
  access: 'organization',
  refuses: [],
  tool: tool('changes'),
});

/** A contract of one `cards/rename` command, with the local change given. */
function cards(change: Parameters<typeof localChange<'cards/rename', typeof rename.input>>[1]) {
  return {
    contract: defineContract('cards', { records: [card], commands: [rename], loads: [] }),
    localChanges: [localChange(rename, change)],
  };
}

const keeps = cards((draft, input) => {
  const current = draft.get(card, input.id);
  if (current) {
    draft.put(card, { ...current, title: input.title });
  }
});

test('a contract whose commands keep their claims passes, and says what it checked', () => {
  // The test names its seed, so a person who sets CLAIMS_SEED gets the same result.
  const report = proveClaims(keeps, { seed: 532 });
  expect(report.seed).toBe(532);
  expect(report.checked).toEqual([
    'cards/rename: a valid input is taken (40 runs)',
    'cards/rename: does changes (40 runs)',
    'cards/rename: idempotent (40 runs)',
    'cards/rename: limits of each input field (6 inputs)',
  ]);
  expect(report.unchecked).toContain(
    'cards/rename: closed, because whether it reaches an outside service is not visible on the pool',
  );
});

test('a command that is not idempotent fails, and the message names the seed and the input', () => {
  const grows = cards((draft, input) => {
    const current = draft.get(card, input.id);
    if (current) {
      draft.put(card, { ...current, title: `${current.title}!`.slice(0, 20) });
    }
  });
  const run = () => proveClaims(grows, { seed: 7 });
  expect(run).toThrow('The contract cards breaks its claims (seed 7).');
  expect(run).toThrow(/idempotent, run \d+: a second run of the same input changed the records/u);
  expect(run).toThrow(/Input: \{"id":"k\d"/u);
  expect(run).toThrow('Run the same inputs again with CLAIMS_SEED=7.');
});

test('the same seed makes the same inputs, so a failure repeats', () => {
  const grows = cards((draft, input) => {
    draft.put(card, { id: input.id, title: input.title });
    draft.remove(card, 'k1');
  });
  const message = (seed: number) => {
    try {
      proveClaims(grows, { seed });
      return '';
    } catch (error) {
      return String(error);
    }
  };
  expect(message(3)).toContain('does: changes');
  expect(message(3)).toBe(message(3));
  expect(message(3)).not.toBe(message(4));
});

test('a command that never does what it claims fails, and is not skipped', () => {
  const idle = cards(() => {
    // It changes nothing, though it claims to change a card.
  });
  expect(() => proveClaims(idle, { seed: 532 })).toThrow(
    'no generated input made it change a record, so the claim is not proven',
  );
});

test('a command for which no valid input can be made fails loudly', () => {
  const pick = command('cards/pick', {
    input: { status: oneOf() },
    waits: 'server',
    access: 'organization',
    refuses: [],
    tool: 'none',
  });
  const contract = defineContract('cards', { records: [card], commands: [pick], loads: [] });
  const run = () => proveClaims({ contract, localChanges: [] }, { seed: 532 });
  expect(run).toThrow(
    'valid input, run 0: the proof can make no valid input: `oneOf` names no value.\n',
  );
  expect(run).not.toThrow('..');
});

test('the seed comes from CLAIMS_SEED when the test names none', () => {
  const saved = process.env.CLAIMS_SEED;
  process.env.CLAIMS_SEED = '9';
  try {
    expect(proveClaims(keeps).seed).toBe(9);
    expect(proveClaims(keeps, { seed: 4 }).seed).toBe(4);
  } finally {
    if (saved === undefined) {
      delete process.env.CLAIMS_SEED;
    } else {
      process.env.CLAIMS_SEED = saved;
    }
  }
});

test('a local change that throws fails the claim of its run, with the input, and not as no valid input', () => {
  const throws = cards((draft, input) => {
    if (draft.get(card, input.id)) {
      throw new Error('the local change broke');
    }
  });
  const run = () => proveClaims(throws, { seed: 532 });
  expect(run).toThrow(/ run \d+: the run threw an error: [^\n]*the local change broke/u);
  expect(run).toThrow(/Input: \{"id":"k\d"/u);
  expect(run).not.toThrow('no valid input');
});

test('an idempotent command whose second run is refused fails, as a refused run proves nothing', () => {
  // The local change empties its saved input, so the same input again no longer fits and is refused.
  const empties = cards((draft, input) => {
    const current = draft.get(card, input.id);
    if (current) {
      draft.put(card, { ...current, title: input.title });
    }
    Object.assign(input, { title: '' });
  });
  const run = () => proveClaims(empties, { seed: 532 });
  expect(run).toThrow(
    /idempotent, run \d+: the pool refused a second run of the same input, so the claim is not proven\.\n {4}Input: \{"id":"k\d","title":""\}/u,
  );
  expect(run).not.toThrow('does: changes');
});

import type { CommandDeclaration, Replayable } from '@repo/sync/contract/command';
import type { Contract } from '@repo/sync/contract/define';
import { matches, stamped } from '@repo/sync/contract/fields';
import type { CallOf, Fields } from '@repo/sync/contract/fields';
import type { Model, RecordDeclaration, RecordRow } from '@repo/sync/contract/record';
import { createPool } from '@repo/sync/runtime/pool';
import type { Pool } from '@repo/sync/runtime/pool';
import { breaches, validInput, validRecord, words } from '@repo/sync/testing/claim-inputs';
import { poolState, testStamps } from '@repo/sync/testing/pool-state';
import { seeded } from '@repo/sync/testing/seeded';
import type { Random } from '@repo/sync/testing/seeded';

/**
 * The proof of the claims of a contract. A command claims what it `does`,
 * whether it is `idempotent`, and the limits of each input field. This runs
 * each command on an object pool with inputs made from its declared fields,
 * and checks each claim that a machine can decide. The claims stay in the
 * contract: nothing here lists them. See
 * docs/contributing/architecture/contract.md#claims.
 */

/** The seed of a run that names none. A person sets another with `CLAIMS_SEED`. */
const defaultClaimsSeed = 532;

/** The runs of each command with valid inputs, unless a test names another count. */
const defaultRuns = 40;

/** The time that the pool stamps on each run, so each run of a seed gives the same records. */
const runTime = '2026-01-01T00:00:00.000Z';

/** The claims that this proof does not check, by field of the declaration. */
const notChecked = {
  closed: 'whether it reaches an outside service is not visible on the pool',
  says: 'it is words for a reader',
  refuses: 'only the server half refuses with a code',
  access: 'only the server decides who may run it',
  permission: 'only the server reads the role of the actor',
} as const;

/** What `proveClaims` checked, so a test or a person can read it. */
export type ClaimsReport = {
  readonly seed: number;
  readonly checked: ReadonlyArray<string>;
  readonly unchecked: ReadonlyArray<string>;
};

/** The two parts of a client package that the proof takes: the contract and its local changes. */
export type Proven = {
  readonly contract: Contract;
  readonly localChanges: ReadonlyArray<Replayable>;
};

/** Each record of the contract that the pool shows, by `<record> <id>`. */
type View = ReadonlyMap<string, string>;

/** What one run did to the records that the pool shows. */
type Effect = {
  readonly added: ReadonlyArray<string>;
  readonly changed: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
};

/** A record declaration of any fields, read as a model of plain records with an ID. */
function modelOf(declared: RecordDeclaration): Model<RecordRow> {
  return {
    ...declared,
    is: (row: unknown): row is RecordRow => declared.is(row) && typeof row.id === 'string',
  };
}

function viewOf(pool: Pool, contract: Contract): View {
  const view = new Map<string, string>();
  for (const declared of contract.records) {
    const model = modelOf(declared);
    for (const id of pool.ids(model)) {
      view.set(`${declared.name} ${id}`, JSON.stringify(pool.get(model, id)));
    }
  }
  return view;
}

function effectOf(before: View, after: View): Effect {
  return {
    added: [...after.keys()].filter((key) => !before.has(key)),
    changed: [...after.keys()].filter(
      (key) => before.has(key) && before.get(key) !== after.get(key),
    ),
    removed: [...before.keys()].filter((key) => !after.has(key)),
  };
}

const isEmpty = (effect: Effect) =>
  effect.added.length + effect.changed.length + effect.removed.length === 0;

const described = (effect: Effect) =>
  isEmpty(effect)
    ? 'it changed nothing'
    : `it added ${JSON.stringify(effect.added)}, changed ${JSON.stringify(effect.changed)} and removed ${JSON.stringify(effect.removed)}`;

/** A pool that holds, for each record of the contract, a record for some of the `words` IDs. */
function poolWithRecords(random: Random, proven: Proven): Pool {
  const pool = createPool(proven.localChanges, proven.contract, {
    stamps: testStamps(runTime),
    report: (line) => {
      throw new Error(`The object pool reported: ${line}`);
    },
  });
  const tables: Record<string, Array<RecordRow>> = {};
  for (const declared of proven.contract.records) {
    tables[declared.name] = words
      .filter(() => random() < 0.7)
      .map((id) => validRecord(random, declared, id));
  }
  pool.load(poolState({ lastSyncId: 1, tables, groups: ['claims'] }));
  return pool;
}

/** Runs a command with an input that the compiler did not see, as an agent or a saved copy sends it. */
function runWith(
  pool: Pool,
  command: CommandDeclaration,
  input: Readonly<Record<string, unknown>>,
) {
  const call: CallOf<Fields> = input;
  return pool.run(command, call);
}

const refusedAt = (pool: Pool, id: string) => pool.lastRejection()?.transactionId === id;

/** A per-command generator, so the inputs of one command do not move when another is added. */
function generatorOf(seed: number, name: string): Random {
  let hash = 0x81_1c_9d_c5;
  for (const char of name) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01_00_01_93);
  }
  return seeded(seed ^ hash);
}

/** Whether one run broke the claim that `does` makes, and whether the run acted at all. */
function doesHolds(does: 'adds' | 'changes' | 'removes', effect: Effect) {
  switch (does) {
    case 'adds': {
      return {
        broken: effect.changed.length + effect.removed.length > 0,
        acted: effect.added.length > 0,
      };
    }
    case 'changes': {
      return { broken: effect.removed.length > 0, acted: effect.changed.length > 0 };
    }
    case 'removes': {
      return { broken: effect.added.length > 0, acted: effect.removed.length > 0 };
    }
  }
}

type Checker = {
  readonly fail: (claim: string, run: number, input: unknown, why: string) => void;
  readonly checked: Array<string>;
  readonly unchecked: Array<string>;
};

/** Checks that each input outside a declared limit is refused, and that it changes nothing. */
function proveLimits(random: Random, proven: Proven, command: CommandDeclaration, check: Checker) {
  let count = 0;
  for (const [field, kind] of Object.entries(command.input)) {
    for (const breach of breaches(random, kind)) {
      const pool = poolWithRecords(random, proven);
      // A value of `undefined` breaks the limit by leaving the field out.
      const input = Object.fromEntries(
        Object.entries({ ...validInput(random, command.input), [field]: breach.value }).filter(
          ([, value]) => value !== undefined,
        ),
      );
      const claim = `limits: ${field} ${breach.breaks}`;
      if (matches(command.input, stamped(command.input, input, testStamps(runTime)))) {
        check.fail(
          claim,
          count,
          input,
          'the proof made this input to break the limit, but it fits. This is a bug in the proof.',
        );
        continue;
      }
      const before = viewOf(pool, proven.contract);
      const id = runWith(pool, command, input);
      const effect = effectOf(before, viewOf(pool, proven.contract));
      if (!refusedAt(pool, id) || pool.isPending(id) || !isEmpty(effect)) {
        check.fail(claim, count, input, `the pool did not refuse it, and ${described(effect)}`);
      }
      count += 1;
    }
  }
  check.checked.push(`${command.name}: limits of each input field (${count} inputs)`);
}

/** Runs valid inputs, and checks `does` and `idempotent` on the local change of the command. */
function proveRuns(
  random: Random,
  proven: Proven,
  command: CommandDeclaration,
  runs: number,
  check: Checker,
) {
  const { tool } = command;
  let acted = false;
  for (let run = 1; run <= runs; run += 1) {
    const pool = poolWithRecords(random, proven);
    const input = validInput(random, command.input);
    const before = viewOf(pool, proven.contract);
    const first = runWith(pool, command, input);
    if (refusedAt(pool, first) || !pool.isPending(first)) {
      check.fail(
        'valid input',
        run,
        input,
        'the pool refused an input that fits each declared field',
      );
      return;
    }
    const once = viewOf(pool, proven.contract);
    if (command.waits !== 'local' || tool === 'none') {
      continue;
    }
    const effect = effectOf(before, once);
    const does = doesHolds(tool.does, effect);
    acted ||= does.acted;
    if (does.broken) {
      check.fail(`does: ${tool.does}`, run, input, described(effect));
    }
    if (tool.idempotent) {
      // The same input is the input with the stamps that the first run filled.
      const saved = pool.snapshot().pending.find((transaction) => transaction.id === first)?.input;
      const filled =
        typeof saved === 'object' && saved !== null
          ? Object.fromEntries(Object.entries(saved))
          : input;
      runWith(pool, command, filled);
      const again = effectOf(once, viewOf(pool, proven.contract));
      if (!isEmpty(again)) {
        check.fail(
          'idempotent',
          run,
          filled,
          `a second run of the same input changed the records: ${described(again)}`,
        );
      }
    }
  }
  check.checked.push(`${command.name}: a valid input is taken (${runs} runs)`);
  if (command.waits === 'local' && tool !== 'none') {
    if (!acted) {
      check.fail(
        `does: ${tool.does}`,
        runs,
        null,
        `no generated input made it ${tool.does.replace(/s$/u, '')} a record, so the claim is not proven. Give its input fields kinds from which the proof can make such an input.`,
      );
    }
    check.checked.push(`${command.name}: does ${tool.does} (${runs} runs)`);
    if (tool.idempotent) {
      check.checked.push(`${command.name}: idempotent (${runs} runs)`);
    }
  } else if (tool !== 'none') {
    check.unchecked.push(
      `${command.name}: does and idempotent, because it waits for the server and has no local change`,
    );
  }
}

/**
 * Proves the claims of each command of a contract. It throws one error that
 * names each broken claim, with the seed and the input that broke it. The
 * seed is `options.seed`, then `CLAIMS_SEED`, then `defaultClaimsSeed`.
 */
export function proveClaims(
  proven: Proven,
  options: { readonly seed?: number; readonly runs?: number } = {},
): ClaimsReport {
  const named = process.env.CLAIMS_SEED;
  const fromEnvironment = named ? Math.trunc(Number(named)) : Number.NaN;
  const seed =
    options.seed ?? (Number.isNaN(fromEnvironment) ? defaultClaimsSeed : fromEnvironment);
  const failures: Array<string> = [];
  // The first failing run of each claim of one command, and how many runs broke it.
  let broken = new Map<string, { text: string; runs: number }>();
  const check: Checker = {
    checked: [],
    unchecked: [],
    fail(claim, run, input, why) {
      const seen = broken.get(claim);
      if (seen) {
        seen.runs += 1;
      } else {
        broken.set(claim, {
          text: `  ${claim}, run ${run}: ${why}.\n    Input: ${JSON.stringify(input)}`,
          runs: 1,
        });
      }
    },
  };
  for (const command of proven.contract.commands) {
    broken = new Map();
    const random = generatorOf(seed, command.name);
    try {
      proveRuns(random, proven, command, options.runs ?? defaultRuns, check);
      proveLimits(random, proven, command, check);
    } catch (error) {
      // A kind that no value fits stops the proof of the command. It fails, and is never skipped.
      const why = error instanceof Error ? error.message : String(error);
      check.fail('valid input', 0, null, `the proof can make no valid input: ${why}`);
    }
    if (broken.size) {
      failures.push(
        `The command ${command.name} breaks a claim of its contract:`,
        ...[...broken.values()].map(({ text, runs }) =>
          runs > 1 ? `${text}\n    ${runs - 1} more runs broke it too.` : text,
        ),
      );
    }
    for (const [field, why] of Object.entries(notChecked)) {
      if (field in command || (command.tool !== 'none' && field in command.tool)) {
        check.unchecked.push(`${command.name}: ${field}, because ${why}`);
      }
    }
  }
  if (failures.length) {
    throw new Error(
      [
        `The contract ${proven.contract.name} breaks its claims (seed ${seed}).`,
        ...failures,
        `Run the same inputs again with CLAIMS_SEED=${seed}. See docs/contributing/architecture/contract.md#claims.`,
      ].join('\n'),
    );
  }
  return { seed, checked: check.checked, unchecked: check.unchecked };
}

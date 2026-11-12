import { expect, test } from 'bun:test';

import { localChange } from '@repo/sync/contract/command';
import type { Replayable } from '@repo/sync/contract/command';
import type { Stamps } from '@repo/sync/contract/fields';
import { createPool } from '@repo/sync/runtime/pool';
import type { Pool } from '@repo/sync/runtime/pool';
import { sameJson } from '@repo/sync/runtime/tables';
import { testCommand, testGroup, testModel, testStamps } from '@repo/sync/testing/pool-state';
import { referencePool } from '@repo/sync/testing/reference-pool';
import type { ReferencePool } from '@repo/sync/testing/reference-pool';
import type { Change, Delta, Outcome } from '@repo/sync/types/protocol';

/**
 * The object pool, run against the reference model with the same generated
 * operations. After each step the two must show the same records, IDs and
 * pending transactions, and the pool must keep its identity rules.
 */

const card = testModel('Card', { id: 'string', title: 'string' });
const put = testCommand('cards/put', { id: 'string', title: 'string' }, 'local');
const rename = testCommand('cards/rename', { id: 'string', title: 'string' }, 'local');
const remove = testCommand('cards/remove', { id: 'string' }, 'local');
const changes: ReadonlyArray<Replayable> = [
  localChange(put, (draft, input) => {
    draft.put(card, { id: input.id, title: input.title });
  }),
  localChange(rename, (draft, input) => {
    const current = draft.get(card, input.id);
    if (current) {
      draft.put(card, { ...current, title: input.title });
    }
  }),
  localChange(remove, (draft, input) => {
    draft.remove(card, input.id);
  }),
];

const cardIds: ReadonlyArray<string> = ['a', 'b', 'c', 'd'];
const titles: ReadonlyArray<string> = ['Alpha', 'Beta', 'Gamma'];
const groups = [testGroup];
const declared = { records: [card], commands: [put, rename, remove] };

/** A transaction that the run made, so a later confirm can repeat its change. */
type Issued = { readonly command: string; readonly input: Readonly<Record<string, unknown>> };

type Harness = {
  pool: Pool;
  readonly reference: ReferencePool;
  readonly stamps: Stamps;
  readonly issued: Map<string, Issued>;
  clock: number;
};

/** What one step did, for the message of a failure, and whether it made a new pool. */
type Step = { readonly label: string; readonly reloads: boolean };

type Random = () => number;

/** A seeded generator, so a failing seed runs the same steps again. */
function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick<Item>(random: Random, items: ReadonlyArray<Item>): Item {
  return items[Math.floor(random() * items.length)];
}

/** A sync ID that moves on, or, one time in seven, an old one that the pool must ignore. */
function nextSyncId(random: Random, harness: Harness): number {
  const last = harness.reference.lastSyncId();
  if (last > 0 && random() < 0.15) {
    return 1 + Math.floor(random() * last);
  }
  harness.clock = Math.max(harness.clock, last) + 1 + Math.floor(random() * 3);
  return harness.clock;
}

function recordRun(harness: Harness, id: string, command: string, input: Issued['input']): void {
  harness.reference.run(id, command, input);
  harness.issued.set(id, { command, input });
}

function applyDeltas(harness: Harness, deltas: ReadonlyArray<Delta>): void {
  harness.pool.applyDeltas(deltas);
  harness.reference.applyDeltas(deltas);
}

function runPut(random: Random, harness: Harness): Step {
  const input = { id: pick(random, cardIds), title: pick(random, titles) };
  recordRun(harness, harness.pool.run(put, input), put.name, input);
  return { label: `run ${put.name} ${JSON.stringify(input)}`, reloads: false };
}

function runRename(random: Random, harness: Harness): Step {
  const input = { id: pick(random, cardIds), title: pick(random, titles) };
  recordRun(harness, harness.pool.run(rename, input), rename.name, input);
  return { label: `run ${rename.name} ${JSON.stringify(input)}`, reloads: false };
}

function runRemove(random: Random, harness: Harness): Step {
  const input = { id: pick(random, cardIds) };
  recordRun(harness, harness.pool.run(remove, input), remove.name, input);
  return { label: `run ${remove.name} ${JSON.stringify(input)}`, reloads: false };
}

/** A delta from another client: one to two upserts or deletes, with no transaction of this client. */
function otherDelta(random: Random, harness: Harness): Step {
  const syncId = nextSyncId(random, harness);
  const changeList: Array<Change> = [];
  const count = 1 + Math.floor(random() * 2);
  for (let index = 0; index < count; index += 1) {
    const id = pick(random, cardIds);
    changeList.push(
      random() < 0.3
        ? { model: card.name, id, action: 'delete', data: null, groups }
        : { model: card.name, id, action: 'upsert', data: { title: pick(random, titles) }, groups },
    );
  }
  applyDeltas(harness, [{ syncId, transactionId: null, changes: changeList }]);
  return {
    label: `delta from another client at sync ${syncId}: ${JSON.stringify(changeList)}`,
    reloads: false,
  };
}

/** The change that the server makes for a confirmed transaction, on the records it confirmed. */
function serverChanges(issued: Issued, reference: ReferencePool): Array<Change> {
  const id = String(issued.input.id);
  const exists = reference.confirmed(card.name, id) !== undefined;
  if (issued.command === put.name) {
    return [
      { model: card.name, id, action: 'upsert', data: { title: issued.input.title }, groups },
    ];
  }
  if (issued.command === rename.name) {
    return exists
      ? [{ model: card.name, id, action: 'upsert', data: { title: issued.input.title }, groups }]
      : [];
  }
  return exists ? [{ model: card.name, id, action: 'delete', data: null, groups }] : [];
}

/** A delta that confirms one pending transaction with the change its local change makes. */
function confirm(random: Random, harness: Harness): Step {
  const id = pick(random, harness.reference.pendingIds());
  const issued = harness.issued.get(id);
  if (!issued) {
    throw new Error(`The transaction ${id} is pending, but the run did not record it.`);
  }
  const syncId = nextSyncId(random, harness);
  applyDeltas(harness, [
    { syncId, transactionId: id, changes: serverChanges(issued, harness.reference) },
  ]);
  return { label: `confirm ${issued.command} ${id} at sync ${syncId}`, reloads: false };
}

/** The server answers one pending transaction: it accepts it at a sync ID, or rejects it. */
function settle(random: Random, harness: Harness): Step {
  const id = pick(random, harness.reference.pendingIds());
  const outcome: Outcome =
    random() < 0.65
      ? { transactionId: id, status: 'accepted', syncId: nextSyncId(random, harness), reason: null }
      : { transactionId: id, status: 'rejected', syncId: null, reason: 'Locked', code: 'locked' };
  harness.pool.settle([outcome]);
  harness.reference.settle([outcome]);
  const verdict = outcome.status === 'accepted' ? `accepted at sync ${outcome.syncId}` : 'rejected';
  return { label: `settle ${id} as ${verdict}`, reloads: false };
}

/** Saves the pool state and loads it into a new pool, as a reload of the app does. */
function reload(harness: Harness): Step {
  const next = createPool(changes, declared, { stamps: harness.stamps });
  next.load(harness.pool.snapshot());
  harness.pool = next;
  harness.reference.reload();
  return { label: 'snapshot, then load into a new pool', reloads: true };
}

function resetConfirmed(harness: Harness): Step {
  harness.pool.resetConfirmed();
  harness.reference.resetConfirmed();
  return { label: 'resetConfirmed', reloads: false };
}

/** One generated step, chosen by a roll of the seeded generator. */
function step(random: Random, harness: Harness): Step {
  const roll = random();
  const pendingCount = harness.reference.pendingIds().length;
  if (roll < 0.3) {
    return runPut(random, harness);
  }
  if (roll < 0.4) {
    return runRename(random, harness);
  }
  if (roll < 0.47) {
    return runRemove(random, harness);
  }
  if (roll < 0.62) {
    return otherDelta(random, harness);
  }
  if (roll < 0.76 && pendingCount > 0) {
    return confirm(random, harness);
  }
  if (roll < 0.9 && pendingCount > 0) {
    return settle(random, harness);
  }
  if (roll < 0.95) {
    return reload(harness);
  }
  if (roll < 0.98) {
    return resetConfirmed(harness);
  }
  return otherDelta(random, harness);
}

/** Each place where the pool and the reference model differ, in words. */
function differences(harness: Harness): Array<string> {
  const { pool, reference } = harness;
  const found: Array<string> = [];
  const poolIds = pool.ids(card);
  const referenceIds = reference.ids(card.name);
  if (!sameJson(poolIds, referenceIds)) {
    found.push(
      `IDs: the pool has ${JSON.stringify(poolIds)}, the reference ${JSON.stringify(referenceIds)}`,
    );
  }
  for (const id of new Set([...cardIds, ...poolIds, ...referenceIds])) {
    const own = pool.get(card, id);
    const model = reference.get(card.name, id);
    if (!sameJson(own, model)) {
      found.push(
        `Card ${id}: the pool has ${JSON.stringify(own)}, the reference ${JSON.stringify(model)}`,
      );
    }
  }
  const poolPending = pool.snapshot().pending.map((transaction) => transaction.id);
  const referencePending = reference.pendingIds();
  if (!sameJson(poolPending, referencePending)) {
    found.push(
      `pending: the pool has ${JSON.stringify(poolPending)}, the reference ${JSON.stringify(referencePending)}`,
    );
  }
  if (pool.lastSyncId() !== reference.lastSyncId()) {
    found.push(
      `lastSyncId: the pool has ${pool.lastSyncId()}, the reference ${reference.lastSyncId()}`,
    );
  }
  return found;
}

/**
 * Runs one seed for `steps` steps, and returns the number of steps it checked.
 * It throws at the first step where the two disagree.
 */
function runSeed(seed: number, steps: number): number {
  const random = mulberry32(seed);
  const stamps = testStamps();
  const harness: Harness = {
    pool: createPool(changes, declared, { stamps }),
    reference: referencePool(changes),
    stamps,
    issued: new Map(),
    clock: 0,
  };
  for (let number = 1; number <= steps; number += 1) {
    const ownBefore = cardIds.map((id) => harness.pool.get(card, id));
    const modelBefore = cardIds.map((id) => harness.reference.get(card.name, id));
    const idsBefore = harness.pool.ids(card);
    const { label, reloads } = step(random, harness);
    const where = `(seed ${seed}, step ${number}, ${label})`;
    const found = differences(harness);
    if (found.length > 0) {
      throw new Error(
        `The object pool disagrees with the reference model ${where}: ${found.join('; ')}.`,
      );
    }
    if (reloads) {
      continue;
    }
    for (const [index, id] of cardIds.entries()) {
      const before = ownBefore[index];
      const after = harness.pool.get(card, id);
      const unchanged = sameJson(modelBefore[index], harness.reference.get(card.name, id));
      if (before !== undefined && unchanged && !Object.is(before, after)) {
        throw new Error(
          `The record ${id} did not change ${where}, but the pool made a new object for it.`,
        );
      }
    }
    const idsAfter = harness.pool.ids(card);
    if (sameJson(idsBefore, idsAfter) && !Object.is(idsBefore, idsAfter)) {
      throw new Error(`The IDs did not change ${where}, but the pool made a new ID list.`);
    }
  }
  return steps;
}

test('the object pool agrees with the reference model in 200 seeded runs of 60 steps', () => {
  let checked = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    checked += runSeed(seed, 60);
  }
  expect(checked).toBe(12_000);
});

test('the comparison fails when the reference gets one delta that the pool does not get', () => {
  const stamps = testStamps();
  const harness: Harness = {
    pool: createPool(changes, declared, { stamps }),
    reference: referencePool(changes),
    stamps,
    issued: new Map(),
    clock: 0,
  };
  harness.reference.applyDeltas([
    {
      syncId: 1,
      transactionId: null,
      changes: [{ model: card.name, id: 'a', action: 'upsert', data: { title: 'Extra' }, groups }],
    },
  ]);
  const found = differences(harness);
  expect(found.some((line) => line.startsWith('Card a:'))).toBe(true);
  expect(found.some((line) => line.startsWith('IDs:'))).toBe(true);
});

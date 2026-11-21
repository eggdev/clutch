import { defineContract } from '@repo/sync/contract/define';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import { record } from '@repo/sync/contract/record';
import type { Pool } from '@repo/sync/runtime/pool';
import type { EventLog } from '@repo/sync/service/event-log';
import { pick } from '@repo/sync/testing/seeded';
import type { Random } from '@repo/sync/testing/seeded';
import type { Change, SyncMessage } from '@repo/sync/types/protocol';
import { Effect } from 'effect';
import type { Context } from 'effect';

/*
 * A server log that a seeded generator writes to, for the tests that run a
 * pull while commits land between its messages. The log knows what each
 * card holds, so a test compares the pool with it at the end.
 */

export const randomCard = record('Card', {
  fields: { id: 'string', title: 'string' },
  groups: [organizationGroup.ofScope],
});
export const randomCards = defineContract('cards', {
  records: [randomCard],
  commands: [],
  loads: [],
});

const groups = ['org:a', 'space:x', 'space:y', 'space:z'];

type Log = Context.Service.Shape<typeof EventLog>;
type Card = {
  readonly groups: ReadonlyArray<string>;
  readonly title: string;
  readonly deleted: boolean;
};

/** Applies one message of a pull to the pool, as the transport does. */
export function applyMessage(pool: Pool, message: SyncMessage): void {
  if (message._tag === 'Deltas') {
    pool.applyDeltas(message.deltas);
  } else if (message._tag === 'Page') {
    pool.applyPage(message.group, message.backfill);
  } else {
    pool.applyGroups(message.loaded, message.backfill);
  }
}

/** Each card of the pool as `<id> <title>`, in order. */
export function held(pool: Pool): Array<string> {
  return (pool.snapshot().tables['Card'] ?? [])
    .map((row) => `${row.id} ${String(row.title)}`)
    .toSorted();
}

/**
 * A log of organization `org-a` that `random` writes to. `commit` writes one
 * transaction with one change: a new card, a delete, or a new title or new
 * groups for a card. `expected` gives each card that the server holds in one
 * of the `loaded` groups, as `held` gives them.
 */
export function randomLog(random: Random) {
  const cards = new Map<string, Card>();
  let created = 0;
  let transactions = 0;
  const someGroups = () => {
    const chosen = groups.filter(() => random() < 0.35);
    return chosen.length ? chosen : [pick(random, groups)];
  };
  function change(): Change {
    const roll = random();
    const ids = [...cards.keys()];
    if (roll < 0.35 || ids.length === 0) {
      const id = `c${String((created += 1)).padStart(3, '0')}`;
      const chosen = someGroups();
      cards.set(id, { groups: chosen, title: `${id}-0`, deleted: false });
      return {
        model: 'Card',
        id,
        action: 'upsert',
        data: { id, title: `${id}-0` },
        groups: chosen,
      };
    }
    const id = pick(random, ids);
    const card = cards.get(id) ?? { groups: [], title: '', deleted: true };
    if (roll < 0.55 && !card.deleted) {
      cards.set(id, { ...card, deleted: true });
      return {
        model: 'Card',
        id,
        action: 'delete',
        data: { id, title: card.title },
        groups: card.groups,
      };
    }
    const chosen = random() < 0.5 ? someGroups() : card.groups;
    const title = `${id}-${Math.floor(random() * 1000)}`;
    cards.set(id, { groups: chosen, title, deleted: false });
    return { model: 'Card', id, action: 'upsert', data: { id, title }, groups: chosen };
  }
  return {
    commit: (log: Log) =>
      log.commit('org-a', `t${(transactions += 1)}`, () => Effect.sync(() => [change()])),
    expected: (loaded: ReadonlyArray<string>) =>
      [...cards]
        .filter(([, card]) => !card.deleted && card.groups.some((group) => loaded.includes(group)))
        .map(([id, card]) => `${id} ${card.title}`)
        .toSorted(),
  };
}

/** Waits until `done` holds, checking each 5 ms, for up to 3 seconds. */
export const until = (done: () => boolean) =>
  Effect.gen(function* () {
    for (let tries = 0; tries < 600 && !done(); tries += 1) {
      yield* Effect.sleep('5 millis');
    }
  });

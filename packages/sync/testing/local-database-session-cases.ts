import { fullSave } from '@repo/sync/runtime/pool-doors';
import {
  expectSame,
  positionOnly,
  readState,
  rename,
  sampleState,
} from '@repo/sync/testing/local-database-samples';
import type { LocalDatabaseCase } from '@repo/sync/testing/local-database-samples';

const ana = { userId: 'ana', organizationId: 'acme' };

/** Lets the work of other tasks run, such as a message from another tab. */
const later = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 50);
  });

/**
 * The cases of the end of a session that every local database adapter must
 * pass: the mark that a clear leaves, and what each save does to it.
 * `local-database-conformance.ts` runs them after the cases of the rows.
 */
export const sessionCases: ReadonlyArray<LocalDatabaseCase> = [
  {
    name: 'a clear leaves a mark, and a waiting row saved after it reads with the mark',
    async run(open) {
      const db = await open();
      await db.save(fullSave(sampleState()));
      await db.clear();
      expectSame(await db.read(), undefined, 'The read of the mark alone');
      await db.save({ add: [rename('t9')], done: [] });
      const read = await readState(db, 'The read of a row saved after the clear');
      expectSame(read.ended, true, 'The mark of the session end');
      expectSame(read.pending, [rename('t9')], 'The waiting rows after the clear');
    },
  },
  {
    name: 'the first save of a position with an actor removes the mark and each waiting row with no actor',
    async run(open) {
      const db = await open();
      const actor = { userId: 'ben', organizationId: 'acme' };
      await db.clear();
      await db.save({ add: [rename('t1'), { ...rename('t2'), actor }], done: [] });
      const { position } = fullSave(sampleState()).confirmed ?? {};
      if (!position) {
        throw new Error('A full save has a position.');
      }
      await db.save({
        confirmed: { replace: true, put: [], remove: [], position: { ...position, actor } },
        add: [{ ...rename('t3'), actor }],
        done: [],
      });
      const read = await readState(db, 'The read after the save of the actor');
      expectSame(read.ended, undefined, 'The mark after the save of the actor');
      expectSame(
        read.pending.map(({ id }) => id),
        ['t2', 't3'],
        'The waiting rows that stay',
      );
    },
  },
  {
    name: 'the first save after a start keeps the mark, and a read after it gives no mark',
    async run(open) {
      const db = await open();
      const actor = { userId: 'ben', organizationId: 'acme' };
      await db.clear();
      await db.save({ add: [rename('t1')], done: [], afterLoad: true });
      const read = await readState(db, 'The read after the first save of a start');
      expectSame(read.ended, undefined, 'The mark after the first save of a start');
      expectSame(read.pending, [rename('t1')], 'The waiting rows after the first save');
      // The mark is still there: the save of an actor removes each row with no actor.
      await db.save({
        confirmed: { ...positionOnly(), position: { ...positionOnly().position, actor } },
        add: [{ ...rename('t2'), actor }],
        done: [],
      });
      const after = await readState(db, 'The read after the save of the actor');
      expectSame(
        after.pending.map(({ id }) => id),
        ['t2'],
        'The waiting rows after the save of the actor',
      );
    },
  },
  {
    name: 'a save after a Groups message that names no actor removes the mark and keeps each waiting row',
    async run(open) {
      const db = await open();
      const actor = { userId: 'ben', organizationId: 'acme' };
      await db.clear();
      await db.save({ add: [rename('t1')], done: [] });
      await db.save({ confirmed: { ...positionOnly(), heardServer: true }, add: [], done: [] });
      const read = await readState(db, 'The read after the Groups message');
      expectSame(read.ended, undefined, 'The mark after the Groups message');
      expectSame(read.pending, [rename('t1')], 'The waiting rows after the Groups message');
      // The mark is gone: a later save of an actor removes no row.
      await db.save({
        confirmed: { ...positionOnly(), position: { ...positionOnly().position, actor } },
        add: [],
        done: [],
      });
      const after = await readState(db, 'The read after the save of the actor');
      expectSame(after.pending, [rename('t1')], 'The waiting rows after the save of the actor');
    },
  },
  {
    name: 'a save of a handle that was open before another handle cleared writes nothing, says so, and wakes it once',
    async run(open) {
      const first = await open();
      const second = await open();
      expectSame(await first.save(fullSave({ ...sampleState(), actor: ana })), 'saved', 'A save');
      let lost = 0;
      first.onLost(() => {
        lost += 1;
      });
      await second.clear();
      // A save that started before the first handle heard of the clear.
      const late = await first.save({
        confirmed: {
          replace: false,
          put: [
            {
              model: 'Card',
              id: 'b',
              row: { id: 'b', title: 'Ana other' },
              groups: ['test'],
              syncId: 8,
            },
          ],
          remove: [],
          position: { lastSyncId: 8, groups: ['test'], actor: ana },
        },
        add: [{ ...rename('late'), actor: ana }],
        done: [],
      });
      expectSame(late, 'cleared', 'The late save');
      expectSame(await second.read(), undefined, 'The read after the late save');
      // A handle that opens after the clear saves, and the mark is still there.
      const third = await open();
      expectSame(await third.save({ add: [rename('t9')], done: [] }), 'saved', 'A new save');
      const read = await readState(third, 'The read of a row saved after the late save');
      expectSame(read.ended, true, 'The mark after the late save');
      expectSame(read.pending, [rename('t9')], 'The waiting rows after the late save');
      await later();
      expectSame(lost, 1, 'The wakes of the handle that lost its database');
    },
  },
];

import { fullSave } from '@repo/sync/runtime/pool-doors';
import {
  expectSame,
  readState,
  rename,
  sampleState,
} from '@repo/sync/testing/local-database-samples';
import type { LocalDatabaseCase } from '@repo/sync/testing/local-database-samples';
import type { PoolState } from '@repo/sync/types/local-database';

const ana = { userId: 'ana', organizationId: 'acme' };

/** A state of Ana with a deleted record and two waiting rows. */
function anasState(): PoolState {
  const state = sampleState();
  return {
    ...state,
    meta: { ...state.meta, 'Card\u0000gone': { groups: ['test'], syncId: 6, deleted: true } },
    pending: [rename('t1'), { ...rename('t2', 'Second'), actor: ana }],
    actor: ana,
  };
}

/**
 * The cases of a device that cannot save, which every local database adapter
 * must pass: `makeRoom` gives up the confirmed records, which are a cache of
 * the server, and keeps the waiting transactions, which the device must
 * never lose. `local-database-conformance.ts` runs them.
 */
export const roomCases: ReadonlyArray<LocalDatabaseCase> = [
  {
    name: 'making room drops each confirmed record and the position, and keeps the waiting rows and the actor',
    async run(open) {
      const db = await open();
      await db.save(fullSave(anasState()));
      expectSame(await db.makeRoom(), 'saved', 'Making room');
      expectSame(
        await db.read(),
        {
          lastSyncId: 0,
          tables: {},
          groups: ['test'],
          meta: {},
          pending: anasState().pending,
          actor: ana,
        },
        'The read after making room',
      );
      // The generation stays, so the handle saves as before.
      expectSame(await db.save({ add: [rename('t3')], done: [] }), 'saved', 'A save after it');
      const after = await readState(db, 'The read after a save that follows');
      expectSame(
        after.pending.map(({ id }) => id),
        ['t1', 't2', 't3'],
        'The order of the waiting rows',
      );
    },
  },
  {
    name: 'making room keeps the mark of a session end',
    async run(open) {
      const db = await open();
      await db.clear();
      await db.save({ add: [rename('t1')], done: [] });
      await db.makeRoom();
      const read = await readState(db, 'The read after making room');
      expectSame(read.ended, true, 'The mark after making room');
      expectSame(read.pending, [rename('t1')], 'The waiting rows after making room');
    },
  },
  {
    name: 'making room through a handle that another handle cleared writes nothing',
    async run(open) {
      const first = await open();
      const second = await open();
      await first.save(fullSave(anasState()));
      await second.clear();
      expectSame(await first.makeRoom(), 'cleared', 'Making room after the clear');
      expectSame(await second.read(), undefined, 'The read after it');
    },
  },
];

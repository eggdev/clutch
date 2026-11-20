import { fullSave } from '@repo/sync/runtime/pool-doors';
import {
  expectSame,
  readState,
  rename,
  sampleState,
} from '@repo/sync/testing/local-database-samples';
import type { LocalDatabaseCase } from '@repo/sync/testing/local-database-samples';
import type { LocalDatabase, PoolState } from '@repo/sync/types/local-database';

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

/** A save of a delta at sync ID 41 that one record changed in, with one waiting row. */
function liveDelta(waiting: string) {
  return {
    confirmed: {
      replace: false,
      put: [
        { model: 'Card', id: 'c', row: { id: 'c', title: 'Live' }, groups: ['test'], syncId: 41 },
      ],
      remove: [],
      position: { lastSyncId: 41, groups: ['test'], actor: ana },
    },
    add: [rename(waiting)],
    done: [],
  };
}

/** Throws unless the read holds no record, sync ID 0, and these waiting rows in order. */
async function expectEmptied(db: LocalDatabase, waiting: ReadonlyArray<string>, what: string) {
  const read = await readState(db, what);
  expectSame(
    { lastSyncId: read.lastSyncId, tables: read.tables, meta: read.meta },
    { lastSyncId: 0, tables: {}, meta: {} },
    `${what}: the confirmed part`,
  );
  expectSame(
    read.pending.map(({ id }) => id),
    waiting,
    `${what}: the waiting rows`,
  );
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
  {
    name: 'after another handle made room, a handle writes no confirmed record and no position, and keeps its waiting rows',
    async run(open) {
      const writer = await open();
      const other = await open();
      await writer.save(fullSave(anasState()));
      expectSame(await other.makeRoom(), 'saved', 'Making room through the other handle');
      expectSame(await writer.save(liveDelta('t3')), 'saved', 'The save of the writer after it');
      await expectEmptied(writer, ['t1', 't2', 't3'], 'The read after the save of the writer');
      // From then on, also a full save writes no record.
      await writer.save(fullSave({ ...anasState(), pending: [rename('t4')] }));
      await other.save({ add: [rename('t5')], done: [] });
      await expectEmptied(other, ['t1', 't2', 't3', 't4', 't5'], 'The read after two more saves');
    },
  },
  {
    name: 'the handle that made room writes no confirmed record after it either',
    async run(open) {
      const db = await open();
      await db.save(fullSave(anasState()));
      await db.makeRoom();
      await db.save(liveDelta('t3'));
      await expectEmptied(db, ['t1', 't2', 't3'], 'The read after a save of the same handle');
    },
  },
  {
    name: 'a handle that opens after room was made writes the confirmed records, and room made again stops it',
    async run(open) {
      const first = await open();
      await first.save(fullSave(anasState()));
      await first.makeRoom();
      const next = await open();
      await next.save(liveDelta('t3'));
      const read = await readState(next, 'The read after a save of the next start');
      expectSame(read.lastSyncId, 41, 'The sync ID after a save of the next start');
      expectSame(read.tables, { Card: [{ id: 'c', title: 'Live' }] }, 'The records after it');
      await first.makeRoom();
      await next.save(liveDelta('t4'));
      await expectEmptied(next, ['t1', 't2', 't3', 't4'], 'The read after room was made again');
    },
  },
  {
    name: 'a clear after room was made lets the clearing handle write records, and no other handle',
    async run(open) {
      const first = await open();
      const other = await open();
      await first.save(fullSave(anasState()));
      await other.makeRoom();
      await first.clear();
      const after = sampleState('After');
      await first.save(fullSave(after));
      expectSame(await first.read(), after, 'The read after a save that follows the clear');
      expectSame(await other.save(liveDelta('t3')), 'cleared', 'A save of the other handle');
      expectSame(await first.read(), after, 'The read after the save of the other handle');
    },
  },
];

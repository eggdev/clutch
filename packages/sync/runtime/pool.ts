import type { Replayable, Waits } from '@repo/sync/contract/command';
import { stamped } from '@repo/sync/contract/fields';
import type { CallOf, Fields } from '@repo/sync/contract/fields';
import { createConfirmed } from '@repo/sync/runtime/confirmed';
import {
  consoleReport,
  countNothing,
  deviceStamps,
  otherActorRows,
  runMisfit,
  savedCommandMisfit,
} from '@repo/sync/runtime/pool-doors';
import type { PoolDeclarations, PoolOptions } from '@repo/sync/runtime/pool-doors';
import {
  applyOutcomes,
  draftOver,
  groupWaits,
  keepActor,
  rowOf,
  sameActor,
  visibleTables,
  wake,
} from '@repo/sync/runtime/tables';
import type { Pending, Writes } from '@repo/sync/runtime/tables';
import type { ConfirmedSave, PoolState, WaitingRow } from '@repo/sync/types/local-database';
import type { Delta, Outcome, SyncActor, Transaction } from '@repo/sync/types/protocol';
import type { ReadablePool, Rejection } from '@repo/sync/types/records';

/** The object pool, with the writes that only the sync engine and commands use. */
export type Pool = ReadablePool & {
  /**
   * Runs a command and returns the ID of its transaction. The pool fills the
   * stamps of the input that the caller left out: a new ID, and the time.
   */
  readonly run: <F extends Fields>(
    command: { readonly name: string; readonly input: F; readonly waits: Waits },
    input: CallOf<F>,
  ) => string;
  readonly isPending: (transactionId: string) => boolean;
  readonly lastSyncId: () => number;
  /**
   * Loads a saved state. The pool then counts the state as saved, so the
   * next save writes only what changes after it. A copy that the pool drops
   * makes the next save replace every saved record. A saved copy that names
   * its actor drops each waiting transaction of another actor, and reports it.
   */
  readonly load: (state: PoolState) => void;
  readonly snapshot: () => PoolState;
  /**
   * The confirmed records that changed since the last call, the records that
   * were deleted, and the sync position, for the next save. `everything`
   * asks for every record, such as after a save that failed. The pool asks
   * for every record itself after it drops its confirmed records.
   */
  readonly confirmedChanges: (everything: boolean) => ConfirmedSave;
  /**
   * Every transaction in the queue, sent or not, in the order the person ran
   * them, as the rows that a save writes: each one with its actor, once the
   * pool knows it.
   */
  readonly queue: () => ReadonlyArray<WaitingRow>;
  /** The transactions to send, without their actor. */
  readonly unsent: () => ReadonlyArray<Transaction>;
  readonly markSent: (ids: ReadonlyArray<string>, sent: boolean) => void;
  readonly applyDeltas: (deltas: ReadonlyArray<Delta>) => void;
  /**
   * Sets the loaded groups. It applies the backfill of each new group, and
   * deletes each confirmed record that is in no loaded group. The first one
   * of a pull from sync ID 0 ends the snapshot of every loaded group, so it
   * also deletes each confirmed record that the pull did not send.
   */
  readonly applyGroups: (loaded: ReadonlyArray<string>, backfill: ReadonlyArray<Delta>) => void;
  /**
   * Applies one page of the backfill of a group. The group loads only with
   * its `Groups` message, and no purge deletes the records of its pages.
   */
  readonly applyPage: (group: string, backfill: ReadonlyArray<Delta>) => void;
  /** The groups loaded now, which the engine names when it connects. */
  readonly loadedGroups: () => ReadonlyArray<string>;
  /**
   * Asks the engine to load a group. It resolves `true` once the records of
   * the group are in the pool, and `false` when the server refuses the group.
   */
  readonly loadGroup: (group: string) => Promise<boolean>;
  /** The server will not load this group for the actor. Only the engine uses it. */
  readonly refuseGroup: (group: string) => void;
  /** The groups that a gate asked for and that are not loaded yet. */
  readonly requestedGroups: () => ReadonlyArray<string>;
  /** Wakes when a gate asks for a group. Only the engine uses it, for the length of one pull. */
  readonly onLoadRequest: (listener: (group: string) => void) => () => void;
  /**
   * The engine calls it when a pull ends, however it ended. A load that did
   * not finish leaves no record: each group whose pages came stops loading,
   * and the pool drops each confirmed record that is in no loaded group.
   */
  readonly endPull: () => void;
  readonly resetConfirmed: () => void;
  /**
   * The engine names the build by the digest of its contracts. A saved copy
   * that another build left a record out of is then loaded again from 0.
   */
  readonly nameBuild: (digest: string) => void;
  /**
   * The engine passes the actor that the first `Groups` message of a pull
   * names. A copy of another actor is dropped whole: the confirmed records,
   * the loaded groups, the position and each waiting transaction. It returns
   * `false` then, and the engine pulls again from 0. A copy that names no
   * actor takes this one. In a copy that stays, each waiting transaction of
   * another actor is dropped, never sent, and reported once, and each one with
   * no actor takes this one. With no actor, from an older server, the copy stays.
   */
  readonly confirmActor: (actor?: SyncActor) => boolean;
  readonly settle: (outcomes: ReadonlyArray<Outcome>) => void;
  readonly onPending: (listener: () => void) => () => void;
  /** Wakes after every change to the pool, so the engine can save it. Screens never use it. */
  readonly onChange: (listener: () => void) => () => void;
};

/**
 * Creates the object pool. Confirmed records come only from server deltas.
 * What screens see is the confirmed records with each pending local change
 * applied again on top, so a delta rebases pending work and a rejection rolls
 * it back. `changes` lists the local change of every command that shows at
 * once, so a pending transaction loaded from the local database can run its
 * local change again.
 *
 * Each change keeps every record that did not change as the same object, and
 * wakes only the watchers of the models and records that changed. A rename of
 * one record re-renders the one component that reads it.
 *
 * `declarations` lists the records and commands that the doors check against.
 * `options.stamps` gives each new ID and the time of each run. Only the pool
 * reads the clock and makes IDs on the client, so a test that gives its own
 * stamps gets the same records on every run.
 *
 * The confirmed records live in `confirmed.ts`, and the visible tables with
 * their watchers in `visibleTables` of `tables.ts`. This file holds the
 * waiting transactions that go on top of the confirmed records.
 */
export function createPool(
  changes: ReadonlyArray<Replayable>,
  declarations: PoolDeclarations,
  options: PoolOptions = {},
): Pool {
  const stamps = options.stamps ?? deviceStamps;
  const report = options.report ?? consoleReport;
  const compared = options.compared ?? countNothing;
  const byName = new Map(changes.map((change) => [change.name, change]));
  const waits = groupWaits();
  const confirmed = createConfirmed(declarations.records, report, waits.loading);
  let pending: Array<Pending> = [];
  let rejection: Rejection | undefined;
  const screen = visibleTables();
  const rejectionWatchers = new Set<() => void>();
  const changeListeners = new Set<() => void>();
  const pendingListeners = new Set<() => void>();

  function recompute() {
    // The waiting changes write over the confirmed records, and never into them.
    const writes: Writes = new Map();
    const draft = draftOver(confirmed.tables(), writes);
    for (const { transaction } of pending) {
      byName.get(transaction.command)?.replay(draft, transaction.input);
    }
    compared(screen.show(confirmed.tables(), writes, confirmed.takeTouched()));
    wake(changeListeners);
  }

  /** Records a refusal the way the server's refusal is recorded, and wakes the rejection watchers. */
  function refuse(transactionId: string, command: string, reason: string) {
    rejection = { transactionId, command, code: 'invalid-input', reason };
    wake(rejectionWatchers);
  }

  function wakeLoaded() {
    const loaded = confirmed.loaded();
    waits.wake((group) => loaded.has(group));
  }

  function dropSettled() {
    const lastSyncId = confirmed.lastSyncId();
    pending = pending.filter(({ acceptedAt }) => acceptedAt === null || acceptedAt > lastSyncId);
  }

  /**
   * Drops each waiting transaction of another actor, and reports it once. A
   * transaction with no actor takes this one, or with `untagged: 'drop'`, as
   * after a session end, goes too. It returns whether it dropped one.
   */
  function keepRowsOf(actor: SyncActor | undefined, untagged: 'adopt' | 'drop' = 'adopt'): boolean {
    const named = untagged === 'drop' ? pending.filter((entry) => entry.actor) : pending;
    const kept = actor ? keepActor(named, actor) : named;
    const dropped = kept.length < pending.length;
    pending = kept;
    if (dropped) {
      report(otherActorRows);
    }
    return dropped;
  }

  function resetConfirmed() {
    confirmed.reset();
    for (const entry of pending) {
      entry.sent = false;
      entry.acceptedAt = null;
    }
    recompute();
    wake(pendingListeners);
  }

  return {
    get: screen.get,
    ids: screen.ids,
    watchModel: screen.watchModel,
    watchRecord: screen.watchRecord,
    lastRejection: () => rejection,
    watchRejection(listener) {
      rejectionWatchers.add(listener);
      return () => rejectionWatchers.delete(listener);
    },
    run(command, input) {
      if (command.waits === 'local' && !byName.has(command.name)) {
        throw new Error(
          `The command ${command.name} shows at once, and this pool has no local change for it. Add its local change to the list that the app gives the pool.`,
        );
      }
      const id = stamps.newId();
      const filled = stamped(command.input, input, stamps);
      // Door 3: a caller that the compiler did not see gets a refusal, and nothing is queued.
      const misfit = runMisfit(command, filled);
      if (misfit) {
        refuse(id, command.name, misfit);
        return id;
      }
      pending.push({
        transaction: { id, command: command.name, input: filled },
        actor: confirmed.actor(),
        sent: false,
        acceptedAt: null,
      });
      recompute();
      wake(pendingListeners);
      return id;
    },
    isPending: (transactionId) =>
      pending.some(({ transaction }) => transaction.id === transactionId),
    lastSyncId: confirmed.lastSyncId,
    load(state) {
      if (confirmed.load(state)) {
        wakeLoaded();
      } else {
        // The pool asks the server again for each group of the dropped copy.
        for (const group of Array.isArray(state.groups) ? state.groups : []) {
          waits.keep(group);
        }
      }
      pending = [];
      // A copy with another shape may hold no list of saved commands.
      for (const { actor, ...transaction } of Array.isArray(state.pending) ? state.pending : []) {
        const reason = savedCommandMisfit(transaction, declarations.commands);
        if (reason) {
          report(reason);
          refuse(transaction.id, transaction.command, reason);
        } else {
          pending.push({ transaction, actor, sent: false, acceptedAt: null });
        }
      }
      // After a session end, a row with no actor may be the work of the person who left.
      keepRowsOf(confirmed.actor(), state.ended ? 'drop' : 'adopt');
      recompute();
    },
    snapshot: () => ({
      ...confirmed.snapshot(),
      pending: pending.map(rowOf),
    }),
    confirmedChanges: confirmed.changes,
    queue: () => pending.map(rowOf),
    unsent: () => pending.filter(({ sent }) => !sent).map(({ transaction }) => transaction),
    markSent(ids, sent) {
      for (const entry of pending) {
        if (ids.includes(entry.transaction.id)) {
          entry.sent = sent;
        }
      }
    },
    applyDeltas(deltas) {
      for (const delta of deltas) {
        if (!confirmed.applyDelta(delta)) {
          continue;
        }
        pending = pending.filter(({ transaction }) => transaction.id !== delta.transactionId);
      }
      dropSettled();
      recompute();
    },
    applyGroups(groups, backfill) {
      confirmed.setLoaded(groups);
      confirmed.applyBackfill(backfill);
      confirmed.endLoad();
      confirmed.purge();
      recompute();
      wakeLoaded();
    },
    applyPage(group, backfill) {
      waits.paged(group);
      confirmed.applyBackfill(backfill);
      recompute();
    },
    loadedGroups: () => [...confirmed.loaded()],
    loadGroup: (group) =>
      confirmed.loaded().has(group) ? Promise.resolve(true) : waits.wait(group),
    refuseGroup(group) {
      report(
        `The server refused to load ${group} for this account, so its screen shows no records.`,
      );
      const paged = waits.loading().has(group);
      waits.refuse(group);
      if (paged) {
        confirmed.purge();
        recompute();
      }
    },
    requestedGroups: waits.requested,
    onLoadRequest: waits.onRequest,
    endPull() {
      if (confirmed.endPull(waits.cutOff())) {
        recompute();
      }
    },
    resetConfirmed,
    nameBuild(digest) {
      if (confirmed.nameBuild(digest)) {
        report(
          'Another build of this app left out a record that it could not read, so this build loads each record again from the server.',
        );
        resetConfirmed();
      }
    },
    confirmActor(actor) {
      const saved = confirmed.actor();
      if (!actor) {
        return true;
      }
      if (!saved || sameActor(saved, actor)) {
        const dropped = keepRowsOf(actor);
        confirmed.setActor(actor);
        // The next save writes the actor of the copy, and deletes each dropped row.
        if (dropped) {
          recompute();
          wake(pendingListeners);
        } else if (!saved) {
          wake(changeListeners);
        }
        return true;
      }
      confirmed.setActor(actor);
      report(
        'This device held the data of another account, so the app removed it, with its unsent changes, and loads this account from the server.',
      );
      confirmed.reset();
      confirmed.setLoaded([]);
      pending = [];
      rejection = undefined;
      recompute();
      wake(rejectionWatchers);
      wake(pendingListeners);
      return false;
    },
    settle(outcomes) {
      const before = rejection;
      ({ pending, rejection } = applyOutcomes(pending, outcomes, rejection));
      dropSettled();
      recompute();
      if (rejection !== before) {
        wake(rejectionWatchers);
      }
    },
    onPending(listener) {
      pendingListeners.add(listener);
      return () => pendingListeners.delete(listener);
    },
    onChange(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
  };
}

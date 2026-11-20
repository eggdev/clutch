import type { Contract } from '@repo/sync/contract/define';
import { unfitting } from '@repo/sync/contract/fields';
import type { RecordDeclaration } from '@repo/sync/contract/record';
import { appendEvent, eventsAfter, findTransaction, headOf } from '@repo/sync/repo/events';
import { liveRecords } from '@repo/sync/repo/records';
import type { RecordCursor } from '@repo/sync/repo/records';
import { oldestOf } from '@repo/sync/repo/trim';
import { Database } from '@repo/sync/service/database';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { seenDelta } from '@repo/sync/service/visible';
import type { Change, Delta } from '@repo/sync/types/protocol';
import { Context, Effect, Layer, Option, PubSub, Stream } from 'effect';
import type { Scope } from 'effect';

/**
 * At most this many events go in one page of the backlog, and this many
 * records in one page of a snapshot, so one decode stays short, and the
 * server reads one page at a time.
 */
const rowsPerPage = 1000;

type Commit = <E, R>(
  organizationId: string,
  transactionId: string,
  write: (db: DrizzleDatabase) => Effect.Effect<ReadonlyArray<Change>, E, R>,
) => Effect.Effect<number, unknown, R>;

/** One page of the backlog: the visible deltas, and the sync ID of the last event read. */
export type BacklogPage = { readonly deltas: ReadonlyArray<Delta>; readonly last: number };

/** One page of a snapshot: the last change of each record, and whether more pages follow. */
export type SnapshotPage = { readonly deltas: ReadonlyArray<Delta>; readonly more: boolean };

/**
 * The append-only log of one server. `commit` writes the owner records and
 * the event in one database transaction, then publishes the delta after the
 * commit. Each change must name its sync groups and a model that a contract
 * declares. `snapshot`, `backlog` and
 * `subscribe` give a connection its records and events; see `service/feed.ts`.
 */
export class EventLog extends Context.Service<
  EventLog,
  {
    readonly commit: Commit;
    readonly head: (organizationId: string) => Effect.Effect<number, unknown>;
    /** The oldest sync ID that the log still holds, or 0 when it holds none. A trim moves it up. */
    readonly oldest: (organizationId: string) => Effect.Effect<number, unknown>;
    /** The events after a sync ID that touch the groups, in pages, as a client of the groups sees them. */
    readonly backlog: (
      organizationId: string,
      lastSyncId: number,
      groups: ReadonlySet<string>,
    ) => Stream.Stream<BacklogPage, unknown>;
    /**
     * Each live record of a group, once, as a delta of its last change, in
     * pages. A deleted record is not sent, so the cost follows the records
     * and not their history. A record that is also in a group of `skip` is
     * left out. Each page is its own query, in the order of the record keys,
     * so a record that changes between two pages is neither skipped nor sent
     * twice. A change after the first page can be newer than the head that
     * the caller read; the caller sends the events after that head as well.
     * The last page has `more: false`, and it can be empty.
     */
    readonly snapshot: (
      organizationId: string,
      group: string,
      skip?: ReadonlySet<string>,
    ) => Stream.Stream<SnapshotPage, unknown>;
    /** Every new event of the organization, from now on. */
    readonly subscribe: (
      organizationId: string,
    ) => Effect.Effect<PubSub.Subscription<Delta>, never, Scope.Scope>;
  }
>()('sync/EventLog') {}

/** A change with no group reaches no client, so a server change must name them. */
function checkGroups(changes: ReadonlyArray<Change>) {
  const missing = changes.find((change) => change.groups.length === 0);
  return missing
    ? Effect.die(
        new Error(
          `The change of ${missing.model} ${missing.id} has no sync groups. Build it with upsertChange or deleteChange from @repo/sync/contract/change.`,
        ),
      )
    : Effect.void;
}

/**
 * A change must name a model that a contract declares, and its data may hold
 * only the fields of that record, so no other column reaches a client. An
 * upsert must also fit the fields. A delete carries the last data of a record
 * that may be older, so the kinds of its fields are not checked.
 */
function checkRecords(
  declared: ReadonlyMap<string, RecordDeclaration>,
  changes: ReadonlyArray<Change>,
) {
  for (const change of changes) {
    const model = declared.get(change.model);
    if (!model) {
      return Effect.die(
        new Error(
          `The change of ${change.model} ${change.id} names a model that no contract declares. Add the record to the contract of its package.`,
        ),
      );
    }
    const extra = model.undeclared(change.data);
    if (extra.length > 0) {
      return Effect.die(
        new Error(
          `The change of ${change.model} ${change.id} carries ${extra.join(', ')}, which its record does not declare. A field that no contract declares never leaves the server. Fix the server change that built it.`,
        ),
      );
    }
    if (change.action === 'upsert' && !model.is(change.data)) {
      const named =
        change.data === null
          ? 'It has no data.'
          : `These fields do not fit: ${unfitting(model.fields, change.data).join(', ')}.`;
      return Effect.die(
        new Error(
          `The upsert of ${change.model} ${change.id} does not match the fields of its record. ${named} Fix the server change that built it.`,
        ),
      );
    }
  }
  return Effect.void;
}

/**
 * The event log of a server. It checks each change of a transaction against
 * the records of the contracts that it is given, so a change that a contract
 * does not declare never reaches a client.
 */
export function eventLog(
  contracts: ReadonlyArray<Contract>,
  options: { readonly pageSize?: number | undefined } = {},
) {
  const pageSize = options.pageSize ?? rowsPerPage;
  const declared = new Map(
    contracts
      .flatMap((contract) => contract.records)
      .map((model): [string, RecordDeclaration] => [model.name, model]),
  );
  return Layer.effect(EventLog)(
    Effect.gen(function* () {
      const db = yield* Database;
      const hubs = new Map<string, PubSub.PubSub<Delta>>();
      const hubOf = (organizationId: string) =>
        Effect.gen(function* () {
          const existing = hubs.get(organizationId);
          if (existing) {
            return existing;
          }
          const hub = yield* PubSub.unbounded<Delta>();
          hubs.set(organizationId, hub);
          return hub;
        });

      const commit: Commit = (organizationId, transactionId, write) =>
        Effect.gen(function* () {
          const result = yield* db.transaction((tx) =>
            Effect.gen(function* () {
              const known = yield* findTransaction(tx, organizationId, transactionId);
              if (known !== undefined) {
                return { syncId: known, delta: null };
              }
              const changes = yield* write(tx);
              yield* checkGroups(changes);
              yield* checkRecords(declared, changes);
              const stored = yield* appendEvent(tx, organizationId, transactionId, changes);
              const delta: Delta = {
                syncId: stored.syncId,
                transactionId,
                changes: stored.changes,
              };
              return { syncId: stored.syncId, delta };
            }),
          );
          if (result.delta) {
            yield* PubSub.publish(yield* hubOf(organizationId), result.delta);
          }
          return result.syncId;
        });

      return {
        commit,
        head: (organizationId: string) => headOf(db, organizationId),
        oldest: (organizationId: string) => oldestOf(db, organizationId),
        // The events after `after` that touch `groups`, a page at a time. A
        // page that is not full is the last.
        backlog: (organizationId, after, groups) =>
          Stream.paginate(after, (cursor) =>
            eventsAfter(db, organizationId, cursor, groups, pageSize).pipe(
              Effect.map((page) => {
                const last = page.last ?? cursor;
                const deltas = page.deltas.flatMap((delta) => seenDelta(delta, groups) ?? []);
                const next: BacklogPage = { deltas, last };
                return [[next], page.full ? Option.some(last) : Option.none()] as const;
              }),
            ),
          ),
        snapshot: (organizationId, group, skip = new Set()) =>
          Stream.paginate<RecordCursor | undefined, SnapshotPage, unknown, never>(
            undefined,
            (cursor) =>
              liveRecords(db, organizationId, group, skip, cursor, pageSize).pipe(
                Effect.map((page) => {
                  const next: SnapshotPage = { deltas: page.deltas, more: page.full };
                  return [[next], page.full ? Option.some(page.last) : Option.none()] as const;
                }),
              ),
          ),
        subscribe: (organizationId) =>
          Effect.flatMap(hubOf(organizationId), (hub) => PubSub.subscribe(hub)),
      };
    }),
  );
}

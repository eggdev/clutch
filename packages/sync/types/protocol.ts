import { GroupNotAllowed } from '@repo/sync/types/group-not-allowed';
import { ServerBehind } from '@repo/sync/types/server-behind';
import { SessionEnded } from '@repo/sync/types/session-ended';
import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

/**
 * The sync protocol. Records travel as plain JSON objects, so the wire form
 * and the stored form are the same, and the client never decodes on load.
 */
const RecordData = Schema.Record(Schema.String, Schema.Unknown);

/**
 * One record that a server change wrote or deleted, with its sync groups. A
 * client gets the change only when it has loaded one of those groups. A
 * delete carries the last data of the record, so its groups are known.
 */
export const Change = Schema.Struct({
  model: Schema.String,
  id: Schema.String,
  action: Schema.Literals(['upsert', 'delete']),
  data: Schema.NullOr(RecordData),
  groups: Schema.Array(Schema.String),
});
export type Change = typeof Change.Type;

/**
 * One event in the server's append-only log. `syncId` only increases inside
 * an organization. `transactionId` names the client transaction that caused
 * it, so the sender can match its own event.
 */
export const Delta = Schema.Struct({
  syncId: Schema.Int,
  transactionId: Schema.NullOr(Schema.String),
  changes: Schema.Array(Change),
});
export type Delta = typeof Delta.Type;

/** New events, in sync ID order, with only the changes of the client's loaded groups. */
const DeltasMessage = Schema.TaggedStruct('Deltas', { deltas: Schema.Array(Delta) });

/**
 * The groups that the client has loaded now. The client deletes each record
 * that is in none of them. `backfill` holds the past changes of each group
 * that the client loaded just now.
 */
const GroupsMessage = Schema.TaggedStruct('Groups', {
  loaded: Schema.Array(Schema.String),
  backfill: Schema.Array(Delta),
});

export const SyncMessage = Schema.Union([DeltasMessage, GroupsMessage]);
export type SyncMessage = typeof SyncMessage.Type;

/** One run of a command, as the client sends it. */
export const Transaction = Schema.Struct({
  id: Schema.String,
  command: Schema.String,
  input: Schema.Unknown,
});
export type Transaction = typeof Transaction.Type;

/** The answer for one transaction. An accepted one names the event that holds it. */
export const Outcome = Schema.Struct({
  transactionId: Schema.String,
  status: Schema.Literals(['accepted', 'rejected']),
  syncId: Schema.NullOr(Schema.Int),
  reason: Schema.NullOr(Schema.String),
});
export type Outcome = typeof Outcome.Type;

/**
 * The calls of the sync engine, over one socket for each organization.
 * `Pull` names the groups that the client loaded before, and streams
 * messages. `Load` asks the open `Pull` stream to load one more group.
 */
export class SyncRpcs extends RpcGroup.make(
  Rpc.make('Push', {
    payload: { transactions: Schema.Array(Transaction) },
    success: Schema.Array(Outcome),
  }),
  Rpc.make('Pull', {
    payload: { lastSyncId: Schema.Int, groups: Schema.Array(Schema.String) },
    success: SyncMessage,
    error: Schema.Union([SessionEnded, ServerBehind]),
    stream: true,
  }),
  Rpc.make('Load', {
    payload: { group: Schema.String },
    error: GroupNotAllowed,
  }),
) {}

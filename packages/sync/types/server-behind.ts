import { Schema } from 'effect';

/**
 * The server cannot send each event after the client's last sync ID. Either
 * its log ends before that sync ID, as after a database restore, or the trim
 * of the log dropped events that the client never got. `oldest` is the
 * oldest sync ID that the log still holds, and the server sends it only in
 * the second case. The client acts the same in both: it drops its confirmed
 * records and loads again from sync ID 0. Its pending transactions stay, and
 * it sends them again. `oldest` is an optional key, so each build reads the
 * error with or without it.
 */
export class ServerBehind extends Schema.TaggedError<ServerBehind>()('ServerBehind', {
  head: Schema.Int,
  oldest: Schema.optionalKey(Schema.Int),
}) {}

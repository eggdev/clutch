import { Schema } from 'effect';

/**
 * The server's log ends before the client's last sync ID. This happens after
 * a database restore. The client drops its confirmed records and loads again
 * from sync ID 0. Its pending transactions stay, and it sends them again.
 */
export class ServerBehind extends Schema.TaggedError<ServerBehind>()('ServerBehind', {
  head: Schema.Int,
}) {}

import { Schema } from 'effect';

/**
 * The database of the server did not answer, so the server did not try the
 * write. It is no refusal: the client keeps the write and sends it again.
 */
export class ServerUnavailable extends Schema.TaggedError<ServerUnavailable>()(
  'ServerUnavailable',
  {},
) {}

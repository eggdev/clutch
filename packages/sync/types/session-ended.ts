import { Schema } from 'effect';

/** The session ended. The client deletes its local database and opens sign-in. */
export class SessionEnded extends Schema.TaggedError<SessionEnded>()('SessionEnded', {
  code: Schema.Literal(4401),
}) {}

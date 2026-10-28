import { Schema } from 'effect';

/**
 * The close code of a socket whose session ended. The client deletes its
 * local database and opens sign-in when it sees this code.
 */
export const sessionEndedCode = 4401;

/** The session ended. The client deletes its local database and opens sign-in. */
export class SessionEnded extends Schema.TaggedError<SessionEnded>()('SessionEnded', {
  code: Schema.Literal(sessionEndedCode),
}) {}

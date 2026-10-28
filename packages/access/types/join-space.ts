import { Schema } from 'effect';

/** The input of the `access/join-space` command. */
export const JoinSpaceInput = Schema.Struct({
  spaceId: Schema.String,
  at: Schema.String,
});
export type JoinSpaceInput = typeof JoinSpaceInput.Type;

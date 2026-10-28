import { Schema } from 'effect';

/** The input of the `access/leave-space` command. */
export const LeaveSpaceInput = Schema.Struct({
  spaceId: Schema.String,
});
export type LeaveSpaceInput = typeof LeaveSpaceInput.Type;

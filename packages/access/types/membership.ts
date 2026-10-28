import { Schema } from 'effect';

/** One user's membership of one space. Only that user gets the record. */
export const Membership = Schema.Struct({
  id: Schema.String,
  spaceId: Schema.String,
  userId: Schema.String,
  joinedAt: Schema.String,
});
export type Membership = typeof Membership.Type;

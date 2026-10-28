import { Schema } from 'effect';

/** The actor may not see the group that the client asked to load. */
export class GroupNotAllowed extends Schema.TaggedError<GroupNotAllowed>()('GroupNotAllowed', {
  group: Schema.String,
}) {}

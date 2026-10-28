import { maxSpaceNameLength } from '@repo/access/models/space';
import { Schema } from 'effect';

/** A space, as the server sends it and the object pool holds it. Dates are ISO strings. */
export const Space = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type Space = typeof Space.Type;

export const SpaceName = Schema.String.pipe(Schema.check(Schema.isMaxLength(maxSpaceNameLength)));

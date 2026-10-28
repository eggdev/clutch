import { SpaceName } from '@repo/access/types/space';
import { Schema } from 'effect';

/** The input of the `access/create-space` command. The creator joins the new space. */
export const CreateSpaceInput = Schema.Struct({
  id: Schema.String,
  name: SpaceName,
  at: Schema.String,
});
export type CreateSpaceInput = typeof CreateSpaceInput.Type;

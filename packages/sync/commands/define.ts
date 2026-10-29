import { matches } from '@repo/sync/models/shape';
import type { Command, CommandDefinition } from '@repo/sync/types/records';

/**
 * Defines the client half of a command. `waits` has no default: each command
 * says whether the screen shows it at once or after the server confirms it.
 * The server half is `<name>.server.ts`, next to this file.
 */
export function defineCommand<Input>(definition: CommandDefinition<Input>): Command<Input> {
  return {
    ...definition,
    replay(draft, input) {
      if (definition.apply && matches(definition.input, input)) {
        definition.apply(draft, input);
      }
    },
  };
}

import type { Command } from '@repo/sync/types/records';

/**
 * Defines the client half of a command. `waits` has no default: each command
 * says whether the screen shows it at once or after the server confirms it.
 * The server half is `<name>.server.ts`, next to this file.
 */
export function defineCommand<Input>(command: Command<Input>): Command<Input> {
  return command;
}

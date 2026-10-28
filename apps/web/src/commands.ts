import { notesCommands } from '@repo/notes/runtime/commands';

/** The client half of every command. The `command` generator adds each package here. */
export const commands = [...notesCommands];

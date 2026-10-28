import { expect, test } from 'bun:test';

import { checkCommands } from '@tools/check-commands';
import { inRepo } from '@tools/testing/in-repo';

const client = (waits: string) =>
  `export const renameNote = defineCommand({ name: 'notes/rename', ${waits} apply: () => {} });\n`;
const registration =
  "import { renameNoteServer } from '@repo/notes/commands/rename-note.server';\nexport const notesServerChanges = [renameNoteServer];\n";

test('a command with both halves, waits and a registration passes; define helpers are not commands', async () => {
  expect(
    await inRepo(
      {
        'packages/notes/commands/rename-note.ts': client("waits: 'local',"),
        'packages/notes/commands/rename-note.server.ts': 'export const renameNoteServer = 1;\n',
        'packages/notes/commands/notes-commands.test.ts': '',
        'packages/notes/runtime/handlers.server.ts': registration,
        'packages/sync/commands/define.ts': 'export function defineCommand() {}\n',
        'packages/sync/commands/define.server.ts': 'export function defineServerChange() {}\n',
      },
      checkCommands,
    ),
  ).toEqual([]);
});

test('a missing half, a missing waits and a missing registration each fail with the fix', async () => {
  expect(
    await inRepo(
      {
        'packages/notes/commands/rename-note.ts': client(''),
        'packages/notes/commands/create-note.ts': client("waits: 'server',"),
        'packages/notes/commands/archive-note.server.ts': 'export const archiveNoteServer = 1;\n',
        'packages/notes/commands/rename-note.server.ts': 'export const renameNoteServer = 1;\n',
        'packages/notes/runtime/handlers.server.ts': 'export const notesServerChanges = [];\n',
      },
      checkCommands,
    ),
  ).toEqual([
    'packages/notes/commands/archive-note.server.ts: has no client half. Add `archive-note.ts` with its input, local change and `waits`.',
    'packages/notes/commands/archive-note.server.ts: no file in `packages/notes/runtime/` registers it. Import it in `runtime/handlers.server.ts` and add it to the list of server changes.',
    'packages/notes/commands/create-note.ts: has no server half. Add `create-note.server.ts` with the server change.',
    'packages/notes/commands/rename-note.server.ts: no file in `packages/notes/runtime/` registers it. Import it in `runtime/handlers.server.ts` and add it to the list of server changes.',
    "packages/notes/commands/rename-note.ts: says no `waits`. Set `waits: 'local'` to show the change at once, or `waits: 'server'` to wait for the server.",
  ]);
});

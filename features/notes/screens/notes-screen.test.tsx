import { expect, test } from 'bun:test';

import { NotesScreen } from '@features/notes/screens/notes-screen';
import { createNote } from '@repo/notes/commands/create-note';
import { renameNote } from '@repo/notes/commands/rename-note';
import { notesCommands } from '@repo/notes/runtime/commands';
import { poolState } from '@repo/sync/testing/pool-state';
import { renderLive } from '@repo/sync/testing/render-live';
import { renderWarm } from '@repo/sync/testing/render-warm';

const note = {
  id: 'n1',
  spaceId: 'general',
  title: 'Warm note',
  createdAt: '2026-10-28T12:00:00.000Z',
  updatedAt: '2026-10-28T12:00:00.000Z',
};

test('the notes screen paints from a warm pool with no request', () => {
  const html = renderWarm(
    () => <NotesScreen spaceId="general" onOpen={(spaceId) => spaceId} />,
    poolState({ lastSyncId: 1, tables: { Note: [note] }, groups: ['space:general'] }),
    notesCommands,
  );
  expect(html).toContain('Warm note');
});

test('an empty pool shows the empty state, not a spinner', () => {
  const html = renderWarm(
    () => <NotesScreen spaceId="general" onOpen={(spaceId) => spaceId} />,
    poolState({ lastSyncId: 0, tables: {} }),
  );
  expect(html).toContain('No notes yet.');
});

const second = { ...note, id: 'n2', title: 'Second note', createdAt: '2026-10-28T11:00:00.000Z' };
const titles = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLInputElement>('input[aria-label="Note title"]')].map(
    (input) => input.value,
  );

test('a rename changes one row and leaves the list and the other rows in place', async () => {
  const live = await renderLive(
    () => <NotesScreen spaceId="general" onOpen={(spaceId) => spaceId} />,
    poolState({ lastSyncId: 1, tables: { Note: [note, second] }, groups: ['space:general'] }),
    notesCommands,
  );
  const [, otherInput] = live.container.querySelectorAll('input[aria-label="Note title"]');
  await live.change(() =>
    live.pool.run(renameNote, { id: 'n1', title: 'Renamed', at: note.updatedAt }),
  );
  expect(titles(live.container)).toEqual(['Renamed', 'Second note']);
  expect(live.container.querySelectorAll('input[aria-label="Note title"]')[1]).toBe(otherInput);
  await live.unmount();
});

test('a new note shows at the top of the list at once', async () => {
  const live = await renderLive(
    () => <NotesScreen spaceId="general" onOpen={(spaceId) => spaceId} />,
    poolState({ lastSyncId: 1, tables: { Note: [note] }, groups: ['space:general'] }),
    notesCommands,
  );
  await live.change(() =>
    live.pool.run(createNote, {
      id: 'n3',
      spaceId: 'general',
      title: 'Newest',
      at: '2026-10-28T13:00:00.000Z',
    }),
  );
  expect(titles(live.container)).toEqual(['Newest', 'Warm note']);
  await live.unmount();
});

test('the screen shows only the notes of its space', () => {
  const elsewhere = { ...note, id: 'n9', spaceId: 'design', title: 'Design note' };
  const html = renderWarm(
    () => <NotesScreen spaceId="general" onOpen={(spaceId) => spaceId} />,
    poolState({
      lastSyncId: 1,
      tables: { Note: [note, elsewhere] },
      groups: ['space:general', 'space:design'],
    }),
    notesCommands,
  );
  expect(html).toContain('Warm note');
  expect(html).not.toContain('Design note');
});

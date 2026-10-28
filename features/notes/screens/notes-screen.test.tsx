import { expect, test } from 'bun:test';

import { NotesScreen } from '@features/notes/screens/notes-screen';
import { notesCommands } from '@repo/notes/runtime/commands';
import { renderWarm } from '@repo/sync/testing/render-warm';

const note = {
  id: 'n1',
  title: 'Warm note',
  createdAt: '2026-10-28T12:00:00.000Z',
  updatedAt: '2026-10-28T12:00:00.000Z',
};

test('the notes screen paints from a warm pool with no request', () => {
  const html = renderWarm(
    () => <NotesScreen />,
    { lastSyncId: 1, tables: { Note: [note] }, pending: [] },
    notesCommands,
  );
  expect(html).toContain('Warm note');
});

test('an empty pool shows the empty state, not a spinner', () => {
  const html = renderWarm(() => <NotesScreen />, { lastSyncId: 0, tables: {}, pending: [] });
  expect(html).toContain('No notes yet.');
});

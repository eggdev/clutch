import { expect, test } from 'bun:test';

import { NotesScreen } from '@features/notes/screens/notes-screen';
import { createNote, renameNote } from '@repo/notes/contract/notes';
import { notesClient } from '@repo/notes/runtime/client';
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
    notesClient.localChanges,
    notesClient.contract,
  );
  expect(html).toContain('Warm note');
});

test('an empty pool shows the empty state, not a spinner', () => {
  const html = renderWarm(
    () => <NotesScreen spaceId="general" onOpen={(spaceId) => spaceId} />,
    poolState({ lastSyncId: 0, tables: {} }),
    [],
    notesClient.contract,
  );
  expect(html).toContain('No notes yet. Type a title above, then press Add.');
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
    notesClient.localChanges,
    notesClient.contract,
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
    notesClient.localChanges,
    notesClient.contract,
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
    notesClient.localChanges,
    notesClient.contract,
  );
  expect(html).toContain('Warm note');
  expect(html).not.toContain('Design note');
});

/** The title field of the first note row. */
function titleInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Note title"]');
  if (!input) {
    throw new Error('The note title field is missing.');
  }
  return input;
}

/** Types into a controlled field, so React reads the new text as a change. */
function type(input: HTMLInputElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setValue?.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

test('Escape in a note title ends the edit and runs no rename', async () => {
  const live = await renderLive(
    () => <NotesScreen spaceId="general" onOpen={(spaceId) => spaceId} />,
    poolState({ lastSyncId: 1, tables: { Note: [note] }, groups: ['space:general'] }),
    notesClient.localChanges,
    notesClient.contract,
  );
  const input = titleInput(live.container);
  await live.change(() => input.focus());
  await live.change(() => type(input, 'Typed away'));
  expect(input.value).toBe('Typed away');
  await live.change(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(document.activeElement).not.toBe(input);
  expect(live.pool.unsent()).toEqual([]);
  expect(live.pool.snapshot().tables.Note?.find((row) => row.id === 'n1')?.title).toBe('Warm note');
  await live.unmount();
});

test('the New space button opens a row with a Space name field', async () => {
  const live = await renderLive(
    () => <NotesScreen spaceId="general" onOpen={(spaceId) => spaceId} />,
    poolState({ lastSyncId: 1, tables: { Note: [note] }, groups: ['space:general'] }),
    notesClient.localChanges,
    notesClient.contract,
  );
  expect(live.container.querySelector('input[aria-label="Space name"]')).toBeNull();
  const newSpace = [...live.container.querySelectorAll('button')].find(
    (button) => button.textContent === 'New space',
  );
  if (!newSpace) {
    throw new Error('The New space button is missing.');
  }
  await live.change(() => newSpace.click());
  expect(live.container.querySelector('input[aria-label="Space name"]')).not.toBeNull();
  await live.unmount();
});

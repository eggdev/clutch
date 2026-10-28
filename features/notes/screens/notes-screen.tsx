import { NoteRow } from '@features/notes/components/note-row';
import { Button } from '@repo/design-system/ui/button';
import { TextField } from '@repo/design-system/ui/text-field';
import { createNote } from '@repo/notes/commands/create-note';
import { maxTitleLength } from '@repo/notes/models/note';
import { useNoteIds } from '@repo/notes/ui/use-notes';
import { useCommand, useLastRejection } from '@repo/sync/ui/sync-provider';
import type { FormEvent } from 'react';

/**
 * The notes of the organization. Each change shows at once and syncs in the
 * background. The screen reads only the IDs, so a rename re-renders one row.
 */
export function NotesScreen() {
  const ids = useNoteIds();
  const create = useCommand(createNote);
  const rejection = useLastRejection();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const title = String(new FormData(form).get('title') ?? '').trim();
    if (title) {
      create({ id: crypto.randomUUID(), title, at: new Date().toISOString() });
      form.reset();
    }
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-4">
      <h1 className="text-heading text-fg">Notes</h1>
      <form className="flex items-end gap-2" onSubmit={onSubmit}>
        <TextField className="flex-1" label="New note" name="title" maxLength={maxTitleLength} />
        <Button type="submit" variant="primary">
          Add
        </Button>
      </form>
      {rejection ? (
        <p role="alert" className="text-caption text-danger">
          {rejection.reason}
        </p>
      ) : null}
      {ids.length ? (
        <ul className="flex flex-col gap-2">
          {ids.map((id) => (
            <NoteRow key={id} id={id} />
          ))}
        </ul>
      ) : (
        <p className="text-body text-fg-muted">No notes yet. Add the first one above.</p>
      )}
    </main>
  );
}

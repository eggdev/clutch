import { NoteRow } from '@features/notes/components/note-row';
import { Button } from '@repo/design-system/ui/button';
import { TextField } from '@repo/design-system/ui/text-field';
import { createNote } from '@repo/notes/commands/create-note';
import { renameNote } from '@repo/notes/commands/rename-note';
import { maxTitleLength } from '@repo/notes/models/note';
import { useNotes } from '@repo/notes/ui/use-notes';
import { useCommand, useLastRejection } from '@repo/sync/ui/sync-provider';
import type { FormEvent } from 'react';

/** The notes of the organization. Each change shows at once and syncs in the background. */
export function NotesScreen() {
  const notes = useNotes();
  const create = useCommand(createNote);
  const rename = useCommand(renameNote);
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
      {notes.length ? (
        <ul className="flex flex-col gap-2">
          {notes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              onRename={(title) => rename({ id: note.id, title, at: new Date().toISOString() })}
            />
          ))}
        </ul>
      ) : (
        <p className="text-body text-fg-muted">No notes yet. Add the first one above.</p>
      )}
    </main>
  );
}

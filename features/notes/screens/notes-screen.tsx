import { NoteRow } from '@features/notes/components/note-row';
import { SpacesPanel } from '@features/notes/components/spaces-panel';
import { generalSpaceId } from '@repo/access/models/space';
import { useIsMember, useSpace } from '@repo/access/ui/use-spaces';
import { Button } from '@repo/design-system/ui/button';
import { TextField } from '@repo/design-system/ui/text-field';
import { createNote } from '@repo/notes/commands/create-note';
import { maxTitleLength } from '@repo/notes/models/note';
import { useNoteIds } from '@repo/notes/ui/use-notes';
import { useSpaceNoteCount } from '@repo/notes/ui/use-space-note-count';
import { useCommand, useLastRejection } from '@repo/sync/ui/sync-provider';
import type { FormEvent } from 'react';

/**
 * The notes of one space. Each change shows at once and syncs in the
 * background. The screen reads only the IDs, so a rename re-renders one row.
 * `onOpen` opens another space through the notes gate.
 */
export function NotesScreen({
  spaceId,
  onOpen,
}: {
  readonly spaceId: string;
  readonly onOpen: (spaceId: string) => void;
}) {
  const ids = useNoteIds(spaceId);
  const count = useSpaceNoteCount(spaceId);
  const space = useSpace(spaceId);
  const member = useIsMember(spaceId) || spaceId === generalSpaceId;
  const create = useCommand(createNote);
  const rejection = useLastRejection();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const title = String(new FormData(form).get('title') ?? '').trim();
    if (title) {
      create({ id: crypto.randomUUID(), spaceId, title, at: new Date().toISOString() });
      form.reset();
    }
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h1 className="text-heading text-fg">{space?.name ?? 'General'}</h1>
        {count === undefined ? null : (
          <p className="text-caption text-fg-muted">{count === 1 ? '1 note' : `${count} notes`}</p>
        )}
      </header>
      {member ? null : (
        <output className="text-body text-fg-muted">
          You are not in this space. Join it below to see its notes.
        </output>
      )}
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
      <SpacesPanel spaceId={spaceId} onOpen={onOpen} />
    </main>
  );
}

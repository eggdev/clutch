import { renameNote } from '@repo/notes/commands/rename-note';
import { maxTitleLength } from '@repo/notes/models/note';
import { useNote } from '@repo/notes/ui/use-notes';
import { useCommand } from '@repo/sync/ui/sync-provider';
import { memo } from 'react';
import type { KeyboardEvent } from 'react';

/** Enter ends the edit, which commits the title on blur. */
function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === 'Enter') {
    event.currentTarget.blur();
  }
}

/**
 * One note, with a title that renames the note when the field loses focus.
 * The row reads its own record and runs its own command, so its only prop is
 * the ID.
 */
function NoteRowView({ id }: { readonly id: string }) {
  const note = useNote(id);
  const rename = useCommand(renameNote);
  if (!note) {
    return null;
  }
  const current = note.title;
  function commit(value: string) {
    const title = value.trim();
    if (title && title !== current) {
      rename({ id, title, at: new Date().toISOString() });
    }
  }
  return (
    <li className="rounded-surface border border-line bg-surface px-3 py-2">
      <input
        key={current}
        aria-label="Note title"
        className="w-full bg-surface text-body text-fg focus-visible:outline-2 focus-visible:outline-focus"
        defaultValue={current}
        maxLength={maxTitleLength}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
    </li>
  );
}

/**
 * A list rebuilds its row elements when a note is added, removed or moved.
 * `memo` keeps each other row from rendering again, because its ID is the same.
 */
export const NoteRow = memo(NoteRowView);

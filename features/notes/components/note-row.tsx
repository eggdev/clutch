import { maxTitleLength } from '@repo/notes/models/note';
import type { Note } from '@repo/notes/types/note';
import type { KeyboardEvent } from 'react';

/** Enter ends the edit, which commits the title on blur. */
function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === 'Enter') {
    event.currentTarget.blur();
  }
}

/** One note, with a title that renames the note when the field loses focus. */
export function NoteRow({
  note,
  onRename,
}: {
  readonly note: Note;
  readonly onRename: (title: string) => void;
}) {
  function commit(value: string) {
    const title = value.trim();
    if (title && title !== note.title) {
      onRename(title);
    }
  }
  return (
    <li className="rounded-surface border border-line bg-surface px-3 py-2">
      <input
        key={note.title}
        aria-label="Note title"
        className="w-full bg-surface text-body text-fg focus-visible:outline-2 focus-visible:outline-focus"
        defaultValue={note.title}
        maxLength={maxTitleLength}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
    </li>
  );
}

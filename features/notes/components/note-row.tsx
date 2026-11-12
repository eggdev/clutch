import { ListItem } from '@repo/design-system/ui/list';
import { TextField } from '@repo/design-system/ui/text-field';
import { maxTitleLength, renameNote } from '@repo/notes/contract/notes';
import { useNote } from '@repo/notes/ui/use-notes';
import { useCommand } from '@repo/sync/ui/sync-provider';
import { memo, useRef, useState } from 'react';
import type { TextInput } from 'react-native';

/**
 * The title of a note, edited in place. Enter or a tap elsewhere ends the
 * edit, and the end of the edit saves the title. Escape puts the saved title
 * back. An empty title is not saved.
 */
function NoteTitle({
  title,
  onRename,
}: {
  readonly title: string;
  readonly onRename: (title: string) => void;
}) {
  const [draft, setDraft] = useState(title);
  // The end of the edit reads the newest text, also in the same task as a key press.
  const latest = useRef(title);
  const input = useRef<TextInput>(null);
  function change(text: string) {
    latest.current = text;
    setDraft(text);
  }
  return (
    <TextField
      ref={input}
      variant="inline"
      label="Note title"
      value={draft}
      maxLength={maxTitleLength}
      onChangeText={change}
      onKeyPress={(event) => {
        if (event.nativeEvent.key === 'Escape') {
          change(title);
          input.current?.blur();
        }
      }}
      onBlur={() => {
        const next = latest.current.trim();
        if (next && next !== title) {
          onRename(next);
        } else {
          change(title);
        }
      }}
    />
  );
}

/**
 * One note, with a title that renames the note when its edit ends. The row
 * reads its own record and runs its own command, so its only prop is the ID.
 */
function NoteRowView({ id }: { readonly id: string }) {
  const note = useNote(id);
  const rename = useCommand(renameNote);
  if (!note) {
    return null;
  }
  return (
    <ListItem>
      {/* A title that another device changed starts a new field with that title. */}
      <NoteTitle key={note.title} title={note.title} onRename={(title) => rename({ id, title })} />
    </ListItem>
  );
}

/**
 * A list rebuilds its row elements when a note is added, removed or moved.
 * `memo` keeps each other row from rendering again, because its ID is the same.
 */
export const NoteRow = memo(NoteRowView);

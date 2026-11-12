import { NoteRow } from '@features/notes/components/note-row';
import { SpacesPanel } from '@features/notes/components/spaces-panel';
import { generalSpaceId } from '@repo/access/contract/access';
import { useIsMember, useSpace } from '@repo/access/ui/use-spaces';
import { Button } from '@repo/design-system/ui/button';
import { List, ListHeader, ListItem, ListNote } from '@repo/design-system/ui/list';
import { Screen } from '@repo/design-system/ui/screen';
import { Text } from '@repo/design-system/ui/text';
import { TextField } from '@repo/design-system/ui/text-field';
import { createNote, maxTitleLength } from '@repo/notes/contract/notes';
import { useNoteIds } from '@repo/notes/ui/use-notes';
import { useSpaceNoteCount } from '@repo/notes/ui/use-space-note-count';
import { useCommand, useLastRejection } from '@repo/sync/ui/sync-provider';
import { useState } from 'react';
import { View } from 'react-native';

/**
 * The notes of one space. Each change shows at once and syncs in the
 * background. The screen reads only the IDs, so a rename re-renders one row.
 * `onOpen` opens another space through the notes gate.
 *
 * The first row of the list adds a note. The titles of the screen share the
 * inset of the rows, so each title and its list start on one line.
 *
 * On a phone the notes come first and the spaces follow. At desktop width the
 * spaces sit in a column beside the notes. The notes stay first in the
 * source, so a keyboard and a screen reader reach them first at each width.
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
  const [title, setTitle] = useState('');

  function add() {
    const trimmed = title.trim();
    if (trimmed) {
      create({ spaceId, title: trimmed });
      setTitle('');
    }
  }

  return (
    <Screen className="desktop:flex-row-reverse desktop:items-start desktop:gap-8">
      <View className="gap-3 desktop:min-w-0 desktop:flex-1">
        <ListHeader className="min-h-0 flex-wrap items-baseline desktop:min-h-11 desktop:content-center">
          <Text variant="heading">{space?.name ?? 'General'}</Text>
          {count === undefined ? null : (
            <Text variant="caption" tone="muted">
              {count === 1 ? '1 note' : `${count} notes`}
            </Text>
          )}
        </ListHeader>
        {member ? null : (
          <ListNote role="status">
            You are not in this space. Join it below to see its notes.
          </ListNote>
        )}
        <List aria-label="Notes">
          <ListItem>
            <TextField
              variant="inline"
              className="min-w-0 flex-1"
              label="New note"
              placeholder="New note"
              value={title}
              maxLength={maxTitleLength}
              submitBehavior="submit"
              onChangeText={setTitle}
              onSubmitEditing={add}
            />
            <Button variant="primary" size="small" onPress={add}>
              Add
            </Button>
          </ListItem>
          {ids.map((id) => (
            <NoteRow key={id} id={id} />
          ))}
        </List>
        {rejection ? (
          <ListNote role="alert" tone="danger">
            {rejection.reason}
          </ListNote>
        ) : null}
        {ids.length ? null : <ListNote>No notes yet. Type a title above, then press Add.</ListNote>}
      </View>
      <View className="desktop:w-56 desktop:shrink-0">
        <SpacesPanel spaceId={spaceId} onOpen={onOpen} />
      </View>
    </Screen>
  );
}

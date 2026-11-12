import { SpaceRow } from '@features/notes/components/space-row';
import { createSpace, generalSpaceId, maxSpaceNameLength } from '@repo/access/contract/access';
import { useSpaceIds } from '@repo/access/ui/use-spaces';
import { Button } from '@repo/design-system/ui/button';
import { List, ListHeader, ListItem } from '@repo/design-system/ui/list';
import { Text } from '@repo/design-system/ui/text';
import { TextField } from '@repo/design-system/ui/text-field';
import { usePendingCommand } from '@repo/sync/ui/sync-provider';
import { useState } from 'react';
import { View } from 'react-native';

/**
 * The spaces of the organization. A member opens a space through the notes
 * gate, which loads its notes first. Everyone is in the general space. The
 * New space button opens a row that names the space.
 */
export function SpacesPanel({
  spaceId,
  onOpen,
}: {
  readonly spaceId: string;
  readonly onOpen: (spaceId: string) => void;
}) {
  const ids = useSpaceIds();
  const create = usePendingCommand(createSpace);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  function close() {
    setNaming(false);
    setName('');
  }

  function submit() {
    const trimmed = name.trim();
    if (trimmed) {
      create.run({ name: trimmed });
      close();
    }
  }

  return (
    <View role="region" aria-label="Spaces" className="gap-3">
      <ListHeader>
        <Text variant="title">Spaces</Text>
        {naming ? null : (
          <Button size="small" disabled={create.pending} onPress={() => setNaming(true)}>
            {create.pending ? 'Creating…' : 'New space'}
          </Button>
        )}
      </ListHeader>
      <List aria-label="Spaces">
        <ListItem className="flex-wrap gap-y-2 py-2">
          <Text className="min-w-0 grow basis-32">General</Text>
          <Button
            size="small"
            disabled={spaceId === generalSpaceId}
            onPress={() => onOpen(generalSpaceId)}
          >
            Open
          </Button>
        </ListItem>
        {ids.map((id) => (
          <SpaceRow key={id} id={id} current={id === spaceId} onOpen={onOpen} />
        ))}
        {naming ? (
          <ListItem className="flex-wrap gap-y-2 py-2">
            <TextField
              variant="inline"
              className="min-w-0 grow basis-32"
              label="Space name"
              placeholder="Space name"
              autoFocus
              value={name}
              maxLength={maxSpaceNameLength}
              onChangeText={setName}
              onSubmitEditing={submit}
              onKeyPress={(event) => {
                if (event.nativeEvent.key === 'Escape') {
                  close();
                }
              }}
            />
            <View className="flex-row gap-2">
              <Button size="small" onPress={close}>
                Cancel
              </Button>
              <Button size="small" onPress={submit}>
                Create
              </Button>
            </View>
          </ListItem>
        ) : null}
      </List>
    </View>
  );
}

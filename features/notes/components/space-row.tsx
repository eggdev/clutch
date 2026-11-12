import { joinSpace, leaveSpace } from '@repo/access/contract/access';
import { useIsMember, useSpace } from '@repo/access/ui/use-spaces';
import { Button } from '@repo/design-system/ui/button';
import { ListItem } from '@repo/design-system/ui/list';
import { Text } from '@repo/design-system/ui/text';
import { usePendingCommand } from '@repo/sync/ui/sync-provider';
import { memo } from 'react';
import { View } from 'react-native';

/**
 * One space: its name, a way to open it, and Join or Leave. Join and Leave wait
 * for the server, so each button shows a pending state. Leaving deletes
 * the space's notes on this device as soon as the server confirms it.
 */
function SpaceRowView({
  id,
  current,
  onOpen,
}: {
  readonly id: string;
  readonly current: boolean;
  readonly onOpen: (spaceId: string) => void;
}) {
  const space = useSpace(id);
  const member = useIsMember(id);
  const join = usePendingCommand(joinSpace);
  const leave = usePendingCommand(leaveSpace);
  if (!space) {
    return null;
  }
  return (
    <ListItem className="flex-wrap gap-y-2 py-2">
      <Text className="min-w-0 grow basis-32">{space.name}</Text>
      <View className="flex-row gap-2">
        {member ? (
          <>
            <Button size="small" disabled={current} onPress={() => onOpen(id)}>
              Open
            </Button>
            <Button
              size="small"
              disabled={leave.pending}
              aria-busy={leave.pending}
              onPress={() => leave.run({ spaceId: id })}
            >
              {leave.pending ? 'Leaving…' : 'Leave'}
            </Button>
          </>
        ) : (
          <Button
            size="small"
            disabled={join.pending}
            aria-busy={join.pending}
            onPress={() => join.run({ spaceId: id })}
          >
            {join.pending ? 'Joining…' : 'Join'}
          </Button>
        )}
      </View>
    </ListItem>
  );
}

export const SpaceRow = memo(SpaceRowView);

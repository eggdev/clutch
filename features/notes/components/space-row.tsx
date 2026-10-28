import { joinSpace } from '@repo/access/commands/join-space';
import { leaveSpace } from '@repo/access/commands/leave-space';
import { useIsMember, useSpace } from '@repo/access/ui/use-spaces';
import { Button } from '@repo/design-system/ui/button';
import { useCommand } from '@repo/sync/ui/sync-provider';
import { memo } from 'react';

/**
 * One space: its name, a way to open it, and Join or Leave. Leaving deletes
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
  const join = useCommand(joinSpace);
  const leave = useCommand(leaveSpace);
  if (!space) {
    return null;
  }
  return (
    <li className="flex items-center justify-between gap-2 rounded-surface border border-line bg-surface px-3 py-2">
      <span className="text-body text-fg">{space.name}</span>
      <span className="flex gap-2">
        {member ? (
          <>
            <Button disabled={current} onClick={() => onOpen(id)}>
              Open
            </Button>
            <Button onClick={() => leave({ spaceId: id })}>Leave</Button>
          </>
        ) : (
          <Button onClick={() => join({ spaceId: id, at: new Date().toISOString() })}>Join</Button>
        )}
      </span>
    </li>
  );
}

export const SpaceRow = memo(SpaceRowView);

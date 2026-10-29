import { SpaceRow } from '@features/notes/components/space-row';
import { createSpace } from '@repo/access/commands/create-space';
import { generalSpaceId, maxSpaceNameLength } from '@repo/access/models/space';
import { useSpaceIds } from '@repo/access/ui/use-spaces';
import { Button } from '@repo/design-system/ui/button';
import { TextField } from '@repo/design-system/ui/text-field';
import { usePendingCommand } from '@repo/sync/ui/sync-provider';
import type { FormEvent } from 'react';

/**
 * The spaces of the organization. A member opens a space through the notes
 * gate, which loads its notes first. Everyone is in the general space.
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

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get('name') ?? '').trim();
    if (name) {
      create.run({ id: crypto.randomUUID(), name, at: new Date().toISOString() });
      form.reset();
    }
  }

  return (
    <section aria-label="Spaces" className="flex flex-col gap-2">
      <h2 className="text-body text-fg">Spaces</h2>
      <ul className="flex flex-col gap-2">
        <li className="flex items-center justify-between gap-2 rounded-surface border border-line bg-surface px-3 py-2">
          <span className="text-body text-fg">General</span>
          <Button disabled={spaceId === generalSpaceId} onClick={() => onOpen(generalSpaceId)}>
            Open
          </Button>
        </li>
        {ids.map((id) => (
          <SpaceRow key={id} id={id} current={id === spaceId} onOpen={onOpen} />
        ))}
      </ul>
      <form className="flex items-end gap-2" onSubmit={onSubmit}>
        <TextField
          className="flex-1"
          label="New space"
          name="name"
          maxLength={maxSpaceNameLength}
        />
        <Button type="submit" disabled={create.pending}>
          {create.pending ? 'Creating…' : 'Create'}
        </Button>
      </form>
    </section>
  );
}

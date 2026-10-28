import { openNotes } from '@features/notes/gate';
import { NotesScreen } from '@features/notes/screens/notes-screen';
import { generalSpaceId } from '@repo/access/models/space';
import { useLoad } from '@repo/sync/ui/sync-provider';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';

import { rootRoute } from '@/routes/root';

function Notes() {
  const { space } = useSearch({ from: '/notes' });
  const navigate = useNavigate();
  const load = useLoad();
  return (
    <NotesScreen
      spaceId={space}
      onOpen={(spaceId) => openNotes({ navigate: (href) => navigate({ href }), load }, spaceId)}
    />
  );
}

/** The notes of one space. Only its gate, `openNotes`, navigates here. */
export const notesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notes',
  validateSearch: (search: Record<string, unknown>) => ({
    space: typeof search.space === 'string' && search.space ? search.space : generalSpaceId,
  }),
  component: Notes,
});

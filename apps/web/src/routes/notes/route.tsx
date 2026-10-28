import { NotesScreen } from '@features/notes/screens/notes-screen';
import { createRoute } from '@tanstack/react-router';

import { rootRoute } from '@/routes/root';

/** The notes screen. Only its gate, `openNotes`, navigates here. */
export const notesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notes',
  component: NotesScreen,
});

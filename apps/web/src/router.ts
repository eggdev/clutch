import { createRouter } from '@tanstack/react-router';

import { homeRoute } from '@/routes/home';
import { notesRoute } from '@/routes/notes/route';
import { rootRoute } from '@/routes/root';

/** Code-based routes. A route renders a screen; a gate loads what it needs. No route loaders. */
export const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, notesRoute]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

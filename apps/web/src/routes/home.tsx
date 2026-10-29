import { openNotes } from '@features/notes/gate';
import { Button } from '@repo/design-system/ui/button';
import { useLoad } from '@repo/sync/ui/sync-provider';
import { createRoute, useNavigate } from '@tanstack/react-router';

import { rootRoute } from '@/routes/root';

function Home() {
  const navigate = useNavigate();
  const load = useLoad();
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 p-4">
      <h1 className="text-heading text-fg">Clutch</h1>
      <p className="text-body text-fg-muted">
        A local-first app. Each change shows at once and syncs in the background.
      </p>
      <Button
        variant="primary"
        onClick={() => openNotes({ navigate: (href) => navigate({ href }), load })}
      >
        Open notes
      </Button>
    </main>
  );
}

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Home,
});

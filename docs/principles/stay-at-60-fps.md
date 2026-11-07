# Stay at 60 FPS

The screen is ready when the person gets there. A tap, a scroll or a swipe
answers in the next frame, on every platform. Nobody hesitates because the app
is loading, fetching or rendering, and nothing hangs. This is a hard
requirement.

The app does the work before the person needs it. It reads the data on the
device, renders what is near the viewport, and loads what comes next ahead of
time.

It needs no server render. The app is a
[single-page app](./single-page-app.md): a navigation renders from the data
on the device, and never asks the host for a page.

## Rules

- **Navigation never waits on the network.** A page renders at once from what
  the app knows: the object pool, the session, the last screen. The sync
  engine refreshes it in the background. A spinner shows only when the app has nothing to show
  yet, such as the first visit to a page. See [local first](./local-first.md).
- **The next screen is ready before the tap.** A link that is in view, or
  under the pointer, loads its route module and the records that its gate
  needs. The tap then only paints.
- **Scrolling never waits.** Content below the fold is ready before it scrolls
  into view. A long list renders the rows near the viewport, and loads the
  next rows ahead of the scroll. Each image and embed keeps its size, and
  starts to load before it enters the viewport. A scroll never stalls, jumps
  or shows an empty row.
- **Pick the means that makes it ready.** Read from the object pool, load
  ahead of the scroll, preload, or render at build time. A server render is an
  exception with a reason. See [single-page app](./single-page-app.md#rules).
  The person sees the result, never the method.
- **A check runs ahead.** A guard, such as a setup gate, checks in the
  background on every page. A page that it already allowed never waits for it
  again.
- **Keep work off the main thread.** No task runs longer than 50 ms. Split or
  move heavy work: file parsing, hashing, large lists.
- **A slow write is never a stuck screen.** A command that waits for the
  server shows progress in the control that sent it, and the reason when the
  server rejects it. The rest of the page stays usable.
- **No wait goes on without end.** A page is never blank. A screen that waits
  for data says what it waits for. After a set time it shows what the device
  has, and it keeps trying in the background. A refused connection is an
  error that the person sees, never a retry loop behind a loading state.
- **The web host answers every request the router makes.** A 404 for a route
  module can stall a navigation.

## How we check it

- A browser journey navigates on a network with 300 ms of latency. It fails
  when a page that the account already saw shows a spinner, or when a task
  runs longer than 50 ms. The
  [client performance](../contributing/architecture/client-performance.md)
  page names the test.
- A browser journey scrolls each long list fast, on the same network. It
  fails on an empty row, a placeholder in view, a jump, or a frame longer than
  the frame budget.
- Measure on a preview as well as locally. A local API answers in milliseconds
  and hides waits that a deployed one shows.

## Example

The slow path makes a page wait for a guard it already passed:

```tsx
function ProjectLayout({ children }: { children: React.ReactNode }) {
  const setup = useSetupCheck(); // fetches on every navigation
  if (setup.loading) return <Spinner />;
  return children;
}
```

The fast path reads the setup record from the object pool. It renders at once
and redirects only when setup is missing:

```tsx
function ProjectLayout({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  const setup = useRecord(setupModel, projectId); // no request
  if (setup && !setup.done) return <Navigate to="/setup" />;
  return children;
}
```

The slow path fetches a row's details when the row scrolls into view, so the
person sees empty rows:

```tsx
function Row({ id }: { id: string }) {
  const details = useFetchOnVisible(`/api/items/${id}`); // a request at the edge of the viewport
  return details ? <ItemRow item={details} /> : <EmptyRow />;
}
```

The fast path renders only the rows near the viewport, from the object pool.
It asks for the next page while the person is still rows away from it:

```tsx
function ItemList({ ids }: { ids: ReadonlyArray<string> }) {
  return (
    <VirtualList
      ids={ids}
      overscan={10} // rows rendered past each edge of the viewport
      onNearEnd={loadNextPage} // fires 20 rows before the last one
      renderRow={(id) => <ItemRow id={id} />} // reads the object pool
    />
  );
}
```

## Related

- [Single-page app](./single-page-app.md)
- [Local first](./local-first.md)
- [Fast first load](./fast-first-load.md)
- [Compositor-only motion](./compositor-only-motion.md)

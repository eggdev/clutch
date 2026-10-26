# Stay at 60 FPS

The app answers every tap in the next frame, on every platform. Nobody ever
refreshes a page to get somewhere. This is a hard requirement.

## Rules

- **Navigation never waits on the network.** A page renders at once from what
  the app knows: the local store, the session, the last screen. It refreshes
  in the background. A spinner shows only when the app has nothing to show
  yet, such as the first visit to a page. See [local first](./local-first.md).
- **A check runs ahead.** A guard, such as a setup gate, checks in the
  background on every page. A page that it already allowed never waits for it
  again.
- **Keep work off the main thread.** No task runs longer than 50 ms. Split or
  move heavy work: file parsing, hashing, large lists.
- **A slow request is never a stuck screen.** It shows progress in the control
  that sent it and a retry when it fails. The rest of the page stays usable.
- **Static hosting answers every request the router makes.** A 404 for a
  route module can stall a navigation.

## How we check it

- A browser journey navigates on a network with 300 ms of latency. It fails
  when a page that the account already saw shows a spinner, or when a task
  runs longer than 50 ms. The
  [client performance](../contributing/architecture/client-performance.md)
  page names the test.
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

The fast path renders at once and lets the guard redirect only when it fails:

```tsx
function ProjectLayout({ children }: { children: React.ReactNode }) {
  useSetupCheck({ onMissing: () => router.replace('/setup') }); // runs in the background
  return children;
}
```

## Related

- [Local first](./local-first.md)
- [Fast first load](./fast-first-load.md)
- [Compositor-only motion](./compositor-only-motion.md)

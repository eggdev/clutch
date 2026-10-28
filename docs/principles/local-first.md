# Local first

A user action never waits on the network. A screen reads the object pool and
calls a command. It never starts a request. The sync engine moves changes to
and from the server in the background. The user sees the result of an action
in the next frame, and the server confirms it later.

## Reads

- The device keeps the user's working set in the local database. Boot loads
  the object pool from it before the first paint.
- A screen reads the object pool. A screen that shows data the device has
  never shows a spinner or a skeleton.
- Search, filters and the command palette query the object pool. They send no
  request.
- Each component subscribes to the records it reads. A change to one record
  re-renders only the components that read it. See
  [reading records](../contributing/architecture/client.md#reading-records).
- A screen loads a large or rare table on demand. It shows the first rows it
  has, and it shows the loading state only for rows it does not have.

## Writes

- A command changes the object pool at once and adds a transaction to the
  transaction queue. The sync engine sends the queue in batches.
- The server decides. It accepts or rejects each transaction. On a rejection,
  the object pool drops the local change and the screen tells the user what
  failed. See [normalized source of truth](./normalized-source-of-truth.md#client-copies).
- Some writes wait for the server: a write that moves money, gives consent,
  changes access or touches a
  [hard invariant](../contributing/project-intent.md#hard-invariants). Such a
  command has `waits: 'server'`. The control that sent it shows a pending
  state, and the rest of the screen stays live.

## Network and device storage

Only `packages/sync` uses the network or device storage on the client. The
[client lint rules](../contributing/setup/lint-rules.md#client-code) reject
`fetch`, `WebSocket`, `localStorage` and the other network and storage calls
everywhere else.

## Boot

Render first, then connect. When the device has a local database, render the
object pool at once and connect the sync engine after the first paint. When
the server ends the session, it closes the socket with code 4401. The client
then clears the local database and opens the sign-in layout.

## Example

The slow path waits for the server before the screen changes:

```ts
async function rename(issue: Issue, title: string) {
  showSpinner();
  const response = await fetch(`/api/issues/${issue.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
  setIssue(await response.json());
  hideSpinner();
}
```

The local-first path calls a command, and the screen re-renders from the
object pool:

```tsx
const rename = useCommand(renameNote);
rename({ id: note.id, title, at: new Date().toISOString() }); // next frame shows the new title
```

## Related

- [Fast first load](./fast-first-load.md)
- [Keyboard first](./keyboard-first.md)
- [Normalized source of truth](./normalized-source-of-truth.md)
- [Local-first sync](../contributing/architecture/local-first-sync.md)

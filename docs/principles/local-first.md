# Local first

A user action never waits on the network. The interface reads a local store
and writes to it first. The sync engine moves changes to and from the server in
the background. The user sees the result of an action in the next frame, and
the server confirms it later.

## Reads

- The device keeps the user's working set in a local store. Boot hydrates the
  store from device storage before the first paint.
- A screen reads the local store. A screen that shows data the device has
  never shows a spinner or a skeleton.
- Search, filters and the command palette query the local store. They send no
  request.
- Each component subscribes to the fields it reads. A change to one field of
  one record re-renders the components that read that field, and no others.
- A screen loads a large or rare table on demand. It shows the first rows it
  has, and it shows the loading state only for rows it does not have.

## Writes

- A mutation changes the local store at once and adds a transaction to a queue.
  The sync engine sends the queue in batches.
- The server decides. It accepts or rejects each transaction. On a rejection,
  the store rolls back the change and the screen tells the user what failed.
  See [normalized source of truth](./normalized-source-of-truth.md#client-copies).
- Some writes wait for the server: a write that moves money, gives consent,
  changes access or touches a
  [hard invariant](../contributing/project-intent.md#hard-invariants). The
  control that sent it shows a pending state. The rest of the screen stays
  live. The [sync page](../contributing/architecture/local-first-sync.md) lists
  these writes.

## Boot

Render first, then authenticate. When the device has a local store, render it
at once and verify the session in the background. The first request that
returns 401 deletes the local store and opens sign-in. When the device has no
local store, render the sign-in layout.

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

The local-first path changes the store, and the screen re-renders from it:

```ts
function rename(issue: Issue, title: string) {
  store.issues.update(issue.id, { title }); // next frame shows the new title
}
```

## Related

- [Fast first load](./fast-first-load.md)
- [Keyboard first](./keyboard-first.md)
- [Normalized source of truth](./normalized-source-of-truth.md)
- [Local-first sync](../contributing/architecture/local-first-sync.md)

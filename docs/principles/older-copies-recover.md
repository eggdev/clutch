# Older copies always recover

An installed build is older than the server it talks to. It holds copies that
the older build wrote: a cached document, a queued write, a request shape. The
server changes its rules and its data under those copies. Each copy must reach
an end: the server accepts it, or the client drops it and recovers from the
owner's copy. A copy that retries forever blocks the person until they delete
the app.

## Rules

- A queued write ends. Retry only a failure that can clear on its own: no
  network, a timeout, a rate limit or a `5xx`. A `4xx` refusal is final.
- A final refusal removes the write from the queue, reads the owner's copy
  again and tells the person what did not save. The writes and commands behind
  it run.
- A server rule that gets stricter refuses an old request with a `4xx` and a
  stable code. A `5xx` for an old shape tells the client to retry a request
  that can never pass.
- A reader that cannot read a stored copy discards it and reads again from the
  owner. It never crashes and never shows a guess.
- A change to a server rule, a field or a stored shape adds a test that feeds
  the older copy through today's code and asserts that the session recovers.

## Example

```ts
// A device from an older build kept an edit that today's rules refuse.
await disk.set(
  JSON.stringify({
    schemaVersion: 1,
    document,
    dirty: {},
    pending: { mutationId: 'old-edit', baseVersion: 'v1', values: { title: 'Old shape' } },
  }),
);
await run(session.open());
expect(session.hasChanges).toBe(false); // the refused edit left the queue
expect(session.refused).toBe(true); // the screen says what did not save
await run(session.execute(command)); // the next command runs
```

## Related

- [Two-way and one-way doors](./two-way-doors.md): the shapes that outlive a deploy
- [Fail loudly in the right module](./fail-loudly.md): a refusal has a stable code
- [Local first](./local-first.md): why devices hold copies at all

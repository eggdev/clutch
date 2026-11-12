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
- A server error ends too. The server runs the change once more, then asks
  its database for the head of the log. A database that answers makes the
  failure final. A database that does not answer leaves the write queued.
- A server rule that gets stricter refuses an old request with a `4xx` and a
  stable code. A `5xx` for an old shape tells the client to retry a request
  that can never pass.
- A change to a request shape that an installed build sends is one-way when the
  server stops taking an input. `check-contract` fails that change unless
  `contract.json` names it under `breaks`. See
  [two-way and one-way doors](./two-way-doors.md).
- A copy is checked where it enters, and nowhere else. The doors are the saved
  copy at load, a record from a server delta, and a command that the app runs.
- A stored copy that does not fit is dropped whole. The client keeps no part
  of it, and asks the server again for each group that the copy held.
- The outer shape of a stored copy is checked before its records. Saved text
  that is no JSON, or a copy with no tables, is dropped the same way.
- A saved command that does not fit is refused at load with the code
  `invalid-input`. It leaves the queue and is never sent. The commands behind
  it run.
- A record from a server delta that does not fit is not stored. The other
  changes of the delta apply.
- A record of a model that the build does not declare is not stored either.
  A stored record that the build cannot check would unfit the whole copy at
  the next start.
- A copy that left a record out names the build that did so. The next build
  drops the confirmed records of that copy and loads again from 0. The record
  comes back after the update.
- Each drop and each refusal is reported in one sentence that names the record
  or the command. `packages/sync/runtime/pool.test.ts` and
  `packages/sync/runtime/pool-doors.test.ts` check each door.
- There is no migration of a local copy. An older copy is dropped or refused,
  and it is never rewritten.
- A change to a server rule, a field or a stored shape adds a test. The test
  feeds the older copy through today's code and asserts that the session
  recovers.

## Example

```ts
// A build named `old` gets a record of a model that it does not declare.
const old = createPool([], declared, { report });
old.nameBuild('old');
old.applyDeltas([{ syncId: 2, transactionId: null, changes: [labelChange] }]);
// The record is not stored, and the saved copy names the build that left it out.
expect(old.snapshot().leftOutBy).toBe('old');

// The next build loads that copy, then loads each record again from the server.
const next = createPool([], declared, { report });
next.load(old.snapshot());
next.nameBuild('new');
expect(next.lastSyncId()).toBe(0);
```

`packages/sync/runtime/pool-doors.test.ts` holds this case.

## Related

- [Two-way and one-way doors](./two-way-doors.md): the shapes that outlive a deploy
- [Fail loudly in the right module](./fail-loudly.md): a refusal has a stable code
- [Local first](./local-first.md): why devices hold copies at all

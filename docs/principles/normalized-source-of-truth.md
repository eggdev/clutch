# Normalized source of truth

Each fact has exactly one owner record. Every other copy is derived from that
record and is disposable. The test: delete the copy. If the product recovers
with no data loss, it is a copy. If not, it is a second source of truth, and it
is not allowed.

A module never stores another module's facts. A domain module stores an account
ID and asks the identity module for the email address.

## Server copies

Indexes, projections, KV maps and counters are caches of the owner record.

- The write that changes the owner record also updates or deletes the copy, in
  the same transaction or before the response returns.
- A TTL alone is never the invalidation.
- A rebuild from a partial read writes nothing and fails. See
  [fail loudly](./fail-loudly.md).

## Client copies

Device caches can be stale while offline.

- Each copy records the version it came from.
- When online, a copy that is behind updates to the latest version.
- A copy is deleted when access is lost (401 or 403).
- A copy never decides a command, a permission or a business transition. The
  server decides.

## Example

A saved copy that the session cannot read falls back to an authorized read from
the owner:

```ts
function readSaved(raw: string | null): Saved | null {
  if (!raw) return null;
  const saved = JSON.parse(raw);
  return saved?.schemaVersion === 1 ? saved : null; // null means: read from the server
}
```

## Related

- [Fail loudly at the right layer](./fail-loudly.md)
- [Two-way and one-way doors](./two-way-doors.md)

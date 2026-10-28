# Fail loudly in the right module

Fail in the first module that can name the mistake and can still refuse the bad
write. A later quiet fallback hides which fact was missing.

- A loud failure is a typed error with a stable code. It reaches the caller or
  the user. Code never logs it and continues.
- Do not continue with partial data. That rules out `catch {}` that continues,
  `?? default` on a fact that must exist, an empty list when the read failed,
  and a fallback that writes.

A disposable client copy is the one exception. When its read fails, it falls
back to a fresh read from the owner, never to a guess. See
[normalized source of truth](./normalized-source-of-truth.md).

## Example

```ts
if (!base) throw new SyncError('sync_base_expired'); // before the save, not after
```

The command refuses the write and names the missing fact. The client shows the
error and reloads.

## Related

- [Fix the root bottleneck](./fix-the-root-bottleneck.md)

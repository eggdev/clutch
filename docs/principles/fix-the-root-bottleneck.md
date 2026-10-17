# Fix the root bottleneck

Fix the root bottleneck. Do not mask it with timeouts, fallbacks or degraded
modes. Extra wait time or a quieter path can make the symptom go away while the
cause stays. A workaround that hides slowness is acceptable only as a temporary
step, with an issue for the root fix linked in the same change.

## Example

Each authorization check reads one shared access store, and it gets slow. The
easy mask is to cache grants or raise timeouts. A grant cache can serve a
revoked grant, so the mask breaks an isolation invariant too. The root fix is
to shard the access store, so each check reads a small shard.

## Related

- [Fail loudly at the right layer](./fail-loudly.md)
- [Local first](./local-first.md): the network is the client's root
  bottleneck. Remove the request from the user's path.

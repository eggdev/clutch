import type { Change, Delta } from '@repo/sync/types/protocol';

/**
 * A change as a connection that loaded `loaded` sees it, or nothing. A change
 * in a loaded group comes as it is. A change of a record that left each
 * loaded group comes as a delete, with no data, so the client drops its copy
 * and does not learn where the record went. `left` stays on the server.
 */
function seenChange(change: Change, loaded: ReadonlySet<string>): Change | undefined {
  const { left, ...sent } = change;
  if (sent.groups.some((group) => loaded.has(group))) {
    return sent;
  }
  const gone = (left ?? []).filter((group) => loaded.has(group));
  return gone.length
    ? { model: change.model, id: change.id, action: 'delete', data: null, groups: gone }
    : undefined;
}

/** True when the change is in one of the groups, or left one of them. */
function touches(change: Change, groups: ReadonlySet<string>) {
  return [...change.groups, ...(change.left ?? [])].some((group) => groups.has(group));
}

/**
 * The part of a delta that a connection sees, or nothing. The backlog, the
 * backfill and the live stream all use it, so a move looks the same on each.
 * `only` keeps the changes that touch those groups, as a backfill of one
 * group does. Each change is still judged by every loaded group: a client
 * that holds a record through another group gets the move as an upsert.
 */
export function seenDelta(
  delta: Delta,
  loaded: ReadonlySet<string>,
  only: ReadonlySet<string> = loaded,
): Delta | undefined {
  const changes = delta.changes.flatMap((change) => {
    const seen = touches(change, only) ? seenChange(change, loaded) : undefined;
    return seen ? [seen] : [];
  });
  return changes.length ? { ...delta, changes } : undefined;
}

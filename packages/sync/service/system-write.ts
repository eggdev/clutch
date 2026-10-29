import type { DrizzleDatabase } from '@repo/sync/service/database';
import { EventLog } from '@repo/sync/service/event-log';
import type { Change } from '@repo/sync/types/protocol';
import { Effect } from 'effect';

/**
 * Commits changes as the system actor: for code that is not a command, such
 * as a route or a webhook. No person acts, so no access rule runs. `key` must
 * be the same each time the same outside event arrives, so a repeat commits
 * once. A webhook uses the event ID of its sender.
 */
export function commitAsSystem<E, R>(
  organizationId: string,
  key: string,
  write: (db: DrizzleDatabase) => Effect.Effect<ReadonlyArray<Change>, E, R>,
) {
  return EventLog.pipe(Effect.flatMap((log) => log.commit(organizationId, `system:${key}`, write)));
}

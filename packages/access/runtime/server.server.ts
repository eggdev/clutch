import { createSpaceServer } from '@repo/access/commands/create-space.server';
import { joinSpaceServer } from '@repo/access/commands/join-space.server';
import { leaveSpaceServer } from '@repo/access/commands/leave-space.server';
import { accessContract } from '@repo/access/contract/access';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { migratePackage } from '@repo/sync/service/migrations';
import { serverPackage } from '@repo/sync/service/server-package.server';

/** Runs the migrations of the access tables. drizzle-kit writes them. */
export function migrateAccess(db: DrizzleDatabase) {
  return migratePackage(db, 'access', new URL('../repo/migrations', import.meta.url));
}

/**
 * The server half of the access package: the server change of each command and
 * its migrations. A command with no server change here does not compile. The
 * server app lists it in `packages`.
 */
export const accessServer = serverPackage(accessContract, {
  changes: [createSpaceServer, joinSpaceServer, leaveSpaceServer],
  migrate: migrateAccess,
});

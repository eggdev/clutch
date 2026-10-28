import { spaceModel } from '@repo/access/models/space';
import { spaces } from '@repo/access/repo/schema';
import type { SpaceRow } from '@repo/access/repo/schema';
import type { Space } from '@repo/access/types/space';
import { upsertChange } from '@repo/sync/models/change';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';

/** The public record of a row. The table shape stays inside this package. */
export function toRecord(row: SpaceRow): Space {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The row of a record, in one organization. */
export function toRow(record: Space, organizationId: string): SpaceRow {
  return {
    id: record.id,
    organizationId,
    name: record.name,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

/** The change that tells each client in the organization about a space. */
export function spaceChange(row: SpaceRow) {
  return upsertChange(spaceModel, toRecord(row), { organizationId: row.organizationId });
}

export function findSpace(db: DrizzleDatabase, organizationId: string, id: string) {
  return db
    .select()
    .from(spaces)
    .where(and(eq(spaces.id, id), eq(spaces.organizationId, organizationId)))
    .pipe(Effect.map((rows) => rows[0]));
}

export function insertSpace(db: DrizzleDatabase, row: SpaceRow) {
  return db
    .insert(spaces)
    .values(row)
    .returning()
    .pipe(Effect.map((rows) => rows[0] ?? row));
}

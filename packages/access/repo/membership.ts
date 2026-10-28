import { membershipId, membershipModel } from '@repo/access/models/membership';
import { memberships } from '@repo/access/repo/schema';
import type { MembershipRow } from '@repo/access/repo/schema';
import type { Membership } from '@repo/access/types/membership';
import { deleteChange, upsertChange } from '@repo/sync/models/change';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';

export function toRecord(row: MembershipRow): Membership {
  return {
    id: membershipId(row.spaceId, row.userId),
    spaceId: row.spaceId,
    userId: row.userId,
    joinedAt: row.joinedAt.toISOString(),
  };
}

export function toRow(record: Membership, organizationId: string): MembershipRow {
  return {
    organizationId,
    spaceId: record.spaceId,
    userId: record.userId,
    joinedAt: new Date(record.joinedAt),
  };
}

/** The change that tells the user about a new membership. */
export function joinedChange(row: MembershipRow) {
  return upsertChange(membershipModel, toRecord(row), { organizationId: row.organizationId });
}

/** The change that tells the user that a membership ended. */
export function leftChange(row: MembershipRow) {
  return deleteChange(membershipModel, toRecord(row), { organizationId: row.organizationId });
}

const keyOf = (organizationId: string, spaceId: string, userId: string) =>
  and(
    eq(memberships.organizationId, organizationId),
    eq(memberships.spaceId, spaceId),
    eq(memberships.userId, userId),
  );

export function findMembership(
  db: DrizzleDatabase,
  organizationId: string,
  spaceId: string,
  userId: string,
) {
  return db
    .select()
    .from(memberships)
    .where(keyOf(organizationId, spaceId, userId))
    .pipe(Effect.map((rows) => rows[0]));
}

export function insertMembership(db: DrizzleDatabase, row: MembershipRow) {
  return db
    .insert(memberships)
    .values(row)
    .returning()
    .pipe(Effect.map((rows) => rows[0] ?? row));
}

export function deleteMembership(db: DrizzleDatabase, row: MembershipRow) {
  return db.delete(memberships).where(keyOf(row.organizationId, row.spaceId, row.userId));
}

/** The spaces that a user is a member of, not counting the general space. */
export function spacesOf(db: DrizzleDatabase, organizationId: string, userId: string) {
  return db
    .select({ spaceId: memberships.spaceId })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)))
    .pipe(Effect.map((rows) => rows.map((row) => row.spaceId)));
}

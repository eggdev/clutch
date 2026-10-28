import { pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/** The owner records of spaces. Each space belongs to one organization. */
export const spaces = pgTable('spaces', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export type SpaceRow = typeof spaces.$inferSelect;

/** Who is in which space. The general space has no rows: every actor is in it. */
export const memberships = pgTable(
  'space_memberships',
  {
    organizationId: text('organization_id').notNull(),
    spaceId: text('space_id').notNull(),
    userId: text('user_id').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.spaceId, table.userId] })],
);

export type MembershipRow = typeof memberships.$inferSelect;

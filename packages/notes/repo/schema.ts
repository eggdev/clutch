import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** The owner records of notes. Each note belongs to one organization. */
export const notes = pgTable('notes', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export type NoteRow = typeof notes.$inferSelect;

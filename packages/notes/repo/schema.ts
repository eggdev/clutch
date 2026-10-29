import { integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/** The owner records of notes. Each note belongs to one space of one organization. */
export const notes = pgTable('notes', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  spaceId: text('space_id').notNull().default('general'),
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export type NoteRow = typeof notes.$inferSelect;

/** The note count of each space, written by the `count-notes` job. */
export const spaceNoteCounts = pgTable(
  'space_note_counts',
  {
    organizationId: text('organization_id').notNull(),
    spaceId: text('space_id').notNull(),
    noteCount: integer('note_count').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.spaceId] })],
);

export type SpaceNoteCountRow = typeof spaceNoteCounts.$inferSelect;

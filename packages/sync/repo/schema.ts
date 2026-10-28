import type { Change } from '@repo/sync/types/protocol';
import {
  bigint,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** One row for each organization: the next sync ID. A write locks this row. */
export const syncCounters = pgTable('sync_counters', {
  organizationId: text('organization_id').primaryKey(),
  nextSyncId: bigint('next_sync_id', { mode: 'number' }).notNull(),
});

/** The append-only log. Each event has a sync ID that only increases in its organization. */
export const syncEvents = pgTable(
  'sync_events',
  {
    organizationId: text('organization_id').notNull(),
    syncId: bigint('sync_id', { mode: 'number' }).notNull(),
    transactionId: text('transaction_id'),
    changes: jsonb('changes').$type<ReadonlyArray<Change>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.syncId] }),
    uniqueIndex('sync_events_transaction').on(table.organizationId, table.transactionId),
  ],
);

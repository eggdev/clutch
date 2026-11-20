import type { Change } from '@repo/sync/types/protocol';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
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

/**
 * The append-only log. Each event has a sync ID that only increases in its
 * organization, and the sync groups of all its changes. A GIN index finds the
 * events of a client's groups.
 */
export const syncEvents = pgTable(
  'sync_events',
  {
    organizationId: text('organization_id').notNull(),
    syncId: bigint('sync_id', { mode: 'number' }).notNull(),
    transactionId: text('transaction_id'),
    changes: jsonb('changes').$type<ReadonlyArray<Change>>().notNull(),
    groups: text('groups')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.syncId] }),
    uniqueIndex('sync_events_transaction').on(table.organizationId, table.transactionId),
    index('sync_events_groups').using('gin', table.groups),
  ],
);

/**
 * The proof that a transaction applied, for each event that the trim
 * deleted: its organization, its ID, the sync ID of its event and the time of
 * that event. The trim moves the row here in the statement that deletes the
 * event, so a transaction that a client sends again applies once.
 */
export const syncTransactions = pgTable(
  'sync_transactions',
  {
    organizationId: text('organization_id').notNull(),
    transactionId: text('transaction_id').notNull(),
    syncId: bigint('sync_id', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.transactionId] })],
);

/**
 * The last state of each record that the log holds: its groups, the sync ID
 * of its last change, its last data, and whether that change deleted it. A
 * commit updates the row in the transaction of its event, so the next change
 * of the record knows the groups that it leaves. A group load reads the
 * records of a group from here, with a GIN index on the groups.
 */
export const syncRecords = pgTable(
  'sync_records',
  {
    organizationId: text('organization_id').notNull(),
    model: text('model').notNull(),
    recordId: text('record_id').notNull(),
    groups: text('groups').array().notNull(),
    syncId: bigint('sync_id', { mode: 'number' }).notNull(),
    data: jsonb('data').$type<Readonly<Record<string, unknown>>>(),
    deleted: boolean('deleted').notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.model, table.recordId] }),
    index('sync_records_groups').using('gin', table.groups),
  ],
);

/**
 * The outbox: each job that a server change, a route or a schedule asks for.
 * A server change writes its jobs in its own transaction, so a rollback drops
 * them. The job runner claims due jobs after the commit. The ID makes a job
 * run once, so a repeated request does nothing new.
 */
export const outboxJobs = pgTable(
  'sync_jobs',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id'),
    name: text('name').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    status: text('status').$type<'pending' | 'running' | 'done' | 'failed'>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    runAt: timestamp('run_at', { withTimezone: true, mode: 'date' }).notNull(),
    lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'date' }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [index('sync_jobs_due').on(table.status, table.runAt)],
);

export type JobRow = typeof outboxJobs.$inferSelect;

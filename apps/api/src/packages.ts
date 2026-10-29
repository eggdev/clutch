import { accessServerChanges } from '@repo/access/runtime/handlers.server';
import { migrateAccess } from '@repo/access/runtime/migrate.server';
import { notesServerChanges } from '@repo/notes/runtime/handlers.server';
import { notesJobs } from '@repo/notes/runtime/jobs.server';
import { migrateNotes } from '@repo/notes/runtime/migrate.server';
import { notesRoutes } from '@repo/notes/runtime/routes.server';
import { syncSchedules } from '@repo/sync/runtime/jobs.server';
import { migrateSync } from '@repo/sync/runtime/migrate.server';

/** The server half of every command. The `command` generator adds each package here. */
export const serverChanges = [...notesServerChanges, ...accessServerChanges];

/** The migrations of each package, in order. The sync tables come first. */
export const migrations = [migrateSync, migrateNotes, migrateAccess];

/** The jobs of each package. The `job` generator adds each package here. */
export const jobs = [...notesJobs];

/** The schedules of each package. Their jobs run without a separate entry. */
export const schedules = [...syncSchedules];

/** The HTTP routes of each package, such as webhooks. */
export const routes = [...notesRoutes];

import { accessServerChanges } from '@repo/access/runtime/handlers.server';
import { migrateAccess } from '@repo/access/runtime/migrate.server';
import { notesServerChanges } from '@repo/notes/runtime/handlers.server';
import { migrateNotes } from '@repo/notes/runtime/migrate.server';
import { migrateSync } from '@repo/sync/runtime/migrate.server';

/** The server half of every command. The `command` generator adds each package here. */
export const serverChanges = [...notesServerChanges, ...accessServerChanges];

/** The migrations of each package, in order. The sync tables come first. */
export const migrations = [migrateSync, migrateNotes, migrateAccess];

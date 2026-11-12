import { spaceGroup } from '@repo/access/contract/access';
import { command } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { text } from '@repo/sync/contract/fields';
import { job } from '@repo/sync/contract/job';
import { load, record } from '@repo/sync/contract/record';
import type { RowOf } from '@repo/sync/contract/record';
import { route } from '@repo/sync/contract/route';

/**
 * The contract of notes: the example package. This file is the one
 * declaration of each record, command and load function of the package. The
 * object pool, the server, the manifest and each tool read it.
 */

/** The longest title. The field below, the body of the import route and the screen all read it. */
export const maxTitleLength = 200;
/** The title of a note, declared once: the record and each input that carries a title use it. */
const title = text({ max: maxTitleLength });

/**
 * A note, as the server sends it and the object pool holds it. A note is in
 * the group of its space, so only members of the space get it. Dates are ISO
 * strings.
 */
export const noteRecord = record('Note', {
  fields: {
    id: 'string',
    spaceId: 'string',
    title,
    createdAt: 'string',
    updatedAt: 'string',
  },
  groups: [spaceGroup.by('spaceId')],
});
export type Note = RowOf<typeof noteRecord>;

/**
 * The number of notes in one space. It is server data: the `count-notes` job
 * writes it, and no command changes it. It is in the group of its space, so
 * it loads with the notes of the space. The ID is the space ID.
 */
export const spaceNoteCountRecord = record('SpaceNoteCount', {
  fields: { id: 'string', spaceId: 'string', noteCount: 'number', updatedAt: 'string' },
  groups: [spaceGroup.by('spaceId')],
});
export type SpaceNoteCount = RowOf<typeof spaceNoteCountRecord>;

/**
 * The load function of notes: a gate asks for the notes of one space. An
 * agent reads the same notes through its tool, when it may load the space.
 */
export const notesOf = load('notes/of-space', noteRecord, spaceGroup, {
  tool: { says: 'List the notes of a space, by the ID of the space.', fields: ['title'] },
});

/**
 * Creates a note in a space. The note shows at once, and the server confirms
 * it later. The object pool gives the note its ID and the time, so a repeat
 * of the same run writes the same note.
 */
export const createNote = command('notes/create', {
  input: { id: 'new-id', spaceId: 'string', title, at: 'now' },
  waits: 'local',
  access: 'group',
  refuses: [],
  tool: {
    does: 'adds',
    idempotent: true,
    closed: true,
    says: 'Add a note to a space. Only a member of the space may add one.',
  },
});

/** Renames a note. The new title shows at once, and the server confirms it later. */
export const renameNote = command('notes/rename', {
  input: { id: 'string', title, at: 'now' },
  waits: 'local',
  access: 'group',
  refuses: [],
  tool: {
    does: 'changes',
    idempotent: true,
    closed: true,
    says: 'Change the title of a note. The last title that the server gets stands.',
  },
});

/**
 * The job that counts the notes of one space. A new note asks for it in its
 * own transaction. The code that runs it is in `jobs/count-notes.ts`.
 */
export const countNotesJob = job('notes/count-notes', { payload: { spaceId: 'string' } });

/**
 * The webhook that imports one note from an outside system. Each delivery has
 * an event ID, so a repeated delivery commits once. The code is in
 * `runtime/routes.server.ts`.
 */
export const importNote = route('notes/import-note', {
  method: 'POST',
  path: '/webhooks/notes',
  body: {
    eventId: 'string',
    organizationId: 'string',
    title,
  },
  says: 'An outside system posts one note to import it, signed with the webhook secret.',
});

export const notesContract = defineContract('notes', {
  records: [noteRecord, spaceNoteCountRecord],
  commands: [createNote, renameNote],
  loads: [notesOf],
  jobs: [countNotesJob],
  routes: [importNote],
});

import { countNotes } from '@repo/notes/jobs/count-notes';

/** The jobs of the notes package. The server app passes them to `JobRunner`. */
export const notesJobs = [countNotes];

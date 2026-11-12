/**
 * notes-sync: A note that one device adds or renames shows on another device without a reload, also after the first device was offline.
 * State: retained
 * Contract: docs/contributing/architecture/local-first-sync.md
 * Actor and platform: the dev actor, web on each journey device, two browser contexts as two devices. The native run uses the first device only.
 * Entry: the home page, then the Open notes button, which opens the notes gate
 * Prerequisites: the dev servers, from `mise exec -- bun run dev`
 * Isolation and cleanup: each run gets an organization of its own through the development identity, so it starts with no note and changes no other run. Delete `.data/` to drop them all.
 * Budget: 60 s
 *
 * | User action | Expected observation | Proof |
 * | --- | --- | --- |
 * | Open notes on two devices | Each shows the General space, and axe finds no violation on the home or notes page | heading assertion, axe check, `notes-open` screenshots |
 * | Add a note on the first device | The second device shows it, with no reload | value assertion |
 * | Rename the note on the first device | The second device shows the new title | value assertion |
 * | Rename it again while the first device is offline | The first device shows it at once, the second does not | value assertions |
 * | Bring the first device back online | The queued rename reaches the second device | value assertion |
 * | An agent adds a note through its tool, `notes_create`, as the same person | Both devices show the note, and the first device holds exactly the two notes of the run | value assertions, `settled` and `holds` |
 * | The runner asks the server through the list tool, `notes_of_space_list` | The server holds exactly the two notes, the first with its last title | `serverHolds` |
 *
 * Failure condition: a rename that the server never confirms stays only on the first device.
 * Driver: `mise exec -- bun run journey notes-sync`
 * Evidence: the Playwright list output, the screenshots in `test-results/visual/`, and a trace and the axe report in `test-results/journeys/` on failure
 * Limits: one actor and one space. The agent is the same actor on the same `/mcp` tool path. The native run compiles the same steps to a Maestro flow, and it runs the first device only. Its flow skips the second device, the axe checks and the pool check, and on iOS it stays online. On a device, a `see` after a `fill` matches the typed text, so it does not prove the write alone. The `serverHolds` step proves that the note and its renames reached the server, and the agent step proves that a note from the server reaches the device. It does not prove sign-out, access rules or a server restore.
 */
import { journey } from '@repo/journeys/testing/journey';
import {
  accessible,
  button,
  field,
  fieldWith,
  fill,
  gone,
  heading,
  holds,
  offline,
  onSecond,
  open,
  see,
  serverHolds,
  settled,
  shot,
  submit,
  tap,
  tool,
  webOnly,
} from '@repo/journeys/testing/steps';
import { createNote, noteRecord, notesOf } from '@repo/notes/contract/notes';

/**
 * Hides each note row except the first row of the list named "Notes" (the
 * "New note" field), the "No notes yet" line and the note count, as the
 * committed baselines do. Each run starts with no note, so the shot of the
 * whole page can replace them at the next baseline pull.
 */
const earlierNotes = `
  [role=list][aria-label="Notes"] > [role=listitem]:not(:first-child) { display: none !important; }
  [role=main] > div > div:not(:first-child):not(:has([role=list])) { display: none !important; }
  [role=main] > div > div:first-child > :not([role=heading]) { visibility: hidden !important; }
`;

/** Why a step has no native form. The native run prints the reason of each step it leaves out. */
const oneDevice = 'a native run has one device';
const axe = 'axe reads a web page';
const poolOfThePage = 'the runner reads the pool from the IndexedDB of the page';

/** The label of the title field of a note. */
const noteTitle = 'Note title';

const title = 'Journey note';
const renamed = 'Journey note renamed';
const offlineTitle = 'Journey note offline';
const agent = 'Agent note';

export const notesSync = journey('a note syncs to another device, also after an offline rename', [
  open('/'),
  see(button('Open notes')),
  shot('home'),
  // Opens the notes on the first device.
  open('/'),
  see(button('Open notes')),
  webOnly(accessible('home'), axe),
  tap(button('Open notes')),
  see(heading('General', 1)),
  webOnly(accessible('notes open'), axe),
  shot('notes-open', { style: earlierNotes }),
  // Opens the notes on the second device.
  webOnly(onSecond(open('/')), oneDevice),
  webOnly(onSecond(see(button('Open notes'))), oneDevice),
  webOnly(onSecond(accessible('home')), oneDevice),
  webOnly(onSecond(tap(button('Open notes'))), oneDevice),
  webOnly(onSecond(see(heading('General', 1))), oneDevice),
  webOnly(onSecond(accessible('notes open')), oneDevice),
  // Adds a note, then renames it.
  fill(field('New note'), title),
  tap(button('Add')),
  see(fieldWith(noteTitle, title)),
  webOnly(onSecond(see(fieldWith(noteTitle, title))), oneDevice),
  webOnly(onSecond(accessible('a synced note')), oneDevice),
  fill(fieldWith(noteTitle, title), renamed),
  submit(fieldWith(noteTitle, renamed)),
  see(fieldWith(noteTitle, renamed)),
  webOnly(onSecond(see(fieldWith(noteTitle, renamed))), oneDevice),
  // Renames it again while the first device is offline.
  offline(true),
  fill(fieldWith(noteTitle, renamed), offlineTitle),
  submit(fieldWith(noteTitle, offlineTitle)),
  see(fieldWith(noteTitle, offlineTitle)),
  webOnly(onSecond(see(fieldWith(noteTitle, renamed))), oneDevice),
  // Brings the first device back online.
  offline(false),
  webOnly(onSecond(see(fieldWith(noteTitle, offlineTitle))), oneDevice),
  webOnly(onSecond(gone(fieldWith(noteTitle, renamed))), oneDevice),
  // An agent adds a note through its tool, as the same person.
  tool(createNote, { spaceId: 'general', title: agent }),
  see(fieldWith(noteTitle, agent)),
  // The server holds what the first device wrote: its note, with the last title.
  serverHolds(notesOf, 'general', 'title', [agent, offlineTitle]),
  webOnly(onSecond(see(fieldWith(noteTitle, agent))), oneDevice),
  webOnly(settled(), poolOfThePage),
  webOnly(holds(noteRecord, 'title', [agent, offlineTitle]), poolOfThePage),
]);

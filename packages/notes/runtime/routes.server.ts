import { generalSpaceId } from '@repo/access/contract/access';
import { importNote } from '@repo/notes/contract/notes';
import { addNote } from '@repo/notes/service/add-note';
import { WebhookSignature } from '@repo/notes/service/webhook-signature';
import { bodyOf, defineRoute } from '@repo/sync/service/routes';
import { commitAsSystem } from '@repo/sync/service/system-write';
import { Effect } from 'effect';
import { HttpServerResponse } from 'effect/http';

/**
 * The note import webhook: an outside system posts one note. The pattern for
 * any webhook:
 *
 * 1. Check the signature of the raw body through a service.
 * 2. Read the body with `bodyOf`, which checks it against the declared route.
 * 3. Commit as the system actor, keyed by the sender's event ID, so a
 *    repeated delivery commits once. The write is the one that the command
 *    makes (`addNote`), so a rule of the write holds here too. Slow or outside
 *    work goes in a job.
 */
export const importNoteRoute = defineRoute(importNote, (request) =>
  Effect.gen(function* () {
    const body = yield* request.text;
    const signatures = yield* WebhookSignature;
    if (!(yield* signatures.verify(body, request.headers['x-notes-signature']))) {
      return HttpServerResponse.text('The signature is not valid.', { status: 401 });
    }
    const event = bodyOf(importNote, body);
    if (event === undefined) {
      return HttpServerResponse.text('The body is not a note event.', { status: 400 });
    }
    const syncId = yield* commitAsSystem(event.organizationId, `notes:${event.eventId}`, (db) =>
      addNote(db, {
        id: `import:${event.eventId}`,
        organizationId: event.organizationId,
        spaceId: generalSpaceId,
        title: event.title,
      }).pipe(Effect.map((change) => [change])),
    );
    return HttpServerResponse.jsonUnsafe({ syncId });
  }),
);

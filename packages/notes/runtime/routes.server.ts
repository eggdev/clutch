import { generalSpaceId } from '@repo/access/models/space';
import { countNotes } from '@repo/notes/jobs/count-notes';
import { insertNote, toChange } from '@repo/notes/repo/notes';
import { WebhookSignature } from '@repo/notes/service/webhook-signature';
import { ImportNoteEvent } from '@repo/notes/types/import-note';
import { Outbox } from '@repo/sync/service/jobs';
import { defineRoute } from '@repo/sync/service/routes';
import { commitAsSystem } from '@repo/sync/service/system-write';
import { Clock, Effect, Schema } from 'effect';
import { HttpServerResponse } from 'effect/http';

const decodeEvent = Schema.decodeUnknownEffect(Schema.fromJsonString(ImportNoteEvent));

/**
 * The note import webhook: an outside system posts one note. The pattern for
 * any webhook:
 *
 * 1. Check the signature of the raw body through a service.
 * 2. Decode the body with a schema.
 * 3. Commit as the system actor, keyed by the sender's event ID, so a
 *    repeated delivery commits once. Slow or outside work goes in a job.
 */
export const importNoteRoute = defineRoute({
  method: 'POST',
  path: '/webhooks/notes',
  handle: (request) =>
    Effect.gen(function* () {
      const body = yield* request.text;
      const signatures = yield* WebhookSignature;
      if (!(yield* signatures.verify(body, request.headers['x-notes-signature']))) {
        return HttpServerResponse.text('The signature is not valid.', { status: 401 });
      }
      const decoded = yield* decodeEvent(body).pipe(Effect.option);
      if (decoded._tag === 'None') {
        return HttpServerResponse.text('The body is not a note event.', { status: 400 });
      }
      const event = decoded.value;
      const outbox = yield* Outbox;
      const syncId = yield* commitAsSystem(event.organizationId, `notes:${event.eventId}`, (db) =>
        Effect.gen(function* () {
          const now = new Date(yield* Clock.currentTimeMillis);
          const row = yield* insertNote(db, {
            id: `import:${event.eventId}`,
            organizationId: event.organizationId,
            spaceId: generalSpaceId,
            title: event.title,
            createdAt: now,
            updatedAt: now,
          });
          yield* outbox.enqueue(
            db,
            countNotes,
            { spaceId: row.spaceId },
            { id: `notes/count:${row.id}`, organizationId: row.organizationId },
          );
          return [toChange(row)];
        }),
      );
      return HttpServerResponse.jsonUnsafe({ syncId });
    }),
});

/** The HTTP routes of the notes package. The server app adds them to its router. */
export const notesRoutes = [importNoteRoute];

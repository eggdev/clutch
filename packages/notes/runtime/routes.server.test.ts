import { expect, test } from 'bun:test';

import { notesContract } from '@repo/notes/contract/notes';
import { listNotes } from '@repo/notes/repo/notes';
import { importNoteRoute } from '@repo/notes/runtime/routes.server';
import { sign } from '@repo/notes/service/webhook-signature';
import { NotesTest } from '@repo/notes/testing/notes';
import { WebhookSignatureTest, webhookTestSecret } from '@repo/notes/testing/webhook';
import { Database } from '@repo/sync/service/database';
import { eventLog } from '@repo/sync/service/event-log';
import { Effect, Layer } from 'effect';
import { HttpServerRequest } from 'effect/http';

/** Posts a body to the import route with a signature, as an outside system does. */
function post(body: string, signature: string) {
  return importNoteRoute.handle(
    HttpServerRequest.fromWeb(
      new Request('http://api.test/webhooks/notes', {
        method: 'POST',
        body,
        headers: { 'x-notes-signature': signature },
      }),
    ),
  );
}

test('the import webhook checks the signature and the body, and a repeat commits once', async () => {
  const body = JSON.stringify({
    eventId: 'evt-1',
    organizationId: 'org-test',
    title: 'From outside',
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const signature = yield* sign(webhookTestSecret, body);
      const forged = yield* post(body, 'not-a-signature');
      const bad = yield* post('{}', yield* sign(webhookTestSecret, '{}'));
      const first = yield* post(body, signature);
      const repeat = yield* post(body, signature);
      const notes = yield* listNotes(yield* Database, 'org-test');
      return {
        statuses: [forged.status, bad.status, first.status, repeat.status],
        notes: notes.map((note) => note.title),
      };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(eventLog([notesContract]), WebhookSignatureTest).pipe(
          Layer.provideMerge(NotesTest()),
        ),
      ),
    ),
  );
  expect(result.statuses).toEqual([401, 400, 200, 200]);
  expect(result.notes).toEqual(['From outside']);
});

import { expect, test } from 'bun:test';

import { testActor } from '@repo/identity/testing/actor';
import { createNoteServer } from '@repo/notes/commands/create-note.server';
import { countNotes } from '@repo/notes/jobs/count-notes';
import { NotesTest } from '@repo/notes/testing/notes';
import { runDueJobs } from '@repo/sync/runtime/job-runner.server';
import { EventLog, EventLogLive } from '@repo/sync/service/event-log';
import { Effect, Layer } from 'effect';

const at = '2026-10-28T12:00:00.000Z';

test('a new note asks for a count, and the job commits the count of its space', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const log = yield* EventLog;
      for (const id of ['n1', 'n2']) {
        yield* log.commit(testActor.organizationId, id, (tx) =>
          createNoteServer.run(
            { id, spaceId: 'general', title: id, at },
            { db: tx, actor: testActor },
          ),
        );
      }
      const ran = yield* runDueJobs([countNotes]);
      const head = yield* log.head(testActor.organizationId);
      const deltas = yield* log.backfill(
        testActor.organizationId,
        head,
        new Set(['space:general']),
      );
      const counts = deltas
        .flatMap((delta) => delta.changes)
        .filter((change) => change.model === 'SpaceNoteCount')
        .map((change) => change.data);
      return { ran, counts };
    }).pipe(Effect.provide(Layer.provideMerge(EventLogLive, NotesTest()))),
  );
  expect(result.ran).toBe(2);
  expect(result.counts.at(-1)).toMatchObject({ id: 'general', spaceId: 'general', noteCount: 2 });
});

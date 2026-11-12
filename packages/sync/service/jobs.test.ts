import { afterAll, expect, test } from 'bun:test';

import { job } from '@repo/sync/contract/job';
import { defineJob } from '@repo/sync/service/jobs';
import type { JobContext } from '@repo/sync/service/jobs';
import { removeTypeFixtures, typeErrors } from '@repo/sync/testing/type-errors';
import { JobPayloadMismatch } from '@repo/sync/types/job-payload-mismatch';
import { Effect } from 'effect';

const context: JobContext = {
  jobId: 'job-1',
  organizationId: null,
  attempt: 1,
  commit: () => Effect.succeed(0),
};

const countDeclaration = job('notes/count', { payload: { spaceId: 'string' } });
const count = defineJob(countDeclaration, () => Effect.void);

test('a job runs on a payload that matches its declaration, and fails on one that does not', async () => {
  const ran = await Effect.runPromise(count.execute({ spaceId: 'general' }, context));
  expect(ran).toBeUndefined();
  const failure = await Effect.runPromise(Effect.flip(count.execute({ spaceId: 1 }, context)));
  expect(failure).toBeInstanceOf(JobPayloadMismatch);
  expect(failure).toMatchObject({ _tag: 'JobPayloadMismatch', job: 'notes/count' });
});

test('a job encodes its payload as the payload itself, since it is plain JSON', () => {
  expect(count.encode({ spaceId: 'general' })).toEqual({ spaceId: 'general' });
  expect(count.name).toBe('notes/count');
});

afterAll(removeTypeFixtures);

test('a job with a wrong payload does not compile', async () => {
  const errors = await typeErrors(`import { job } from '@repo/sync/contract/job';
import { Outbox, defineJob } from '@repo/sync/service/jobs';
import type { DrizzleDatabase } from '@repo/sync/service/database';
import { Effect } from 'effect';

const countDeclaration = job('notes/count', { payload: { spaceId: 'string' } });
const count = defineJob(countDeclaration, () => Effect.void);
export const wrongPayload = (db: DrizzleDatabase) =>
  Effect.gen(function* () {
    const outbox = yield* Outbox;
    yield* outbox.enqueue(db, count, { spaceId: 1 }, { id: 'j1', organizationId: null });
  });
`);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("Type 'number' is not assignable to type 'string'");
}, 30_000);

import { expect, test } from 'bun:test';

import { serverChange } from '@repo/sync/commands/server-change.server';
import { command } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import { defineGroup } from '@repo/sync/contract/groups';
import { load, record } from '@repo/sync/contract/record';
import { agentTools } from '@repo/sync/runtime/tools.server';
import type { ToolResult } from '@repo/sync/runtime/tools.server';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { SyncGroups } from '@repo/sync/service/sync-groups';
import { DatabaseTest } from '@repo/sync/testing/database';
import { Effect, Layer } from 'effect';

const actor = { userId: 'user-test', organizationId: 'org-test' };

const add = command('cards/add', {
  input: { id: 'new-id', title: 'string', at: 'now' },
  waits: 'local',
  access: 'organization',
  refuses: ['title-taken'],
  tool: { does: 'adds', idempotent: true, closed: true, says: 'Add a card.' },
});
const hide = command('cards/hide', {
  input: { id: 'string' },
  waits: 'server',
  access: 'organization',
  refuses: [],
  tool: 'none',
});
/** A task of the organization, which the add command writes. */
const taskRecord = record('Task', {
  fields: { id: 'string', title: 'string', at: 'string' },
  groups: [organizationGroup.ofScope],
});
const cards = defineContract('cards', {
  records: [taskRecord],
  commands: [add, hide],
  loads: [],
});

const addServer = serverChange(add, {
  run: (input, { refuse }) =>
    input.title === 'Taken'
      ? Effect.fail(refuse('title-taken', 'This title is taken.'))
      : Effect.succeed([
          {
            model: 'Task',
            id: input.id,
            action: 'upsert' as const,
            // A change built by hand. The title `Broken` writes a field of the wrong kind.
            data: { id: input.id, title: input.title === 'Broken' ? 7 : input.title, at: input.at },
            groups: [organizationGroup.of(actor.organizationId)],
          },
        ]),
});
const hideServer = serverChange(hide, { run: () => Effect.succeed([]) });
const tools = agentTools([addServer, hideServer], [cards]);

/** A file of a space: a card that its space group holds, and that a read tool lists. */
const spaceGroup = defineGroup('space');
const cardRecord = record('Card', {
  fields: { id: 'string', spaceId: 'string', title: 'string', at: 'string' },
  groups: [spaceGroup.by('spaceId')],
});
const fileCard = command('files/file-card', {
  input: { id: 'new-id', spaceId: 'string', title: 'string', at: 'now' },
  waits: 'server',
  access: 'organization',
  refuses: [],
  tool: { does: 'adds', idempotent: true, closed: true, says: 'File a card in a space.' },
});
const filing = defineContract('files', {
  records: [cardRecord],
  commands: [fileCard],
  loads: [
    load('files/of-space', cardRecord, spaceGroup, {
      tool: { says: 'List the cards of a space.', fields: ['title'] },
    }),
  ],
});
const fileServer = serverChange(fileCard, {
  run: (input) =>
    Effect.succeed([
      {
        model: 'Card',
        id: input.id,
        action: 'upsert' as const,
        data: { id: input.id, spaceId: input.spaceId, title: input.title, at: input.at },
        groups: [spaceGroup.of(input.spaceId)],
      },
    ]),
});
const fileTools = agentTools([fileServer], [filing]);

const groups = Layer.succeed(SyncGroups)({
  groupsFor: () => Effect.succeed({ eager: [], lazy: ['space:open'] }),
  canUse: () => Effect.succeed(true),
});

/** Runs a program with the event log over a fresh database. */
function withLog<A>(program: Effect.Effect<A, unknown, EventLog | SyncGroups>) {
  return Effect.runPromise(
    program.pipe(
      Effect.provide(
        Layer.provideMerge(Layer.mergeAll(eventLog([cards, filing]), groups), DatabaseTest()),
      ),
    ),
  );
}

/** The data of a read, or a failure with the result that came back instead. */
function dataOf(result: ToolResult): Record<string, unknown> {
  if (!('data' in result)) {
    throw new Error(`The read gave no data: ${JSON.stringify(result)}`);
  }
  return result.data;
}

test('the tool list holds each command that declares a tool, and no other', () => {
  expect(tools.list.map((tool) => tool.name)).toEqual(['cards_add']);
});

test('a call runs the server change through the event log, with each stamp filled', async () => {
  const [result, head] = await withLog(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const called = yield* tools.call('cards_add', { id: 'c1', title: 'First' }, actor, 'call-1');
      return [called, yield* log.head(actor.organizationId)];
    }),
  );
  expect(result).toMatchObject({ ok: true, syncId: 1, input: { id: 'c1', title: 'First' } });
  expect('input' in result && typeof result.input.at).toBe('string');
  expect(head).toBe(1);
}, 30_000);

test('a repeat of one call commits once', async () => {
  const [first, second, head] = await withLog(
    Effect.gen(function* () {
      const log = yield* EventLog;
      const one = yield* tools.call('cards_add', { title: 'First' }, actor, 'call-1');
      const two = yield* tools.call('cards_add', { title: 'First' }, actor, 'call-1');
      return [one, two, yield* log.head(actor.organizationId)];
    }),
  );
  expect(first).toMatchObject({ ok: true, syncId: 1 });
  expect(second).toMatchObject({ ok: true, syncId: 1 });
  expect(head).toBe(1);
}, 30_000);

test('a refused call has the code and the reason of its refusal, and commits nothing', async () => {
  const results = await withLog(
    Effect.gen(function* () {
      const log = yield* EventLog;
      return [
        yield* tools.call('cards_add', { title: 'Taken' }, actor, 'a'),
        yield* tools.call('cards_add', { title: 7 }, actor, 'b'),
        yield* tools.call('cards_add', 'First', actor, 'c'),
        yield* tools.call('cards_hide', { id: 'c1' }, actor, 'd'),
        yield* log.head(actor.organizationId),
      ];
    }),
  );
  expect(results).toEqual([
    { ok: false, code: 'title-taken', reason: 'This title is taken.' },
    { ok: false, code: 'invalid-input', reason: 'The input of cards/add is not valid.' },
    {
      ok: false,
      code: 'invalid-input',
      reason: 'The input of cards_add is an object with the fields of its schema.',
    },
    {
      ok: false,
      code: 'unknown-command',
      reason: 'No tool is named cards_hide. List the tools to see each one.',
    },
    0,
  ]);
}, 30_000);

test('a server change that writes a record that does not fit ends as failed, and commits nothing', async () => {
  const results = await withLog(
    Effect.gen(function* () {
      const log = yield* EventLog;
      return [
        yield* tools.call('cards_add', { title: 'Broken' }, actor, 'a'),
        yield* log.head(actor.organizationId),
        // The next call still runs: the failed one left nothing behind.
        (yield* tools.call('cards_add', { title: 'Fine' }, actor, 'b')).ok,
      ];
    }),
  );
  expect(results).toEqual([
    { ok: false, code: 'failed', reason: 'The server could not apply this change.' },
    0,
    true,
  ]);
}, 30_000);

test('a read tool lists the records of a group in order, with the declared fields and a limit', async () => {
  const [all, first, next] = await withLog(
    Effect.gen(function* () {
      yield* fileTools.call(
        'files_file_card',
        { id: 'c3', spaceId: 'open', title: 'Third' },
        actor,
        'f3',
      );
      yield* fileTools.call(
        'files_file_card',
        { id: 'c1', spaceId: 'open', title: 'First' },
        actor,
        'f1',
      );
      yield* fileTools.call(
        'files_file_card',
        { id: 'c2', spaceId: 'open', title: 'Second' },
        actor,
        'f2',
      );
      const everything = yield* fileTools.call('files_of_space_list', { id: 'open' }, actor, 'l1');
      const one = yield* fileTools.call(
        'files_of_space_list',
        { id: 'open', limit: 1 },
        actor,
        'l2',
      );
      const onward = yield* fileTools.call(
        'files_of_space_list',
        { id: 'open', limit: 1, cursor: 'c1' },
        actor,
        'l3',
      );
      return [everything, one, onward];
    }),
  );
  expect(dataOf(all)).toEqual({
    items: [
      { id: 'c1', title: 'First' },
      { id: 'c2', title: 'Second' },
      { id: 'c3', title: 'Third' },
    ],
    pagination: { hasMore: false, nextCursor: null, itemsReturned: 3, limit: 50 },
  });
  expect(dataOf(first)).toEqual({
    items: [{ id: 'c1', title: 'First' }],
    pagination: { hasMore: true, nextCursor: 'c1', itemsReturned: 1, limit: 1 },
  });
  expect(dataOf(next)).toEqual({
    items: [{ id: 'c2', title: 'Second' }],
    pagination: { hasMore: true, nextCursor: 'c2', itemsReturned: 1, limit: 1 },
  });
}, 30_000);

test('a get tool returns the whole record, and the refusals of a read name the cause', async () => {
  const [whole, missing, closed] = await withLog(
    Effect.gen(function* () {
      yield* fileTools.call(
        'files_file_card',
        { id: 'c2', spaceId: 'open', title: 'Second' },
        actor,
        'f2',
      );
      return [
        yield* fileTools.call('files_of_space_get', { id: 'open', record: 'c2' }, actor, 'g1'),
        yield* fileTools.call('files_of_space_get', { id: 'open', record: 'nope' }, actor, 'g2'),
        yield* fileTools.call('files_of_space_list', { id: 'closed' }, actor, 'g3'),
      ];
    }),
  );
  const data = dataOf(whole);
  expect(Object.keys(data).toSorted()).toEqual(['at', 'id', 'spaceId', 'title']);
  expect(data).toMatchObject({ id: 'c2', spaceId: 'open', title: 'Second' });
  expect(missing).toEqual({
    ok: false,
    code: 'not-found',
    reason: 'This space has no Card with that ID. Call the list tool to see the IDs.',
  });
  expect(closed).toEqual({
    ok: false,
    code: 'forbidden',
    reason: 'You may not read the records of this space.',
  });
}, 30_000);

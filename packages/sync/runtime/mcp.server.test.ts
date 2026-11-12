import { expect, test } from 'bun:test';

import { Actors } from '@repo/identity/service/actors';
import { serverChange } from '@repo/sync/commands/server-change.server';
import { command } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { organizationGroup } from '@repo/sync/contract/engine-groups';
import { defineGroup } from '@repo/sync/contract/groups';
import { load, record } from '@repo/sync/contract/record';
import { mcpRoute } from '@repo/sync/runtime/mcp.server';
import { EventLog, eventLog } from '@repo/sync/service/event-log';
import { SyncGroups } from '@repo/sync/service/sync-groups';
import { DatabaseTest } from '@repo/sync/testing/database';
import { Effect, Layer } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';

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
            data: { id: input.id, title: input.title, at: input.at },
            groups: [organizationGroup.of(actor.organizationId)],
          },
        ]),
});
const hideServer = serverChange(hide, { run: () => Effect.succeed([]) });
const mcp = mcpRoute([addServer, hideServer], [cards]);

/** A file of a space, and a read tool that lists the files of one space. */
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
const reads = mcpRoute([fileServer], [filing]);

/** The actor of every connection in these tests. */
const signedIn = Layer.succeed(Actors)({ fromHeaders: () => Effect.succeed(actor) });

const groups = Layer.succeed(SyncGroups)({
  groupsFor: () => Effect.succeed({ eager: [], lazy: ['space:open'] }),
  canUse: () => Effect.succeed(true),
});

/** Runs a program with the route's services over a fresh database. */
function run<A>(program: Effect.Effect<A, unknown, EventLog | Actors | SyncGroups>) {
  return Effect.runPromise(
    program.pipe(
      Effect.provide(
        Layer.provideMerge(
          Layer.mergeAll(eventLog([cards, filing]), groups, signedIn),
          DatabaseTest(),
        ),
      ),
    ),
  );
}

const json = { 'content-type': 'application/json' };

/** Posts a body to `/mcp` as a client does, and gives the status and the text of the answer. */
function post(body: string, headers: Record<string, string> = json, route = mcp) {
  return Effect.gen(function* () {
    const response = yield* route.handle(
      HttpServerRequest.fromWeb(
        new Request('http://api.test/mcp', { method: 'POST', body, headers }),
      ),
    );
    const web = HttpServerResponse.toWeb(response);
    return { status: web.status, text: yield* Effect.promise(() => web.text()) };
  });
}

test('initialize echoes the protocol version and offers tools', async () => {
  const answer = await run(
    post(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {} },
      }),
    ),
  );
  expect(answer.status).toBe(200);
  expect(JSON.parse(answer.text)).toEqual({
    jsonrpc: '2.0',
    id: 1,
    result: {
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'clutch', version: '1' },
      instructions:
        'Each tool runs one command of the product, as the signed-in person. A refused call gives a stable code and a reason. Pass the same id again to repeat a call safely.',
    },
  });
}, 30_000);

test('a notification gets 202 and no body', async () => {
  const answer = await run(
    post(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })),
  );
  expect(answer).toEqual({ status: 202, text: '' });
}, 30_000);

test('tools/list returns the one tool with its annotations and its schema', async () => {
  const answer = await run(post(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })));
  expect(JSON.parse(answer.text)).toEqual({
    jsonrpc: '2.0',
    id: 2,
    result: {
      tools: [
        {
          name: 'cards_add',
          description: 'Add a card.',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description:
                  'The ID of the new record. Pass the same ID to repeat the call safely. Leave it out, and the server makes one.',
              },
              title: { type: 'string' },
            },
            required: ['title'],
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
      ],
    },
  });
}, 30_000);

test('tools/call commits through the event log, and a repeat of the request commits once', async () => {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'cards_add', arguments: { id: 'c1', title: 'First' } },
  });
  const { first, second, head } = await run(
    Effect.gen(function* () {
      const one = yield* post(body);
      const two = yield* post(body);
      const log = yield* EventLog;
      return { first: one, second: two, head: yield* log.head(actor.organizationId) };
    }),
  );
  expect(JSON.parse(first.text)).toMatchObject({
    jsonrpc: '2.0',
    id: 3,
    result: {
      content: [{ type: 'text', text: 'Done. The change is event 1.' }],
      structuredContent: { syncId: 1, input: { id: 'c1', title: 'First' } },
      isError: false,
    },
  });
  expect(JSON.parse(second.text)).toMatchObject({
    result: { isError: false, structuredContent: { syncId: 1 } },
  });
  expect(head).toBe(1);
}, 30_000);

test('a refused call is a result with isError, and it commits nothing', async () => {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'cards_add', arguments: { title: 'Taken' } },
  });
  const { answer, head } = await run(
    Effect.gen(function* () {
      const result = yield* post(body);
      const log = yield* EventLog;
      return { answer: result, head: yield* log.head(actor.organizationId) };
    }),
  );
  expect(JSON.parse(answer.text)).toEqual({
    jsonrpc: '2.0',
    id: 4,
    result: {
      content: [{ type: 'text', text: 'title-taken: This title is taken.' }],
      structuredContent: { code: 'title-taken', reason: 'This title is taken.' },
      isError: true,
    },
  });
  expect(head).toBe(0);
}, 30_000);

test('a call of an unknown tool is a result with isError and the code unknown-command', async () => {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'cards_missing', arguments: {} },
  });
  const answer = await run(post(body));
  expect(JSON.parse(answer.text)).toMatchObject({
    jsonrpc: '2.0',
    id: 5,
    result: {
      isError: true,
      structuredContent: { code: 'unknown-command' },
    },
  });
}, 30_000);

test('an unknown method is a JSON-RPC error with code -32601', async () => {
  const answer = await run(
    post(JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'resources/list' })),
  );
  expect(answer.status).toBe(200);
  expect(JSON.parse(answer.text)).toEqual({
    jsonrpc: '2.0',
    id: 6,
    error: { code: -32_601, message: 'The method resources/list is not supported.' },
  });
}, 30_000);

test('a body that is not JSON is HTTP 400 with the JSON-RPC error -32700', async () => {
  const answer = await run(post('{ not json'));
  expect(answer.status).toBe(400);
  expect(JSON.parse(answer.text)).toEqual({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32_700, message: 'The body is not JSON.' },
  });
}, 30_000);

test('a page of another site cannot call a tool with the cookies of the person', async () => {
  const call = JSON.stringify({
    jsonrpc: '2.0',
    id: 9,
    method: 'tools/call',
    params: { name: 'cards_add', arguments: { title: 'From a page' } },
  });
  const [foreign, form, local] = await run(
    Effect.all([
      post(call, { ...json, origin: 'https://attacker.example' }),
      post(call, { 'content-type': 'text/plain' }),
      post(call, { ...json, origin: 'http://clutch.localhost:1355' }),
    ]),
  );
  expect(foreign).toEqual({ status: 403, text: 'This origin may not call the MCP endpoint.' });
  expect(form.status).toBe(415);
  expect(JSON.parse(form.text).error.message).toBe('Send the request as application/json.');
  expect(JSON.parse(local.text).result.isError).toBe(false);
}, 30_000);

test('tools/call of a read tool gives its data as structuredContent, and isError is false', async () => {
  const seed = JSON.stringify({
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/call',
    params: { name: 'files_file_card', arguments: { id: 'c1', spaceId: 'open', title: 'First' } },
  });
  const listing = JSON.stringify({
    jsonrpc: '2.0',
    id: 11,
    method: 'tools/call',
    params: { name: 'files_of_space_list', arguments: { id: 'open' } },
  });
  const answer = await run(
    Effect.gen(function* () {
      yield* post(seed, json, reads);
      return yield* post(listing, json, reads);
    }),
  );
  expect(JSON.parse(answer.text).result).toMatchObject({
    isError: false,
    structuredContent: {
      items: [{ id: 'c1', title: 'First' }],
      pagination: { hasMore: false, nextCursor: null, itemsReturned: 1, limit: 50 },
    },
  });
}, 30_000);

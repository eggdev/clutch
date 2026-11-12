import { expect, test } from 'bun:test';

import { command } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { list, optional, oneOf, shape, text } from '@repo/sync/contract/fields';
import { defineGroup } from '@repo/sync/contract/groups';
import { load, record } from '@repo/sync/contract/record';
import { toolName, toolsOf } from '@repo/sync/contract/tools';

const base = { waits: 'local', access: 'group', refuses: [] } as const;
const create = command('notes/create', {
  ...base,
  input: {
    id: 'new-id',
    spaceId: 'string',
    title: text({ max: 200 }),
    pinned: 'boolean?',
    at: 'now',
  },
  refuses: ['space-full'],
  tool: { does: 'adds', idempotent: true, closed: true, says: 'Add a note to a space.' },
});
const remove = command('notes/remove-all', {
  ...base,
  input: { spaceId: 'string', extra: 'json' },
  tool: { does: 'removes', idempotent: false, closed: false, says: 'Remove each note of a space.' },
});
const invite = command('notes/invite', { ...base, input: { email: 'string' }, tool: 'none' });
const notes = defineContract('notes', {
  records: [],
  commands: [remove, invite, create],
  loads: [],
});

test('a tool takes its name, its words and its input schema from its command', () => {
  expect(toolName('access/create-space')).toBe('access_create_space');
  const [first] = toolsOf([notes]);
  expect(first).toEqual({
    name: 'notes_create',
    target: { kind: 'command', command: 'notes/create' },
    description: 'Add a note to a space.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description:
            'The ID of the new record. Pass the same ID to repeat the call safely. Leave it out, and the server makes one.',
        },
        spaceId: { type: 'string' },
        title: { type: 'string', maxLength: 200 },
        pinned: { type: ['boolean', 'null'] },
      },
      required: ['spaceId', 'title'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    refusals: [
      'space-full',
      'invalid-input',
      'not-found',
      'forbidden',
      'unknown-command',
      'failed',
    ],
  });
});

test('a command that removes, repeats or reaches outside says so in its annotations', () => {
  const tools = toolsOf([notes]);
  expect(tools[1]?.annotations).toEqual({
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  });
  expect(tools[1]?.inputSchema.properties).toEqual({ spaceId: { type: 'string' }, extra: {} });
});

test('a command with no tool is not offered, and the list is sorted by name', () => {
  expect(toolsOf([notes]).map((tool) => tool.name)).toEqual(['notes_create', 'notes_remove_all']);
});

test('each new field kind has its JSON Schema, and an optional kind may be null', () => {
  const sell = command('notes/sell', {
    input: {
      id: 'new-id',
      status: oneOf('draft', 'sent'),
      count: 'integer',
      tags: list('string'),
      label: text({ max: 8, min: 2 }),
      lines: list(shape({ label: 'string', cents: 'integer' })),
      note: optional('string'),
      summary: optional(shape({ label: 'string' })),
    },
    waits: 'local',
    access: 'group',
    refuses: [],
    tool: { does: 'adds', idempotent: true, closed: true, says: 'Sell.' },
  });
  const [tool] = toolsOf([defineContract('notes', { records: [], commands: [sell], loads: [] })]);
  expect(tool?.inputSchema).toEqual({
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description:
          'The ID of the new record. Pass the same ID to repeat the call safely. Leave it out, and the server makes one.',
      },
      status: { type: 'string', enum: ['draft', 'sent'] },
      count: { type: 'integer' },
      tags: { type: 'array', items: { type: 'string' } },
      label: { type: 'string', minLength: 2, maxLength: 8 },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, cents: { type: 'integer' } },
          required: ['label', 'cents'],
          additionalProperties: false,
        },
      },
      note: { type: ['string', 'null'] },
      summary: {
        anyOf: [
          {
            type: 'object',
            properties: { label: { type: 'string' } },
            required: ['label'],
            additionalProperties: false,
          },
          { type: 'null' },
        ],
      },
    },
    required: ['status', 'count', 'tags', 'label', 'lines'],
    additionalProperties: false,
  });
});

const spaceGroup = defineGroup('space');
const noteRecord = record('Note', {
  fields: { id: 'string', spaceId: 'string', title: 'string' },
  groups: [spaceGroup.by('spaceId')],
});
const readNotes = load('notes/of-space', noteRecord, spaceGroup, {
  tool: { says: 'List the notes of a space.', fields: ['title'] },
});
const reading = defineContract('notes', {
  records: [noteRecord],
  commands: [],
  loads: [readNotes],
});

test('a load function with a tool gives a list tool and a get tool, both read only', () => {
  const [get, listing] = toolsOf([reading]);
  const bound = {
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 200,
      default: 50,
      description: 'How many items to return, from 1 to 200. The default is 50.',
    },
    cursor: { type: 'string', description: 'The `nextCursor` of the page before.' },
  };
  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  const refusals = ['invalid-input', 'not-found', 'forbidden', 'unknown-command', 'failed'];
  expect(get).toEqual({
    name: 'notes_of_space_get',
    target: { kind: 'get', load: 'notes/of-space' },
    description: 'One whole Note of a space, by its ID. Call notes_of_space_list to find the ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The ID of the space whose records to read.' },
        record: { type: 'string', description: 'The ID of the Note.' },
      },
      required: ['id', 'record'],
      additionalProperties: false,
    },
    annotations: readOnly,
    refusals,
  });
  expect(listing).toEqual({
    name: 'notes_of_space_list',
    target: { kind: 'list', load: 'notes/of-space', fields: ['title'] },
    description:
      'List the notes of a space. Each item has: id, title. Pass `nextCursor` as `cursor` for the next page. Call notes_of_space_get for a whole record.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The ID of the space whose records to read.' },
        ...bound,
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: readOnly,
    refusals,
  });
});

test('a load function with the tool none gives no read tool', () => {
  const hidden = load('notes/of-space', noteRecord, spaceGroup, { tool: 'none' });
  expect(
    toolsOf([defineContract('notes', { records: [noteRecord], commands: [], loads: [hidden] })]),
  ).toEqual([]);
});

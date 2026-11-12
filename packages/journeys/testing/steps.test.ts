import { afterAll, expect, test } from 'bun:test';

import {
  advance,
  accessible,
  button,
  field,
  fieldWith,
  fill,
  heading,
  holds,
  onSecond,
  open,
  see,
  serverHolds,
  submit,
  text,
  tool,
  webOnly,
} from '@repo/journeys/testing/steps';
import { command } from '@repo/sync/contract/command';
import { text as textField } from '@repo/sync/contract/fields';
import { defineGroup } from '@repo/sync/contract/groups';
import { load, record } from '@repo/sync/contract/record';
import { removeTypeFixtures, typeErrors } from '@repo/sync/testing/type-errors';

const spaces = defineGroup('space');
const rename = command('notes/rename', {
  input: { id: 'string', title: textField({ max: 200 }), at: 'now' },
  waits: 'local',
  access: 'group',
  refuses: [],
  tool: { does: 'changes', idempotent: true, closed: true, says: 'Change the title of a note.' },
});
const quiet = command('notes/quiet', {
  input: { id: 'string' },
  waits: 'local',
  access: 'group',
  refuses: [],
  tool: 'none',
});
const note = record('Note', {
  fields: { id: 'string', spaceId: 'string', title: 'string' },
  groups: [spaces.by('spaceId')],
});
const notesOf = load('notes/of-space', note, spaces, {
  tool: { says: 'List the notes of a space.', fields: ['title'] },
});
const hiddenNotes = load('notes/hidden', note, spaces, { tool: 'none' });

test('a builder returns the step as data, with the target it names', () => {
  expect(fill(fieldWith('Note title', 'Draft'), 'Final')).toEqual({
    do: 'fill',
    target: { kind: 'field', label: 'Note title', value: 'Draft' },
    text: 'Final',
  });
  expect(see(heading('General', 1), { within: 20_000 })).toEqual({
    do: 'see',
    target: { kind: 'heading', name: 'General', level: 1 },
    within: 20_000,
  });
  expect(submit(field('Email'))).toEqual({
    do: 'submit',
    target: { kind: 'field', label: 'Email' },
  });
  expect(button('Add')).toEqual({ kind: 'button', name: 'Add' });
  expect(text('Saved')).toEqual({ kind: 'text', text: 'Saved' });
});

test('advance is a clock step with the time to move, in milliseconds', () => {
  expect(advance(30_000)).toEqual({ do: 'advance', ms: 30_000 });
});

test('onSecond and webOnly add their field and leave the step as it was', () => {
  const step = open('/');
  expect(onSecond(step)).toEqual({ do: 'open', path: '/', on: 'second' });
  expect(webOnly(accessible('home'), 'axe reads a web page')).toEqual({
    do: 'accessible',
    name: 'home',
    only: 'web',
    why: 'axe reads a web page',
  });
  expect(step).toEqual({ do: 'open', path: '/' });
});

test('tool gives the snake-case name of the command and the input it is given', () => {
  expect(tool(rename, { id: 'note-1', title: 'Renamed' })).toEqual({
    do: 'tool',
    name: 'notes_rename',
    input: { id: 'note-1', title: 'Renamed' },
  });
});

test('tool throws for a command with no agent tool, and names the command', () => {
  expect(() => tool(quiet, { id: 'note-1' })).toThrow(
    'The command notes/quiet offers no agent tool.',
  );
});

test('serverHolds names the list tool of the load function, its group and the field', () => {
  expect(serverHolds(notesOf, 'general', 'title', ['Draft'])).toEqual({
    do: 'server-holds',
    tool: 'notes_of_space_list',
    id: 'general',
    field: 'title',
    values: ['Draft'],
  });
});

test('serverHolds throws for a load function with no tool, and for a field that its tool does not list', () => {
  expect(() => serverHolds(hiddenNotes, 'general', 'title', [])).toThrow(
    'The load function notes/hidden offers no agent tool',
  );
  expect(() => serverHolds(notesOf, 'general', 'spaceId', [])).toThrow(
    'The list tool of notes/of-space gives no `spaceId`. It gives: title.',
  );
});

test('holds gives the model name of the record and the field it checks', () => {
  expect(holds(note, 'title', ['Draft', 'Final'])).toEqual({
    do: 'holds',
    model: 'Note',
    field: 'title',
    values: ['Draft', 'Final'],
  });
});

afterAll(removeTypeFixtures);

test('a tool input with a field of the wrong type, and a holds field the record lacks, do not compile', async () => {
  const source = `import { command } from '@repo/sync/contract/command';
import { text } from '@repo/sync/contract/fields';
import { defineGroup } from '@repo/sync/contract/groups';
import { record } from '@repo/sync/contract/record';
import { holds, tool } from '@repo/journeys/testing/steps';

const spaces = defineGroup('space');
const rename = command('notes/rename', {
  input: { id: 'string', title: text({ max: 200 }), at: 'now' },
  waits: 'local',
  access: 'group',
  refuses: [],
  tool: { does: 'changes', idempotent: true, closed: true, says: 'Change a title.' },
});
const note = record('Note', {
  fields: { id: 'string', spaceId: 'string', title: 'string' },
  groups: [spaces.by('spaceId')],
});
export const good = tool(rename, { id: 'note-1', title: 'Renamed' });
export const wrongInput = tool(rename, { id: 'note-1', title: 1 });
export const goodField = holds(note, 'title', []);
export const missingField = holds(note, 'nope', []);
`;
  const errors = await typeErrors(source);
  const lineOf = (needle: string) =>
    source.split('\n').findIndex((line) => line.includes(needle)) + 1;
  expect(errors).toHaveLength(2);
  expect(errors[0]).toContain(`fixture.ts(${lineOf('wrongInput')},`);
  expect(errors[0]).toContain("Type 'number' is not assignable to type 'string'");
  expect(errors[1]).toContain(`fixture.ts(${lineOf('missingField')},`);
});

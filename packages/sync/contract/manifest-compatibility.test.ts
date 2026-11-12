import { expect, test } from 'bun:test';

import type { Access } from '@repo/sync/contract/command';
import { command } from '@repo/sync/contract/command';
import { compareManifests } from '@repo/sync/contract/compatibility';
import { defineContract } from '@repo/sync/contract/define';
import type { Contract } from '@repo/sync/contract/define';
import { list, oneOf, shape, text } from '@repo/sync/contract/fields';
import type { Fields } from '@repo/sync/contract/fields';
import { defineGroup } from '@repo/sync/contract/groups';
import { manifestOf } from '@repo/sync/contract/manifest';
import { load, record } from '@repo/sync/contract/record';
import type { ReadTool } from '@repo/sync/contract/record';

const spaceGroup = defineGroup('space');
const organizationGroup = defineGroup('org');
const note = record('Note', {
  fields: { id: 'string', spaceId: 'string', title: 'string' },
  groups: [spaceGroup.by('spaceId')],
});
const tool = { does: 'changes', idempotent: true, closed: true, says: 'Rename a note.' } as const;
const readNotes = { says: 'List the notes of a space.', fields: ['title'] } as const;
const renameInput = { id: 'string', title: text({ max: 200 }), at: 'now' } as const;
const rename = command('notes/rename', {
  input: renameInput,
  waits: 'local',
  access: 'group',
  refuses: ['title-taken'],
  tool,
});
const space = record('Space', {
  fields: { id: 'string', name: 'string' },
  groups: [organizationGroup.ofScope],
});
const notes = defineContract('notes', {
  records: [note],
  commands: [rename],
  loads: [load('notes/of-space', note, spaceGroup, { tool: readNotes })],
});

/** The changes from the notes contract to one with other parts, as `door id` strings. */
function changesTo(parts: Pick<Contract, 'records' | 'commands' | 'loads'>) {
  const next = defineContract('notes', parts);
  return compareManifests(manifestOf([notes]), manifestOf([next])).map(
    (change) => `${change.door} ${change.id}`,
  );
}

const base = { waits: 'local', access: 'group', refuses: ['title-taken'], tool } as const;

/** The changes between two inputs of the rename command, as `door id` strings. */
function inputChanges(before: Fields, after: Fields): Array<string> {
  const old = defineContract('notes', {
    records: [note],
    commands: [command('notes/rename', { ...base, input: before })],
    loads: notes.loads,
  });
  const next = defineContract('notes', {
    records: [note],
    commands: [command('notes/rename', { ...base, input: after })],
    loads: notes.loads,
  });
  return compareManifests(manifestOf([old]), manifestOf([next])).map(
    (change) => `${change.door} ${change.id}`,
  );
}

/** A rename command with the access and the permission given. */
function renameAs(who: Access, permission?: string) {
  return command('notes/rename', {
    input: renameInput,
    waits: 'local',
    access: who,
    ...(permission === undefined ? {} : { permission }),
    refuses: ['title-taken'],
    tool,
  });
}

test('the same manifest has no change', () => {
  expect(compareManifests(manifestOf([notes]), manifestOf([notes]))).toEqual([]);
});

test('a change that an installed build survives is two-way', () => {
  const pinned = record('Note', {
    fields: { id: 'string', spaceId: 'string', title: 'string', pinned: 'boolean?' },
    groups: [spaceGroup.by('spaceId')],
  });
  const wider = command('notes/rename', {
    ...base,
    input: { id: 'string', title: text({ max: 300 }), at: 'now', note: 'string?' },
    waits: 'server',
    refuses: [],
  });
  const archive = command('notes/archive', { ...base, input: { id: 'string' } });
  expect(changesTo({ records: [pinned, space], commands: [wider, archive], loads: [] })).toEqual([
    'two-way command-added:notes/archive',
    'two-way command-input-added:notes/rename.note',
    'two-way command-input-changed:notes/rename.title',
    'two-way command-refusals-changed:notes/rename',
    'two-way command-waits-changed:notes/rename',
    'two-way load-removed:notes/of-space',
    'two-way record-added:Space',
    'two-way record-field-added:Note.pinned',
  ]);
});

test('a change that strands an installed build is one-way', () => {
  const moved = record('Note', {
    fields: { id: 'string', spaceId: 'string', title: 'number', rank: 'number' },
    groups: [organizationGroup.ofScope],
  });
  const stricter = command('notes/rename', {
    ...base,
    input: { id: 'string', title: text({ max: 100 }), at: 'now', reason: 'string' },
    access: 'organization',
    tool: 'none',
  });
  expect(changesTo({ records: [moved], commands: [stricter], loads: notes.loads })).toEqual([
    'one-way command-access-changed:notes/rename',
    'one-way command-input-added:notes/rename.reason',
    'one-way command-input-changed:notes/rename.title',
    'one-way command-tool-removed:notes/rename',
    'one-way record-field-added:Note.rank',
    'one-way record-field-changed:Note.title',
    'one-way record-groups-changed:Note',
  ]);
  expect(changesTo({ records: [], commands: [], loads: [] })).toEqual([
    'one-way command-removed:notes/rename',
    'two-way load-removed:notes/of-space',
    'one-way record-removed:Note',
  ]);
});

test('a record changes two-way only by an added field that may be left out', () => {
  const parts = { records: [note], commands: [rename], loads: notes.loads };
  const withRank = record('Note', {
    fields: { id: 'string', spaceId: 'string', title: 'string', rank: 'number' },
    groups: [spaceGroup.by('spaceId')],
  });
  const withoutTitle = record('Note', {
    fields: { id: 'string', spaceId: 'string' },
    groups: [spaceGroup.by('spaceId')],
  });
  const retitled = record('Note', {
    fields: { id: 'string', spaceId: 'string', title: 'string?' },
    groups: [spaceGroup.by('spaceId')],
  });
  expect(changesTo({ ...parts, records: [withRank] })).toEqual([
    'one-way record-field-added:Note.rank',
  ]);
  expect(changesTo({ ...parts, records: [withoutTitle] })).toEqual([
    'one-way record-field-removed:Note.title',
  ]);
  expect(changesTo({ ...parts, records: [retitled] })).toEqual([
    'one-way record-field-changed:Note.title',
  ]);
});

test('a command input takes each old value in two-way changes, and fewer values in one-way ones', () => {
  expect(inputChanges({ amount: 'integer' }, { amount: 'number' })).toEqual([
    'two-way command-input-changed:notes/rename.amount',
  ]);
  expect(inputChanges({ amount: 'number' }, { amount: 'integer' })).toEqual([
    'one-way command-input-changed:notes/rename.amount',
  ]);
  expect(inputChanges({ title: 'string' }, { title: 'string?' })).toEqual([
    'two-way command-input-changed:notes/rename.title',
  ]);
  expect(inputChanges({ title: 'string?' }, { title: 'string' })).toEqual([
    'one-way command-input-changed:notes/rename.title',
  ]);
  expect(inputChanges({ title: 'string' }, { title: 'json' })).toEqual([
    'two-way command-input-changed:notes/rename.title',
  ]);
  expect(inputChanges({ title: 'number' }, { title: 'string' })).toEqual([
    'one-way command-input-changed:notes/rename.title',
  ]);
  expect(inputChanges({ status: oneOf('a', 'b') }, { status: oneOf('a', 'b', 'c') })).toEqual([
    'two-way command-input-changed:notes/rename.status',
  ]);
  expect(inputChanges({ status: oneOf('a', 'b', 'c') }, { status: oneOf('a', 'b') })).toEqual([
    'one-way command-input-changed:notes/rename.status',
  ]);
  expect(
    inputChanges({ title: text({ max: 5, min: 2 }) }, { title: text({ max: 5, min: 1 }) }),
  ).toEqual(['two-way command-input-changed:notes/rename.title']);
  expect(
    inputChanges({ title: text({ max: 5, min: 2 }) }, { title: text({ max: 5, min: 3 }) }),
  ).toEqual(['one-way command-input-changed:notes/rename.title']);
  expect(inputChanges({ title: text({ max: 5 }) }, { title: text({ max: 10 }) })).toEqual([
    'two-way command-input-changed:notes/rename.title',
  ]);
  expect(inputChanges({ title: text({ max: 10 }) }, { title: text({ max: 5 }) })).toEqual([
    'one-way command-input-changed:notes/rename.title',
  ]);
});

test('a list or a shape widens when its parts widen, and a new required shape field is one-way', () => {
  expect(
    inputChanges(
      { lines: list(shape({ label: 'string' })) },
      { lines: list(shape({ label: 'string', note: 'string?' })) },
    ),
  ).toEqual(['two-way command-input-changed:notes/rename.lines']);
  expect(
    inputChanges(
      { lines: list(shape({ label: 'string' })) },
      { lines: list(shape({ label: 'string', cents: 'integer' })) },
    ),
  ).toEqual(['one-way command-input-changed:notes/rename.lines']);
  expect(inputChanges({ tags: list('string') }, { tags: list('json') })).toEqual([
    'two-way command-input-changed:notes/rename.tags',
  ]);
});

test('a change of who may run a command, or of its permission, is one-way', () => {
  expect(
    compareManifests(
      manifestOf([notes]),
      manifestOf([
        defineContract('notes', {
          records: [note],
          commands: [renameAs('organization')],
          loads: notes.loads,
        }),
      ]),
    ).map((change) => `${change.door} ${change.id}`),
  ).toEqual(['one-way command-access-changed:notes/rename']);
  const before = defineContract('notes', {
    records: [note],
    commands: [renameAs('group')],
    loads: notes.loads,
  });
  const after = defineContract('notes', {
    records: [note],
    commands: [renameAs('group', 'project:publish')],
    loads: notes.loads,
  });
  expect(
    compareManifests(manifestOf([before]), manifestOf([after])).map(
      (change) => `${change.door} ${change.id}`,
    ),
  ).toEqual(['one-way command-access-changed:notes/rename']);
});

test('a change of waits, refusals, or of the tool of a command is two-way, and no tool is one-way', () => {
  expect(
    changesTo({
      records: [note],
      commands: [
        command('notes/rename', {
          ...base,
          input: renameInput,
          waits: 'server',
          refuses: ['name-taken'],
          tool: { ...tool, says: 'Change the title of a note.' },
        }),
      ],
      loads: notes.loads,
    }),
  ).toEqual([
    'two-way command-refusals-changed:notes/rename',
    'two-way command-tool-changed:notes/rename',
    'two-way command-waits-changed:notes/rename',
  ]);
  expect(
    changesTo({
      records: [note],
      commands: [command('notes/rename', { ...base, input: renameInput, tool: 'none' })],
      loads: notes.loads,
    }),
  ).toEqual(['one-way command-tool-removed:notes/rename']);
});

/** The changes from the notes contract to one whose load function reads with the tool given. */
function loadChangesTo(read: ReadTool<'id' | 'spaceId' | 'title'> | 'none') {
  return changesTo({
    records: [note],
    commands: [rename],
    loads: [load('notes/of-space', note, spaceGroup, { tool: read })],
  });
}

test('a load function that stops being a tool is one-way, and another change of its tool is two-way', () => {
  expect(loadChangesTo('none')).toEqual(['one-way load-tool-removed:notes/of-space']);
  expect(loadChangesTo({ says: 'List the notes.', fields: ['title'] })).toEqual([
    'two-way load-tool-changed:notes/of-space',
  ]);
  expect(loadChangesTo({ says: 'List the notes of a space.', fields: ['spaceId'] })).toEqual([
    'two-way load-tool-changed:notes/of-space',
  ]);
});

test('a load function that loads another record or group is two-way', () => {
  const other = record('Tag', {
    fields: { id: 'string', title: 'string' },
    groups: [spaceGroup.by('id')],
  });
  const parts = { records: [note, other], commands: [rename], loads: [] };
  expect(
    changesTo({
      ...parts,
      loads: [load('notes/of-space', other, spaceGroup, { tool: readNotes })],
    }),
  ).toEqual(['two-way load-changed:notes/of-space', 'two-way record-added:Tag']);
});

import { expect, test } from 'bun:test';

import { command } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { list, optional, oneOf, shape, text } from '@repo/sync/contract/fields';
import type { Fields } from '@repo/sync/contract/fields';
import { defineGroup, unless } from '@repo/sync/contract/groups';
import { digestOf, manifestOf } from '@repo/sync/contract/manifest';
import { load, record } from '@repo/sync/contract/record';

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
const notes = defineContract('notes', {
  records: [note],
  commands: [rename],
  loads: [load('notes/of-space', note, spaceGroup, { tool: readNotes })],
});
const space = record('Space', {
  fields: { id: 'string', name: 'string' },
  groups: [organizationGroup.ofScope],
});
const access = defineContract('access', { records: [space], commands: [], loads: [] });

test('the manifest writes each part as sorted plain data', () => {
  expect(manifestOf([notes, access])).toEqual({
    version: 1,
    digest: manifestOf([access, notes]).digest,
    records: [
      {
        name: 'Note',
        contract: 'notes',
        fields: { id: 'string', spaceId: 'string', title: 'string' },
        groups: ['space:{spaceId}'],
      },
      {
        name: 'Space',
        contract: 'access',
        fields: { id: 'string', name: 'string' },
        groups: ['org:{organizationId}'],
      },
    ],
    commands: [
      {
        name: 'notes/rename',
        contract: 'notes',
        input: {
          at: 'now',
          id: 'string',
          title: { kind: 'string', min: 0, max: 200 },
        },
        waits: 'local',
        access: 'group',
        permission: null,
        refuses: ['title-taken'],
        tool,
      },
    ],
    loads: [
      {
        name: 'notes/of-space',
        contract: 'notes',
        record: 'Note',
        group: 'space',
        tool: readNotes,
      },
    ],
    jobs: [],
    routes: [],
  });
});

test('the manifest writes each new kind, a conditional group, a permission and a load tool', () => {
  const shared = defineGroup('shared');
  const draft = record('Draft', {
    fields: {
      id: 'string',
      projectId: 'string',
      status: oneOf('ready', 'draft'),
      count: 'integer',
      lines: list(shape({ label: 'string', cents: 'integer' })),
      note: optional('string'),
    },
    groups: [unless('status', ['ready', 'draft'], shared.by('projectId'))],
  });
  const publish = command('drafts/publish', {
    input: { id: 'string' },
    waits: 'server',
    access: 'group',
    permission: 'project:publish',
    refuses: [],
    tool: 'none',
  });
  const drafts = defineContract('drafts', {
    records: [draft],
    commands: [publish],
    loads: [
      load('drafts/of-project', draft, shared, {
        tool: { says: 'List the drafts of a project.', fields: ['status'] },
      }),
    ],
  });
  const manifest = manifestOf([drafts]);
  expect(manifest.records).toEqual([
    {
      name: 'Draft',
      contract: 'drafts',
      fields: {
        count: 'integer',
        id: 'string',
        lines: {
          kind: 'list',
          of: { kind: 'shape', fields: { cents: 'integer', label: 'string' } },
        },
        note: { kind: 'optional', of: 'string' },
        projectId: 'string',
        status: { kind: 'enum', values: ['draft', 'ready'] },
      },
      groups: ['shared:{projectId} unless status is draft|ready'],
    },
  ]);
  expect(manifest.commands).toEqual([
    {
      name: 'drafts/publish',
      contract: 'drafts',
      input: { id: 'string' },
      waits: 'server',
      access: 'group',
      permission: 'project:publish',
      refuses: [],
      tool: 'none',
    },
  ]);
  expect(manifest.loads).toEqual([
    {
      name: 'drafts/of-project',
      contract: 'drafts',
      record: 'Draft',
      group: 'shared',
      tool: { says: 'List the drafts of a project.', fields: ['status'] },
    },
  ]);
});

/** The digest of a contract with one command whose input has the field `title` of the kind given. */
function digestWith(kind: Fields[string]): string {
  const edit = command('notes/edit', {
    input: { title: kind },
    waits: 'local',
    access: 'group',
    refuses: [],
    tool: 'none',
  });
  return manifestOf([defineContract('notes', { records: [], commands: [edit], loads: [] })]).digest;
}

test('the digest is the same for the same contracts, and moves with any change', () => {
  expect(digestOf('a')).toBe(digestOf('a'));
  expect(digestOf('a')).toHaveLength(16);
  expect(digestOf('a')).not.toBe(digestOf('b'));
  const wider = command('notes/rename', {
    input: { id: 'string', title: text({ max: 300 }), at: 'now' },
    waits: 'local',
    access: 'group',
    refuses: ['title-taken'],
    tool,
  });
  const changed = defineContract('notes', { records: [note], commands: [wider], loads: [] });
  expect(manifestOf([changed]).digest).not.toBe(manifestOf([notes]).digest);
});

test('two ways to write one kind give the same digest, and a different kind does not', () => {
  expect(digestWith(text({ max: 5 }))).toBe(digestWith(text({ max: 5, min: 0 })));
  expect(digestWith(oneOf('a', 'b'))).toBe(digestWith(oneOf('b', 'a')));
  expect(digestWith(oneOf('a', 'c'))).not.toBe(digestWith(oneOf('a', 'b')));
});

test('two contracts that declare one name fail, because a name is one thing on the wire', () => {
  const other = defineContract('archive', { records: [note], commands: [], loads: [] });
  expect(() => manifestOf([notes, other])).toThrow('Two contracts declare Note');
});

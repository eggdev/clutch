import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { deleteChange, upsertChange } from '@repo/sync/contract/change';
import { command, localChange } from '@repo/sync/contract/command';
import { clientOf, clientPackage, defineContract, isContract } from '@repo/sync/contract/define';
import { list, matches, oneOf, optional, shape, stamped, text } from '@repo/sync/contract/fields';
import type { Stamps } from '@repo/sync/contract/fields';
import { defineGroup, unless, when } from '@repo/sync/contract/groups';
import { load, record } from '@repo/sync/contract/record';

/** Stamps that give `id-1`, `id-2` and so on, and the one time that it is given. */
function stampsAt(now: string): Stamps {
  let count = 0;
  return {
    newId: () => {
      count += 1;
      return `id-${count}`;
    },
    now: () => now,
  };
}

const noteFields = {
  id: 'string',
  title: text({ max: 5 }),
  pinned: 'boolean',
  rank: 'number',
  due: 'string?',
  extra: 'json',
} as const;

const full = { id: 'n1', title: 'Hello', pinned: false, rank: 1, due: null, extra: { any: 1 } };

test('a value matches its fields only with each kind right', () => {
  expect(matches(noteFields, full)).toBe(true);
  // An optional field may be missing, and a `json` field takes any value.
  expect(matches(noteFields, { id: 'n1', title: '', pinned: true, rank: 0 })).toBe(true);
  expect(matches(noteFields, { ...full, pinned: 'no' })).toBe(false);
  expect(matches(noteFields, { ...full, id: undefined })).toBe(false);
  expect(matches(noteFields, null)).toBe(false);
  expect(matches(noteFields, 'n1')).toBe(false);
});

test('a text field refuses a value over its longest length, on the same check that the server runs', () => {
  expect(matches(noteFields, { ...full, title: '12345' })).toBe(true);
  expect(matches(noteFields, { ...full, title: '123456' })).toBe(false);
});

test('a number field refuses a value that JSON cannot hold', () => {
  expect(matches(noteFields, { ...full, rank: Number.NaN })).toBe(false);
  expect(matches(noteFields, { ...full, rank: Number.POSITIVE_INFINITY })).toBe(false);
});

const kinds = {
  count: 'integer',
  label: text({ max: 8, min: 2 }),
  status: oneOf('draft', 'sent'),
  tags: list('string'),
  lines: list(shape({ label: 'string', cents: 'integer' })),
  note: optional('string'),
  body: 'array',
  meta: 'object',
} as const;

const good = {
  count: 2,
  label: 'Hi',
  status: 'sent',
  tags: ['a'],
  lines: [{ label: 'x', cents: 150 }],
  note: null,
  body: [1],
  meta: { any: true },
};

test('each new kind accepts a right value and refuses a wrong one', () => {
  expect(matches(kinds, good)).toBe(true);
  expect(matches(kinds, { ...good, count: 1.5 })).toBe(false);
  expect(matches(kinds, { ...good, body: {} })).toBe(false);
  expect(matches(kinds, { ...good, meta: [] })).toBe(false);
  // A text with a shortest length refuses a value under it, and one over its longest.
  expect(matches(kinds, { ...good, label: 'H' })).toBe(false);
  expect(matches(kinds, { ...good, label: 'HiHiHiHiH' })).toBe(false);
  expect(matches(kinds, { ...good, status: 'void' })).toBe(false);
  expect(matches(kinds, { ...good, tags: ['a', 2] })).toBe(false);
  expect(matches(kinds, { ...good, lines: [{ label: 'x', cents: 1.5 }] })).toBe(false);
  // A nested shape with a wrong or a missing inner field is refused.
  expect(matches(kinds, { ...good, lines: [{ label: 'x' }] })).toBe(false);
  expect(matches(kinds, { ...good, note: 3 })).toBe(false);
  expect(matches(kinds, { ...good, note: undefined })).toBe(true);
});

test('stamping fills only the stamps that the caller left out', () => {
  const fields = { id: 'new-id', title: 'string', at: 'now' } as const;
  expect(stamped(fields, { title: 'A' }, stampsAt('2026-02-02T00:00:00.000Z'))).toEqual({
    id: 'id-1',
    title: 'A',
    at: '2026-02-02T00:00:00.000Z',
  });
  expect(stamped(fields, { id: 'mine', title: 'A' }, stampsAt('2026-01-01T00:00:00.000Z')).id).toBe(
    'mine',
  );
});

const spaceGroup = defineGroup('space');
const organizationGroup = defineGroup('org');

test('a record names its groups from its fields and from its organization', () => {
  const note = record('Note', {
    fields: { id: 'string', spaceId: 'string' },
    groups: [spaceGroup.by('spaceId'), organizationGroup.ofScope],
  });
  expect(note.groupsOf({ id: 'n1', spaceId: 's1' }, { organizationId: 'o1' })).toEqual([
    'space:s1',
    'org:o1',
  ]);
  expect(note.is({ id: 'n1', spaceId: 's1' })).toBe(true);
  expect(note.is({ id: 'n1' })).toBe(false);
  expect(spaceGroup.idOf('space:s1')).toBe('s1');
  expect(spaceGroup.idOf('org:o1')).toBeUndefined();
});

test('a group with a when or an unless condition holds the record only while the field allows it', () => {
  const review = defineGroup('review');
  const draft = record('Draft', {
    fields: { id: 'string', projectId: 'string', status: 'string' },
    groups: [
      when('status', ['sent'], spaceGroup.by('projectId')),
      unless('status', ['draft'], review.by('projectId')),
    ],
  });
  const scope = { organizationId: 'o1' };
  expect(draft.groupsOf({ id: 'd1', projectId: 'p1', status: 'draft' }, scope)).toEqual([]);
  expect(draft.groupsOf({ id: 'd1', projectId: 'p1', status: 'sent' }, scope)).toEqual([
    'space:p1',
    'review:p1',
  ]);
  expect(draft.groupsOf({ id: 'd1', projectId: 'p1', status: 'ready' }, scope)).toEqual([
    'review:p1',
  ]);
});

test('a record with a bad name or with no group fails when it is declared', () => {
  expect(() =>
    record('note', { fields: { id: 'string' }, groups: [organizationGroup.ofScope] }),
  ).toThrow('is not Pascal case');
  expect(() => record('Note', { fields: { id: 'string' }, groups: [] })).toThrow(
    'names no sync group',
  );
});

const base = { waits: 'server', access: 'organization', refuses: [], tool: 'none' } as const;

test('a command with a bad name or a bad refusal code fails when it is declared', () => {
  expect(() => command('Rename', { ...base, input: {} })).toThrow('is not `<contract>/<command>`');
  expect(() => command('notes/rename', { ...base, input: {}, refuses: ['Name Taken'] })).toThrow(
    'is not kebab case',
  );
  expect(() => command('notes/rename', { ...base, input: {}, refuses: ['not-found'] })).toThrow(
    'which every command already has',
  );
});

const note = record('Note', {
  fields: { id: 'string', spaceId: 'string' },
  groups: [spaceGroup.by('spaceId')],
});
const rename = command('notes/rename', { ...base, input: { id: 'string' }, waits: 'local' });
const archive = command('notes/archive', { ...base, input: { id: 'string' } });

test('a contract holds its parts, and the manifest can find it', () => {
  const notes = defineContract('notes', {
    records: [note],
    commands: [rename, archive],
    loads: [load('notes/by-space', note, spaceGroup, { tool: 'none' })],
  });
  expect(isContract(notes)).toBe(true);
  expect(isContract(note)).toBe(false);
  expect(notes.loads[0].group('s1')).toBe('space:s1');
  expect(notes.commands.map((declared) => declared.name)).toEqual([
    'notes/rename',
    'notes/archive',
  ]);
});

test('a contract with a command of another contract, a repeated name or a stray load fails', () => {
  const parts = { records: [note], commands: [rename], loads: [] };
  expect(() => defineContract('cards', parts)).toThrow('so its name starts with `cards/`');
  expect(() => defineContract('notes', { ...parts, commands: [rename, rename] })).toThrow(
    'declares notes/rename twice',
  );
  expect(() =>
    defineContract('notes', {
      ...parts,
      loads: [
        load('notes/tags', { name: 'Tag', fields: { id: 'string' } }, spaceGroup, { tool: 'none' }),
      ],
    }),
  ).toThrow('loads Tag, which the contract notes does not declare');
});

test('the client half of a package covers each command that shows at once, and no other', () => {
  const notes = defineContract('notes', { records: [note], commands: [rename], loads: [] });
  const renameLocal = localChange(rename, (draft, input) => draft.remove(note, input.id));
  const client = clientPackage(notes, [renameLocal]);
  expect(client.kind).toBe('client-package');
  expect(client.localChanges.map((half) => half.name)).toEqual(['notes/rename']);
  // The type of the list also rejects each of these. The test goes around it
  // to prove that a JavaScript caller still fails loudly.
  const loose: { name: string; commands: [] } = { name: 'notes', commands: [] };
  expect(() => Reflect.apply(clientPackage, null, [notes, []])).toThrow(
    'notes/rename shows at once and has no local change',
  );
  expect(() => Reflect.apply(clientPackage, null, [loose, [renameLocal]])).toThrow(
    'notes/rename is not a command of this contract that shows at once',
  );
});

test('clientOf gives the contract and the local changes of each client package', () => {
  const notes = defineContract('notes', { records: [note], commands: [rename], loads: [] });
  const cards = defineContract('cards', { records: [], commands: [], loads: [] });
  const renameLocal = localChange(rename, (draft, input) => draft.remove(note, input.id));
  const parts = clientOf([clientPackage(notes, [renameLocal]), clientPackage(cards, [])]);
  expect(parts.contracts.map((contract) => contract.name)).toEqual(['notes', 'cards']);
  expect(parts.commands.map((half) => half.name)).toEqual(['notes/rename']);
});

/** The module specifiers that a source file imports or re-exports. */
function specifiersOf(source: string): Array<string> {
  return [...source.matchAll(/\bfrom\s+'([^']+)'/gu)].map((match) => match[1] ?? '');
}

/** The `file: specifier` pairs of the files in a folder whose specifiers the rule refuses. */
function offendingIn(
  folder: string,
  keep: (file: string) => boolean,
  allowed: (specifier: string) => boolean,
) {
  return readdirSync(folder)
    .filter((file) => file.endsWith('.ts') && keep(file))
    .flatMap((file) =>
      specifiersOf(readFileSync(path.join(folder, file), 'utf-8'))
        .filter((specifier) => !allowed(specifier))
        .map((specifier) => `${file}: ${specifier}`),
    );
}

test('a contract with several problems names each one in one error', () => {
  const tagGroup = defineGroup('tag');
  const orphan = record('Orphan', { fields: { id: 'string' }, groups: [tagGroup.by('id')] });
  const stray = command('cards/move', {
    input: {},
    waits: 'server',
    access: 'organization',
    refuses: [],
    tool: 'none',
  });
  const problems = (): string => {
    try {
      defineContract('Notes', {
        records: [],
        commands: [stray, stray],
        loads: [load('notes/orphans', orphan, tagGroup, { tool: 'none' })],
      });
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : '';
    }
  };
  expect(problems().split('\n')).toEqual([
    'The contract name "Notes" is not kebab case, such as `notes`.',
    'The command cards/move is in the contract Notes, so its name starts with `Notes/`.',
    'The contract Notes declares cards/move twice. Each name is declared once.',
    'The load function notes/orphans loads Orphan, which the contract Notes does not declare. Add the record to `records`.',
  ]);
});

test('a server write is checked against the fields of its record', () => {
  const cardGroup = defineGroup('board');
  const card = record('Card', {
    fields: { id: 'string', boardId: 'string', title: text({ max: 5 }) },
    groups: [cardGroup.by('boardId')],
  });
  const scope = { organizationId: 'o1' };
  expect(upsertChange(card, { id: 'c1', boardId: 'b1', title: 'Hello' }, scope)).toMatchObject({
    model: 'Card',
    id: 'c1',
    action: 'upsert',
    groups: ['board:b1'],
  });
  // The type takes any string, and only the check knows the limit.
  expect(() => upsertChange(card, { id: 'c2', boardId: 'b1', title: 'Too long' }, scope)).toThrow(
    'The Card record c2 does not match the fields that its contract declares.',
  );
});

test('a record that carries a field that its contract does not declare never becomes a change', () => {
  const card = record('Card', {
    fields: { id: 'string', boardId: 'string' },
    groups: [defineGroup('board').by('boardId')],
  });
  const scope = { organizationId: 'o1' };
  // A table row has more columns than the record. Its type still fits, so only the check stops it.
  const row = { id: 'c1', boardId: 'b1', organizationId: 'o1', passwordHash: 'secret' };
  const refusal =
    'The Card record c1 carries organizationId, passwordHash, which its contract does not declare.';
  expect(() => upsertChange(card, row, scope)).toThrow(refusal);
  expect(() => deleteChange(card, row, scope)).toThrow(refusal);
  expect(card.undeclared({ id: 'c1', boardId: 'b1' })).toEqual([]);
});

test('the contract folder imports nothing outside itself', () => {
  const offending = offendingIn(
    import.meta.dir,
    (file) => !file.endsWith('.test.ts') && file !== 'engine-groups.ts',
    (specifier) => specifier.startsWith('@repo/sync/contract/'),
  );
  expect(offending).toEqual([]);
});

test('the test files of the contract folder import nothing outside it, bun:test or node:', () => {
  const offending = offendingIn(
    import.meta.dir,
    (file) => file.endsWith('.test.ts'),
    (specifier) =>
      specifier.startsWith('@repo/sync/contract/') ||
      specifier === 'bun:test' ||
      specifier.startsWith('node:'),
  );
  expect(offending).toEqual([]);
});

test('no file of the contract folder imports engine-groups, which each project owns', () => {
  const offending = offendingIn(
    import.meta.dir,
    (file) => file !== 'engine-groups.ts',
    (specifier) => specifier !== '@repo/sync/contract/engine-groups',
  );
  expect(offending).toEqual([]);
});

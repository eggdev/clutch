import { expect, test } from 'bun:test';

import { compareManifests } from '@repo/sync/contract/compatibility';
import { defineContract, unlistedParts } from '@repo/sync/contract/define';
import { text } from '@repo/sync/contract/fields';
import { defineGroup } from '@repo/sync/contract/groups';
import { job } from '@repo/sync/contract/job';
import type { JobDeclaration } from '@repo/sync/contract/job';
import { manifestOf } from '@repo/sync/contract/manifest';
import { record } from '@repo/sync/contract/record';
import { route } from '@repo/sync/contract/route';
import type { RouteDeclaration } from '@repo/sync/contract/route';

const spaceGroup = defineGroup('space');
const note = record('Note', {
  fields: { id: 'string', spaceId: 'string' },
  groups: [spaceGroup.by('spaceId')],
});

/** A notes contract with the given jobs and routes, and no other parts. */
function contractOf(jobs: ReadonlyArray<JobDeclaration>, routes: ReadonlyArray<RouteDeclaration>) {
  return defineContract('notes', { records: [note], commands: [], loads: [], jobs, routes });
}

/** The changes from one notes contract to another, as `door id` strings. */
function between(
  before: { jobs?: ReadonlyArray<JobDeclaration>; routes?: ReadonlyArray<RouteDeclaration> },
  after: { jobs?: ReadonlyArray<JobDeclaration>; routes?: ReadonlyArray<RouteDeclaration> },
) {
  return compareManifests(
    manifestOf([contractOf(before.jobs ?? [], before.routes ?? [])]),
    manifestOf([contractOf(after.jobs ?? [], after.routes ?? [])]),
  ).map((change) => `${change.door} ${change.id}`);
}

const count = (payload: Record<string, ReturnType<typeof text> | 'string' | 'string?'>) =>
  job('notes/count', { payload });
const importNote = (
  body: Record<string, 'string' | 'string?'> | 'none',
  says = 'A tester posts.',
) => route('notes/import', { method: 'POST', path: '/webhooks/notes', body, says });

test('a job or a route with a bad name or no sentence of its use fails when it is declared', () => {
  expect(() => job('count', { payload: {} })).toThrow('kebab case');
  expect(() => job('notes/Count', { payload: {} })).toThrow('kebab case');
  expect(() => route('import', { method: 'POST', path: '/x', body: 'none', says: 'Who.' })).toThrow(
    'kebab case',
  );
  expect(() =>
    route('notes/import', { method: 'POST', path: '/x', body: 'none', says: '  ' }),
  ).toThrow('has no `says`');
});

test('a contract with a job or a route of another contract, or a repeated one, fails', () => {
  expect(() => contractOf([job('other/count', { payload: {} })], [])).toThrow(
    'The job other/count is in the contract notes',
  );
  expect(() =>
    contractOf([], [route('other/x', { method: 'GET', path: '/x', body: 'none', says: 'Who.' })]),
  ).toThrow('The route other/x is in the contract notes');
  expect(() => contractOf([count({}), count({})], [])).toThrow('declares notes/count twice');
  const twin = { method: 'POST', path: '/webhooks/notes', body: 'none', says: 'Who.' } as const;
  expect(() => contractOf([], [route('notes/a', twin), route('notes/b', twin)])).toThrow(
    'has the method POST and the path /webhooks/notes',
  );
});

test('the manifest lists each job and route sorted, and the digest leaves them out', () => {
  const plain = manifestOf([contractOf([], [])]);
  const full = manifestOf([
    contractOf(
      [count({ spaceId: 'string', title: text({ max: 10 }) })],
      [
        importNote({ eventId: 'string' }),
        route('notes/a-ping', { method: 'GET', path: '/ping', body: 'none', says: 'A monitor.' }),
      ],
    ),
  ]);
  expect(full.jobs).toEqual([
    {
      name: 'notes/count',
      contract: 'notes',
      payload: { spaceId: 'string', title: { kind: 'string', min: 0, max: 10 } },
    },
  ]);
  expect(full.routes.map((entry) => entry.name)).toEqual(['notes/a-ping', 'notes/import']);
  expect(full.routes[1]).toEqual({
    name: 'notes/import',
    contract: 'notes',
    method: 'POST',
    path: '/webhooks/notes',
    body: { eventId: 'string' },
    says: 'A tester posts.',
  });
  expect(full.routes[0]?.body).toBe('none');
  expect(full.digest).toBe(plain.digest);
});

test('a job that goes is one-way, and a job that comes is two-way', () => {
  expect(between({ jobs: [count({})] }, {})).toEqual(['one-way job-removed:notes/count']);
  expect(between({}, { jobs: [count({})] })).toEqual(['two-way job-added:notes/count']);
});

test('a job payload takes an optional field two-way, and a required field, a removed or a narrowed one one-way', () => {
  const before = { jobs: [count({ spaceId: 'string' })] };
  expect(between(before, { jobs: [count({ spaceId: 'string', note: 'string?' })] })).toEqual([
    'two-way job-payload-added:notes/count.note',
  ]);
  expect(between(before, { jobs: [count({ spaceId: 'string', note: 'string' })] })).toEqual([
    'one-way job-payload-added:notes/count.note',
  ]);
  expect(between(before, { jobs: [count({})] })).toEqual([
    'one-way job-payload-removed:notes/count.spaceId',
  ]);
  const titled = { jobs: [count({ title: text({ max: 10 }) })] };
  expect(between(titled, { jobs: [count({ title: text({ max: 20 }) })] })).toEqual([
    'two-way job-payload-widened:notes/count.title',
  ]);
  expect(between(titled, { jobs: [count({ title: text({ max: 5 }) })] })).toEqual([
    'one-way job-payload-changed:notes/count.title',
  ]);
});

test('a route that goes is one-way, and one that comes is two-way', () => {
  expect(between({ routes: [importNote('none')] }, {})).toEqual([
    'one-way route-removed:notes/import',
  ]);
  expect(between({}, { routes: [importNote('none')] })).toEqual([
    'two-way route-added:notes/import',
  ]);
});

test('a route that changes its method or its path is moved, one-way', () => {
  const before = { routes: [importNote('none')] };
  const moved = route('notes/import', {
    method: 'PUT',
    path: '/webhooks/notes',
    body: 'none',
    says: 'A tester posts.',
  });
  const repathed = route('notes/import', {
    method: 'POST',
    path: '/hooks/notes',
    body: 'none',
    says: 'A tester posts.',
  });
  expect(between(before, { routes: [moved] })).toEqual(['one-way route-moved:notes/import']);
  expect(between(before, { routes: [repathed] })).toEqual(['one-way route-moved:notes/import']);
});

test('a route body goes from none to fields one-way, and back two-way, and its fields follow the job rule', () => {
  expect(
    between({ routes: [importNote('none')] }, { routes: [importNote({ eventId: 'string' })] }),
  ).toEqual(['one-way route-body-changed:notes/import']);
  expect(
    between({ routes: [importNote({ eventId: 'string' })] }, { routes: [importNote('none')] }),
  ).toEqual(['two-way route-body-changed:notes/import']);
  const body = { routes: [importNote({ eventId: 'string' })] };
  expect(
    between(body, { routes: [importNote({ eventId: 'string', organizationId: 'string' })] }),
  ).toEqual(['one-way route-body-added:notes/import.organizationId']);
  expect(between(body, { routes: [importNote({ eventId: 'string', note: 'string?' })] })).toEqual([
    'two-way route-body-added:notes/import.note',
  ]);
  expect(
    between(
      { routes: [importNote({ eventId: 'string?' })] },
      { routes: [importNote({ eventId: 'string' })] },
    ),
  ).toEqual(['one-way route-body-changed:notes/import.eventId']);
});

test('a change of what a route says alone is two-way', () => {
  expect(
    between(
      { routes: [importNote('none', 'A tester posts.')] },
      { routes: [importNote('none', 'A partner posts.')] },
    ),
  ).toEqual(['two-way route-described:notes/import']);
});

test('a declared part that no contract lists is found, and a plain value is not a part', () => {
  const sweep = job('notes/sweep', { payload: { spaceId: 'string' } });
  const tally = job('notes/count', { payload: { spaceId: 'string' } });
  const contract = defineContract('notes', {
    records: [note],
    commands: [],
    loads: [],
    jobs: [tally],
  });
  const exported = [contract, note, tally, sweep, 5, 'limit', null, { name: 'not a part' }];
  expect(unlistedParts(exported, contract)).toEqual([
    { kind: 'job', name: 'notes/sweep', list: 'jobs' },
  ]);
  // With no contract, each part is unlisted.
  expect(unlistedParts(exported).map((part) => part.name)).toEqual([
    'Note',
    'notes/count',
    'notes/sweep',
  ]);
});

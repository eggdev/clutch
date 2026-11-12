import { afterAll, expect, test } from 'bun:test';

import { serverChange } from '@repo/sync/commands/server-change.server';
import { command } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { job } from '@repo/sync/contract/job';
import { route } from '@repo/sync/contract/route';
import { defineJob } from '@repo/sync/service/jobs';
import { defineRoute } from '@repo/sync/service/routes';
import { serverOf, serverPackage } from '@repo/sync/service/server-package.server';
import { removeTypeFixtures, typeErrors } from '@repo/sync/testing/type-errors';
import { Effect } from 'effect';
import { HttpServerResponse } from 'effect/http';

const create = command('notes/create', {
  input: {},
  waits: 'server',
  access: 'organization',
  refuses: [],
  tool: 'none',
});
const other = command('notes/other', {
  input: {},
  waits: 'server',
  access: 'organization',
  refuses: [],
  tool: 'none',
});
const countDeclaration = job('notes/count', { payload: {} });
const count = defineJob(countDeclaration, () => Effect.void);
const importDeclaration = route('notes/import', {
  method: 'POST',
  path: '/webhooks/notes',
  body: 'none',
  says: 'An outside system posts one note.',
});
const answer = defineRoute(importDeclaration, () => Effect.succeed(HttpServerResponse.text('ok')));
const createServer = serverChange(create, { run: () => Effect.succeed([]) });
const otherServer = serverChange(other, { run: () => Effect.succeed([]) });
const notes = defineContract('notes', {
  records: [],
  commands: [create],
  loads: [],
  jobs: [countDeclaration],
  routes: [importDeclaration],
});

test('a server package keeps its contract and each list, and serverOf gives each part', () => {
  const good = serverPackage(notes, { changes: [createServer], jobs: [count], routes: [answer] });
  expect(good.kind).toBe('server-package');
  expect(good.contract.name).toBe('notes');
  expect(good.jobs.map((declared) => declared.name)).toEqual(['notes/count']);
  expect(good.migrate).toBeNull();
  const cards = defineContract('cards', { records: [], commands: [], loads: [] });
  const parts = serverOf([good, serverPackage(cards, { changes: [] })]);
  expect(parts.contracts.map((contract) => contract.name)).toEqual(['notes', 'cards']);
  expect(parts.serverChanges.map((change) => change.name)).toEqual(['notes/create']);
  expect(parts.jobs.map((declared) => declared.name)).toEqual(['notes/count']);
  expect(parts.routes.map((declared) => declared.name)).toEqual(['notes/import']);
  expect(parts.migrations).toEqual([]);
});

test('a server package with a missing or an extra half throws when it loads', () => {
  // The type of each list also rejects these. The test goes around it to prove
  // that a JavaScript caller still fails loudly.
  expect(() => Reflect.apply(serverPackage, null, [notes, { changes: [] }])).toThrow(
    'notes/create is declared and has no server change in the list',
  );
  expect(() =>
    Reflect.apply(serverPackage, null, [notes, { changes: [createServer], routes: [answer] }]),
  ).toThrow('notes/count is declared and has no job in the list');
  expect(() =>
    Reflect.apply(serverPackage, null, [notes, { changes: [createServer], jobs: [count] }]),
  ).toThrow('notes/import is declared and has no route in the list');
  expect(() =>
    Reflect.apply(serverPackage, null, [
      notes,
      { changes: [createServer, otherServer], jobs: [count], routes: [answer] },
    ]),
  ).toThrow('notes/other is not a server change of this contract');
});

afterAll(removeTypeFixtures);

test('a missing server change, a missing job, a missing route and an undeclared change do not compile', async () => {
  const errors = await typeErrors(`import { command } from '@repo/sync/contract/command';
import { defineContract } from '@repo/sync/contract/define';
import { job } from '@repo/sync/contract/job';
import { route } from '@repo/sync/contract/route';
import { serverChange } from '@repo/sync/commands/server-change.server';
import { defineJob } from '@repo/sync/service/jobs';
import { defineRoute } from '@repo/sync/service/routes';
import { serverPackage } from '@repo/sync/service/server-package.server';
import { Effect } from 'effect';
import { HttpServerResponse } from 'effect/http';

const create = command('notes/create', { input: {}, waits: 'server', access: 'organization', refuses: [], tool: 'none' });
const other = command('notes/other', { input: {}, waits: 'server', access: 'organization', refuses: [], tool: 'none' });
const countDeclaration = job('notes/count', { payload: {} });
const count = defineJob(countDeclaration, () => Effect.void);
const importDeclaration = route('notes/import', { method: 'POST', path: '/webhooks/notes', body: 'none', says: 'An outside system posts one note.' });
const answer = defineRoute(importDeclaration, () => Effect.succeed(HttpServerResponse.text('ok')));
const createServer = serverChange(create, { run: () => Effect.succeed([]) });
const otherServer = serverChange(other, { run: () => Effect.succeed([]) });
const notes = defineContract('notes', {
  records: [],
  commands: [create],
  loads: [],
  jobs: [countDeclaration],
  routes: [importDeclaration],
});
export const good = serverPackage(notes, { changes: [createServer], jobs: [count], routes: [answer] });
export const missingChange = serverPackage(notes, { changes: [], jobs: [count], routes: [answer] });
export const missingJob = serverPackage(notes, { changes: [createServer], jobs: [], routes: [answer] });
export const missingRoute = serverPackage(notes, { changes: [createServer], jobs: [count], routes: [] });
export const undeclaredChange = serverPackage(notes, {
  changes: [createServer, otherServer],
  jobs: [count],
  routes: [answer],
});
`);
  expect(errors).toHaveLength(4);
  expect(errors[0]).toContain('readonly missingHalfOf: "notes/create"');
  expect(errors[1]).toContain('readonly missingHalfOf: "notes/count"');
  expect(errors[2]).toContain('readonly missingHalfOf: "notes/import"');
  expect(errors[3]).toContain('readonly notDeclaredBy: "notes/other"');
}, 60_000);

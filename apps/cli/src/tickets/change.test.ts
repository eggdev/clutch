import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  addTicket,
  claimPhase,
  editTicket,
  holdTicket,
  linkTicket,
  readyPhases,
  releaseTicket,
  routeTicket,
  setPhase,
} from '@/tickets/change';
import { TicketStore } from '@/tickets/store';

async function tempStore() {
  const folder = await mkdtemp(path.join(tmpdir(), 'tickets-'));
  const store = new TicketStore(path.join(folder, 'tickets.sqlite'));
  return Object.assign(store, {
    [Symbol.asyncDispose]: async () => {
      store[Symbol.dispose]();
      await rm(folder, { recursive: true, force: true });
    },
  });
}

const add = (store: TicketStore, hold = false) =>
  addTicket(store, 'owner', {
    prefix: 'T',
    title: 'Fix the login',
    description: 'The login button does nothing.',
    kind: 'bug',
    hold,
    source: 'thread-1',
  }).data.id;

const statuses = (store: TicketStore, id: string) =>
  Object.fromEntries(store.phases(id).map((row) => [row.phase, row.status]));

const complete = {
  now: 'The button does nothing.',
  expected: 'The button signs in.',
  location: 'apps/web/login.tsx',
  acceptance: ['A click signs in.'],
  major: false,
};

test('ids start at 1000, and a new ticket has one triage phase that a hold keeps not_ready', async () => {
  await using store = await tempStore();
  expect(add(store)).toBe('T-1000');
  expect(add(store, true)).toBe('T-1001');
  expect(statuses(store, 'T-1000')).toEqual({ triage: 'ready' });
  expect(statuses(store, 'T-1001')).toEqual({ triage: 'not_ready' });
  releaseTicket(store, 'owner', 'T-1001');
  expect(statuses(store, 'T-1001')).toEqual({ triage: 'ready' });
  holdTicket(store, 'owner', 'T-1001');
  expect(statuses(store, 'T-1001')).toEqual({ triage: 'not_ready' });
});

test('a route with no planning names each missing requirement, and passes once they are set', async () => {
  await using store = await tempStore();
  const id = add(store);
  const route = { phases: ['build', 'review'], reason: 'A small fix.' };
  expect(() => routeTicket(store, 'triage', id, route)).toThrow(
    'needs these first: now, expected, location, acceptance (at least one check), major: no.',
  );
  editTicket(store, 'triage', id, { now: complete.now, major: true });
  expect(() => routeTicket(store, 'triage', id, route)).toThrow(
    'needs these first: expected, location, acceptance (at least one check), major: no.',
  );
  editTicket(store, 'triage', id, complete);
  routeTicket(store, 'triage', id, route);
  expect(store.ticket(id).route).toEqual(['triage', 'build', 'review']);
  expect(statuses(store, id)).toEqual({
    triage: 'ready',
    build: 'not_ready',
    review: 'not_ready',
  });
  expect(() =>
    routeTicket(store, 'triage', id, {
      phases: ['review', 'build'],
      reason: 'x',
    }),
  ).toThrow('List each phase once');
  // A route with planning needs nothing else.
  const other = add(store);
  routeTicket(store, 'triage', other, {
    phases: ['planning', 'build'],
    reason: 'Vague.',
  });
});

test('done makes the next phase ready, and ready again sets every later phase to not_ready', async () => {
  await using store = await tempStore();
  const id = add(store);
  routeTicket(store, 'triage', id, {
    phases: ['planning', 'build', 'review'],
    reason: 'x',
  });
  setPhase(store, 'triage', id, {
    phase: 'triage',
    status: 'done',
    reason: null,
  });
  expect(statuses(store, id).planning).toBe('ready');
  setPhase(store, 'a', id, { phase: 'planning', status: 'done', reason: null });
  claimPhase(store, 'builder', id, 'build', 'thread-9');
  setPhase(store, 'builder', id, {
    phase: 'build',
    status: 'done',
    reason: null,
  });
  expect(statuses(store, id)).toMatchObject({ build: 'done', review: 'ready' });
  expect(store.phase(id, 'build')).toMatchObject({
    claimedBy: 'builder',
    thread: 'thread-9',
  });

  setPhase(store, 'owner', id, {
    phase: 'planning',
    status: 'ready',
    reason: 'Plan again.',
  });
  expect(statuses(store, id)).toEqual({
    triage: 'done',
    planning: 'ready',
    build: 'not_ready',
    review: 'not_ready',
  });
});

test('a claim needs a ready phase, so a second claim fails', async () => {
  await using store = await tempStore();
  const id = add(store);
  claimPhase(store, 'first', id, 'triage', null);
  expect(() => claimPhase(store, 'second', id, 'triage', null)).toThrow(
    'T-1000 triage is in_progress, claimed by first.',
  );
  expect(() => claimPhase(store, 'second', id, 'build', null)).toThrow('has no build phase');
});

test('each changed record gets one event in the webhook shape, and a write that changes nothing adds none', async () => {
  await using store = await tempStore();
  const id = add(store);
  setPhase(store, 'owner', id, {
    phase: 'triage',
    status: 'blocked',
    reason: 'Which page?',
  });
  linkTicket(store, 'owner', id, {
    kind: 'evidence',
    value: 'https://example.com/shot.png',
  });
  expect(
    linkTicket(store, 'owner', id, {
      kind: 'evidence',
      value: 'https://example.com/shot.png',
    }),
  ).toBeNull();
  expect(releaseTicket(store, 'owner', id)).toBeNull();

  const events = store.events();
  expect(events).toHaveLength(4);
  for (const event of events) {
    expect(Object.keys(event).toSorted()).toEqual([
      'action',
      'actor',
      'createdAt',
      'data',
      'deliveryId',
      'number',
      'type',
      'updatedFrom',
    ]);
  }
  expect(events[0]).toMatchObject({
    type: 'Ticket',
    action: 'create',
    updatedFrom: {},
  });
  expect(events[1]).toMatchObject({
    type: 'Phase',
    action: 'create',
    data: { id, phase: 'triage', status: 'ready' },
  });
  expect(events[2]).toMatchObject({
    type: 'Phase',
    action: 'update',
    data: {
      id,
      phase: 'triage',
      status: 'blocked',
      blockedReason: 'Which page?',
    },
    updatedFrom: { status: 'ready', blockedReason: null },
  });
  expect(events[3]).toMatchObject({
    type: 'Ticket',
    updatedFrom: { links: [] },
  });
  expect(store.events({ ticket: id, since: 3 }).map((event) => event.number)).toEqual([4]);
});

test('done writes one event for the phase and one for the next phase that becomes ready', async () => {
  await using store = await tempStore();
  const id = add(store);
  editTicket(store, 'owner', id, complete);
  routeTicket(store, 'owner', id, { phases: ['build', 'review'], reason: 'x' });
  const since = store.events().length;
  const done = setPhase(store, 'owner', id, { phase: 'triage', status: 'done', reason: null });
  expect(done).toMatchObject({ data: { phase: 'triage' }, updatedFrom: { status: 'ready' } });
  expect(store.events({ since }).map((event) => [event.data, event.updatedFrom])).toMatchObject([
    [{ phase: 'triage', status: 'done' }, { status: 'ready' }],
    [{ phase: 'build', status: 'ready' }, { status: 'not_ready' }],
  ]);
  const held = store.events().length;
  holdTicket(store, 'owner', id);
  expect(store.events({ since: held }).map((event) => event.type)).toEqual(['Ticket', 'Phase']);
});

test('edit never changes the description, and ready skips held tickets and open dependencies', async () => {
  await using store = await tempStore();
  const first = add(store);
  const second = add(store);
  const held = add(store, true);
  editTicket(store, 'owner', second, {
    ...complete,
    dependsOn: [first],
    body: '# Plan\n',
  });
  expect(store.ticket(second)).toMatchObject({
    description: 'The login button does nothing.',
    dependsOn: [first],
    body: '# Plan\n',
  });
  expect(() => editTicket(store, 'owner', second, { dependsOn: ['T-9999'] })).toThrow(
    'No ticket T-9999.',
  );
  expect(readyPhases(store).map((row) => row.id)).toEqual([first]);

  routeTicket(store, 'owner', first, { phases: ['planning'], reason: 'x' });
  setPhase(store, 'owner', first, {
    phase: 'triage',
    status: 'done',
    reason: null,
  });
  setPhase(store, 'owner', first, {
    phase: 'planning',
    status: 'done',
    reason: null,
  });
  expect(readyPhases(store).map((row) => row.id)).toEqual([second]);
  expect(held).toBe('T-1002');
});

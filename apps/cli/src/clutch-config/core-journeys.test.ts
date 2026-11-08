import { expect, test } from 'bun:test';

import { coreJourneys } from '@/clutch-config/core-journeys';
import { validateClutchConfig } from '@/clutch-config/schema';

const valid = {
  schemaVersion: 1,
  project: 'shop',
  template: { repo: 'eggdev/clutch', mode: 'sync' },
  capabilities: { root_agents_md: 'adopted' },
};

const allCore = Object.fromEntries(coreJourneys.map((name) => [name, 'adopted']));

test('an adopted core journey may leave out failure states, each with a reason', () => {
  const without = { 'weak-password-refused': 'Sign-in is an emailed code.' };
  const decisions = { ...allCore, 'sign-up': { status: 'adopted', without } };
  expect(
    validateClutchConfig({ ...valid, coreJourneys: decisions }).config?.coreJourneys?.['sign-up'],
  ).toEqual({ status: 'adopted', without });
  const errorsOf = (entry: unknown) =>
    validateClutchConfig({
      ...valid,
      coreJourneys: { ...allCore, 'sign-up': entry },
    }).errors.map((error) => error.path);
  expect(errorsOf({ status: 'adopted', without: {} })).toEqual(['coreJourneys.sign-up.without']);
  expect(errorsOf({ status: 'adopted', without: { 'weak-password-refused': ' ' } })).toEqual([
    'coreJourneys.sign-up.without.weak-password-refused',
  ]);
});

test('journeys takes a web app, an inbox command, or both', () => {
  const inbox = ['bun', 'tools/inbox.ts'];
  expect(validateClutchConfig({ ...valid, journeys: { inbox } }).config?.journeys).toEqual({
    inbox,
  });
  expect(
    validateClutchConfig({ ...valid, journeys: { webApp: 'apps/web', inbox } }).config?.journeys,
  ).toEqual({ webApp: 'apps/web', inbox });
  expect(
    validateClutchConfig({ ...valid, journeys: { inbox: [] } }).errors.map((error) => error.path),
  ).toEqual(['journeys.inbox']);
});

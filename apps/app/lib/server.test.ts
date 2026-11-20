import { afterEach, expect, test } from 'bun:test';

import { afterSessionEnded } from '@/lib/server';

/**
 * After a session ends, or after a newer build takes the local database, the
 * web loads the page again. It does not start the app again in the old page
 * first: that start would open the old build on a database that is newer, and
 * show for a moment that the app could not start.
 */

const original = Reflect.get(globalThis, 'location');

afterEach(() => {
  Reflect.set(globalThis, 'location', original);
});

test('on the web, the page loads again from its start, and the app does not start again in the old page', () => {
  const assigned: Array<string> = [];
  Reflect.set(globalThis, 'location', { assign: (url: string) => assigned.push(url) });
  let restarts = 0;
  afterSessionEnded(() => {
    restarts += 1;
  });
  expect(assigned).toEqual(['/']);
  expect(restarts).toBe(0);
});

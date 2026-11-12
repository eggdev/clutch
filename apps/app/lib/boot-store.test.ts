import { expect, test } from 'bun:test';

import { bootStore } from '@/lib/boot-store';

/** Waits for the tasks that a start queued. */
function settle() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** A listener that does nothing with a change. It is here to start the app. */
const heard: Array<number> = [];
function listen() {
  heard.push(heard.length);
}

test('the first listener starts the app, and the state holds what it loaded', async () => {
  let starts = 0;
  const store = bootStore(() => {
    starts += 1;
    return Promise.resolve('pool');
  });
  expect([starts, store.state().loaded]).toEqual([0, undefined]);
  let changes = 0;
  store.subscribe(() => {
    changes += 1;
  });
  store.subscribe(listen);
  await settle();
  expect([starts, store.state().loaded, store.state().failure]).toEqual([1, 'pool', undefined]);
  expect(changes).toBe(1);
});

test('a start that throws becomes a failure with a sentence, not an empty page', async () => {
  const store = bootStore<string>(() =>
    Promise.reject(new Error('The local database is blocked on this device.')),
  );
  store.subscribe(listen);
  await settle();
  expect(store.state()).toEqual({
    loaded: undefined,
    failure: 'The app could not start: The local database is blocked on this device. Try again.',
    reports: [],
  });
});

test('a restart after a failure starts again and clears the failure', async () => {
  let attempt = 0;
  const store = bootStore(() => {
    attempt += 1;
    return attempt === 1 ? Promise.reject(new Error('Not yet.')) : Promise.resolve('pool');
  });
  store.subscribe(listen);
  await settle();
  expect(store.state().failure).toContain('Not yet.');
  store.restart();
  expect(store.state().failure).toBeUndefined();
  await settle();
  expect([attempt, store.state().loaded, store.state().failure]).toEqual([2, 'pool', undefined]);
});

test('each report is kept in order for the screen', async () => {
  const store = bootStore((report) => {
    report('The saved copy does not fit this build.');
    report('The saved input does not fit this build.');
    return Promise.resolve('pool');
  });
  store.subscribe(listen);
  await settle();
  expect(store.state().reports).toEqual([
    'The saved copy does not fit this build.',
    'The saved input does not fit this build.',
  ]);
});

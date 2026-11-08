import { expect, test } from 'bun:test';

import { readInbox } from '@repo/journeys/testing/inbox';

const printing = (text: string) => ['sh', '-c', `printf '%s' '${text}'`, 'inbox'];

test('the inbox command gives the code and the link of the newest email', () => {
  expect(readInbox(printing('{"code":"123456"}'), 'a@example.test')).toEqual({ code: '123456' });
  expect(readInbox(printing('{}'), 'a@example.test')).toEqual({});
});

test('the command gets the address as its last argument', () => {
  const echo = ['sh', '-c', 'printf \'{"link":"%s"}\' "$1"', 'inbox'];
  expect(readInbox(echo, 'a@example.test')).toEqual({ link: 'a@example.test' });
});

test('a failed command and a missing command stop the journey with the reason', () => {
  expect(() => readInbox(['sh', '-c', 'echo denied >&2; exit 3'], 'a@example.test')).toThrow(
    'The inbox command failed for a@example.test: denied',
  );
  expect(() => readInbox([], 'a@example.test')).toThrow('Set journeys.inbox in clutch.yaml.');
});

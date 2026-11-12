import { expect, test } from 'bun:test';

import { text } from '@repo/sync/contract/fields';
import { route } from '@repo/sync/contract/route';
import { bodyOf, defineRoute } from '@repo/sync/service/routes';
import { Effect } from 'effect';
import { HttpServerResponse } from 'effect/http';

const importDeclaration = route('notes/import', {
  method: 'POST',
  path: '/webhooks/notes',
  body: { eventId: 'string', title: text({ max: 5 }) },
  says: 'An outside system posts one note.',
});
const ping = route('notes/ping', {
  method: 'GET',
  path: '/ping',
  body: 'none',
  says: 'A monitor.',
});

const answer = defineRoute(importDeclaration, () => Effect.succeed(HttpServerResponse.text('ok')));
const pong = defineRoute(ping, () => Effect.succeed(HttpServerResponse.text('pong')));

test('a route takes its name, method and path from its declaration', () => {
  expect(answer).toMatchObject({ name: 'notes/import', method: 'POST', path: '/webhooks/notes' });
  expect(pong.method).toBe('GET');
});

test('bodyOf gives the typed body only when the JSON has each field with its kind', () => {
  expect(bodyOf(importDeclaration, '{"eventId":"e1","title":"Hi"}')).toEqual({
    eventId: 'e1',
    title: 'Hi',
  });
  expect(bodyOf(importDeclaration, 'not json')).toBeUndefined();
  expect(bodyOf(importDeclaration, '{"eventId":"e1"}')).toBeUndefined();
  expect(bodyOf(importDeclaration, '{"eventId":"e1","title":"Too long a title"}')).toBeUndefined();
  expect(bodyOf(importDeclaration, '["e1"]')).toBeUndefined();
  expect(bodyOf(ping, '{}')).toBeUndefined();
});

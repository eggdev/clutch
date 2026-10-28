import { expect, test } from 'bun:test';

import { originAllowed } from '@repo/sync/config/origins';
import { Option } from 'effect';

test('with no SYNC_ORIGINS, only loopback origins may open the socket', () => {
  const none = Option.none<ReadonlyArray<string>>();
  expect(originAllowed('http://localhost:5173', none)).toBe(true);
  expect(originAllowed('http://project-template.localhost:1355', none)).toBe(true);
  expect(originAllowed('http://127.0.0.1:4000', none)).toBe(true);
  expect(originAllowed('https://evil.example', none)).toBe(false);
  expect(originAllowed('http://localhost.evil.example', none)).toBe(false);
  expect(originAllowed('not a url', none)).toBe(false);
});

test('with SYNC_ORIGINS, only the listed origins may open the socket', () => {
  const listed = Option.some(['https://app.example.com']);
  expect(originAllowed('https://app.example.com', listed)).toBe(true);
  expect(originAllowed('http://localhost:5173', listed)).toBe(false);
  expect(originAllowed('https://app.example.com.evil.example', listed)).toBe(false);
});

test('a request with no origin is not from a page, so it passes', () => {
  expect(originAllowed(undefined, Option.none())).toBe(true);
  expect(originAllowed(undefined, Option.some(['https://app.example.com']))).toBe(true);
});

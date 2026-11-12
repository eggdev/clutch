import { expect, test } from 'bun:test';

import {
  clientApps,
  isClientApp,
  isNativeApp,
  isServerApp,
  isWebApp,
  nativeApps,
} from '@tools/apps';
import { inRepo } from '@tools/testing/in-repo';

const react = { dependencies: { react: '19.2.3' } };
const reactNative = { dependencies: { 'react-native': '0.86.3' } };
const expo = { dependencies: { expo: '~57.0.30' }, devDependencies: { react: '19.2.3' } };
const server = { dependencies: { effect: '4.0.7' }, nx: { tags: ['platform:server'] } };
const commandLine = { dependencies: { yaml: '2.0.0' } };

test('a client app is no server app, and has the native tag or depends on React, React Native or Expo', () => {
  expect([react, reactNative, expo, server, commandLine].map(isClientApp)).toEqual([
    true,
    true,
    true,
    false,
    false,
  ]);
  expect(isClientApp({ devDependencies: { react: '19.2.3' } })).toBe(false);
  expect(isClientApp({ nx: { tags: ['platform:native'] } })).toBe(true);
  // A server app that renders with React is still a server app.
  expect(
    isClientApp({ dependencies: { react: '19.2.3' }, nx: { tags: ['platform:server'] } }),
  ).toBe(false);
});

test('a native app depends on Expo or React Native, in either section', () => {
  expect([reactNative, expo, react, server].map(isNativeApp)).toEqual([true, true, false, false]);
});

test('a server app has the platform:server tag', () => {
  expect([server, react].map(isServerApp)).toEqual([true, false]);
});

test('a web app is a client app with a build:web script, or a client app that is not native', () => {
  const universal = { dependencies: { expo: '~57.0.30', react: '19.2.3' } };
  expect(isWebApp({ ...universal, scripts: { 'build:web': 'one build' } })).toBe(true);
  expect(isWebApp({ ...universal, scripts: {} })).toBe(false);
  expect(isWebApp(react)).toBe(true);
  expect(isWebApp(reactNative)).toBe(false);
  expect(isWebApp(server)).toBe(false);
  expect(isWebApp(commandLine)).toBe(false);
});

test('the client and native apps of a root are the apps under apps/ with those rules', async () => {
  await inRepo(
    {
      'apps/app/package.json': JSON.stringify({
        dependencies: { expo: '~57.0.30', react: '19.2.3' },
      }),
      'apps/web/package.json': JSON.stringify(react),
      'apps/api/package.json': JSON.stringify(server),
      'apps/cli/package.json': JSON.stringify(commandLine),
      'apps/notes/README.md': 'Not an app.',
    },
    (root) => {
      expect(clientApps(root)).toEqual(['app', 'web']);
      expect(nativeApps(root)).toEqual(['app']);
    },
  );
});

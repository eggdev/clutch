import { expect, test } from 'bun:test';

import { outputsOf, reachOf, summaryOf } from '@tools/journeys/reach';
import { inRepo } from '@tools/testing/in-repo';

const files = {
  'apps/web/package.json': JSON.stringify({
    dependencies: { '@features/notes': 'workspace:*' },
  }),
  'apps/mobile/package.json': JSON.stringify({
    dependencies: { expo: '55.0.0', '@features/billing': 'workspace:*' },
  }),
  'packages/identity/package.json': JSON.stringify({
    nx: { tags: ['type:package'] },
  }),
  'packages/access/package.json': JSON.stringify({
    nx: { tags: ['type:package'] },
  }),
  'packages/journeys/package.json': JSON.stringify({
    nx: { tags: ['type:tool'] },
  }),
};

/** The files of the repository, with the app.json of the native app. */
const withApp = (app: object) => ({
  ...files,
  'apps/mobile/app.json': JSON.stringify({ expo: app }),
});

test('every change reaches web, and only web code reaches no native platform', async () => {
  await inRepo(files, (root) => {
    expect(reachOf(root, ['apps/web/src/home.tsx', 'features/notes/screens/notes.tsx'])).toEqual({
      web: true,
      native: false,
      why: [],
    });
    expect(reachOf(root, ['packages/journeys/testing/a11y.ts']).native).toBe(false);
  });
});

test('a sensitive path alone reaches web only, so a change to the merge gate starts no native lane', async () => {
  await inRepo(files, (root) => {
    expect(reachOf(root, ['.clutch/risk.yaml', 'tools/github/auto-merge-rules.ts'])).toEqual({
      web: true,
      native: false,
      why: [],
    });
  });
});

test('a native app, a shared runtime package, a feature that a native app uses, a native journey or the native tooling reaches native', async () => {
  await inRepo(files, (root) => {
    expect(
      reachOf(root, [
        'apps/mobile/app/index.tsx',
        'packages/identity/service/session.ts',
        'packages/access/policy/roles.ts',
        'features/billing/screens/pay.tsx',
        'features/notes/journeys/notes-sync.maestro.yaml',
        'features/notes/journeys/notes-sync.journey.ts',
        'tools/native/device-host.ts',
        '.clutch/risk.yaml',
      ]),
    ).toEqual({
      web: true,
      native: true,
      why: [
        'apps/mobile/app/index.tsx is in apps/mobile',
        'packages/identity/service/session.ts is in packages/identity',
        'packages/access/policy/roles.ts is in packages/access',
        'features/billing/screens/pay.tsx is in features/billing',
        'features/notes/journeys/notes-sync.maestro.yaml is a native journey',
        'features/notes/journeys/notes-sync.journey.ts is a native journey',
        'tools/native/device-host.ts is in tools/native',
      ],
    });
  });
});

test('the ios and android outputs need native reach, and an app ID that the native app declares', async () => {
  const native = 'apps/mobile/app/index.tsx';
  await inRepo(withApp({ ios: { bundleIdentifier: 'dev.x.app' } }), (root) => {
    expect(outputsOf(root, reachOf(root, [native]))).toEqual({
      native: true,
      ios: true,
      android: false,
    });
  });
  await inRepo(withApp({ android: { package: 'dev.x.app' } }), (root) => {
    expect(outputsOf(root, reachOf(root, [native]))).toEqual({
      native: true,
      ios: false,
      android: true,
    });
  });
  await inRepo(withApp({}), (root) => {
    expect(outputsOf(root, reachOf(root, [native]))).toEqual({
      native: true,
      ios: false,
      android: false,
    });
  });
  await inRepo(withApp({ ios: { bundleIdentifier: 'dev.x.app' } }), (root) => {
    expect(outputsOf(root, reachOf(root, ['apps/web/src/home.tsx']))).toEqual({
      native: false,
      ios: false,
      android: false,
    });
  });
});

test('the summary names the native platforms that a change reaches, and says that no CI job runs them yet', () => {
  const reach = { web: true, native: true, why: ['apps/mobile changed'] };
  expect(summaryOf(reach, { native: true, ios: true, android: false }, true)).toEqual([
    'Web: reached. Every PR runs the web journeys.',
    'Native: reached, because apps/mobile changed.',
    'Native platforms reached: iOS. No CI job runs a native journey yet: CL-596 adds one. Run the native journeys from a session on a device of the pool.',
  ]);
  expect(summaryOf(reach, { native: true, ios: false, android: false }, true).at(-1)).toStartWith(
    'Native platforms reached: none, because the native app declares no app ID.',
  );
  expect(
    summaryOf({ ...reach, native: false }, { native: false, ios: false, android: false }, true),
  ).toEqual([
    'Web: reached. Every PR runs the web journeys.',
    'Native: not reached. No changed file is native code or shared runtime code.',
  ]);
});

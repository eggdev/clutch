import { expect, test } from 'bun:test';

import { reachOf } from '@tools/journeys/reach';
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
  'packages/journeys/package.json': JSON.stringify({
    nx: { tags: ['type:tool'] },
  }),
};

const medium = (path: string) => ({ path, tier: 'medium' });

test('every change reaches web, and only web code reaches no native platform', async () => {
  await inRepo(files, (root) => {
    expect(
      reachOf(root, [medium('apps/web/src/home.tsx'), medium('features/notes/screens/notes.tsx')]),
    ).toEqual({ web: true, native: false, why: [] });
    expect(reachOf(root, [medium('packages/journeys/testing/a11y.ts')]).native).toBe(false);
  });
});

test('a native app, a shared runtime package, a feature that a native app uses, a native journey or a sensitive path reaches native', async () => {
  await inRepo(files, (root) => {
    expect(
      reachOf(root, [
        medium('apps/mobile/app/index.tsx'),
        medium('packages/identity/service/session.ts'),
        medium('features/billing/screens/pay.tsx'),
        medium('features/notes/journeys/notes-sync.maestro.yaml'),
        medium('tools/native/device-host.ts'),
        { path: '.clutch/risk.yaml', tier: 'one-way-door' },
      ]),
    ).toEqual({
      web: true,
      native: true,
      why: [
        'apps/mobile/app/index.tsx is in apps/mobile',
        'packages/identity/service/session.ts is in packages/identity',
        'features/billing/screens/pay.tsx is in features/billing',
        'features/notes/journeys/notes-sync.maestro.yaml is a native journey',
        'tools/native/device-host.ts is in tools/native',
        '.clutch/risk.yaml is a sensitive path',
      ],
    });
  });
});

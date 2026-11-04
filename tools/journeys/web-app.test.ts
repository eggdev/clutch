import { expect, test } from 'bun:test';

import { webAppOf } from '@tools/journeys/web-app';
import { inRepo } from '@tools/testing/in-repo';

/** The fixture's project name. The naming rule in tools/dev.ts gives the `web` app the bare project name. */
const project = 'shop';
const root = JSON.stringify({ name: project });

/** An app with an Nx `dev` target, and the tags that the check reads. */
const app = (tags: Array<string> = [], dev = true) =>
  JSON.stringify({
    nx: {
      tags,
      targets: dev ? { dev: { executor: 'nx:run-commands', options: { command: 'one dev' } } } : {},
    },
  });

test('the one app under apps/ with a web entry is the web app, and servers and native apps are not', async () => {
  await inRepo(
    {
      'package.json': root,
      'apps/api/package.json': app(['platform:server']),
      'apps/mobile/package.json': app(['platform:native']),
      'apps/web/package.json': app(['type:app']),
      'apps/mailbox/package.json': app([], false),
    },
    (folder) => expect(webAppOf(folder)).toMatchObject({ folder: 'apps/web', name: project }),
  );
});

test('journeys.webApp names the web app when several apps have a web entry', async () => {
  await inRepo(
    {
      'package.json': root,
      'clutch.yaml': 'schemaVersion: 1\njourneys:\n  webApp: apps/admin\n',
      'apps/web/package.json': app(),
      'apps/admin/package.json': app(),
    },
    (folder) => expect(webAppOf(folder)).toMatchObject({ folder: 'apps/admin' }),
  );
});

test('several web entries without journeys.webApp fail, and name each app and the key', async () => {
  await inRepo(
    {
      'package.json': root,
      'apps/web/package.json': app(),
      'apps/admin/package.json': app(),
    },
    (folder) =>
      expect(webAppOf(folder)).toBe(
        'Several apps under apps/ have a web entry: apps/admin, apps/web. Name the app that the web journeys drive in clutch.yaml with `journeys: { webApp: apps/<name> }`.',
      ),
  );
});

test('journeys.webApp must name an app under apps/ that has a dev target', async () => {
  await inRepo(
    {
      'package.json': root,
      'clutch.yaml': 'schemaVersion: 1\njourneys:\n  webApp: apps/app\n',
      'apps/app/package.json': app([], false),
    },
    (folder) =>
      expect(webAppOf(folder)).toBe(
        'clutch.yaml sets journeys.webApp to apps/app, but that app has no Nx `dev` target. Name an app under apps/ that has one.',
      ),
  );
});

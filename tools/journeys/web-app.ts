import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isWebApp, manifestOf } from '@tools/apps';
import { devApps } from '@tools/dev';
import type { DevApp } from '@tools/dev';
import { parse } from 'yaml';

/**
 * The app that a web journey drives. `journeys.webApp` in `clutch.yaml` names
 * it, as `apps/app`. Without the key, it is the one app under `apps/` with a
 * web entry: an Nx `dev` target, and a web app by the rule of `isWebApp` in
 * `tools/apps.ts`. Several candidates without the key fail, so a journey
 * never runs against the wrong app. See
 * docs/contributing/setup/verification.md#journeys.
 */

/** The folder that `journeys.webApp` names, or undefined when the key is not set. */
function configuredWebApp(root: string): string | undefined {
  const file = path.join(root, 'clutch.yaml');
  if (!existsSync(file)) {
    return undefined;
  }
  const data = parse(readFileSync(file, 'utf-8')) as { journeys?: { webApp?: unknown } } | null;
  const webApp = data?.journeys?.webApp;
  return typeof webApp === 'string' ? webApp : undefined;
}

/** The web app, or the message that says why there is none. */
export function webAppOf(root: string): DevApp | string {
  const apps = devApps(root);
  const configured = configuredWebApp(root);
  if (configured !== undefined) {
    const app = apps.find((item) => item.folder === configured);
    return (
      app ??
      `clutch.yaml sets journeys.webApp to ${configured}, but that app has no Nx \`dev\` target. Name an app under apps/ that has one.`
    );
  }
  const candidates = apps.filter((app) =>
    isWebApp(manifestOf(root, app.folder.replace(/^apps\//u, ''))),
  );
  const [only] = candidates;
  if (candidates.length === 1 && only) {
    return only;
  }
  if (candidates.length === 0) {
    return 'No app under apps/ has a web entry, which is an Nx `dev` target on a web app. A web journey needs one. Add the dev target, or name the app in clutch.yaml with `journeys: { webApp: apps/<name> }`.';
  }
  // Sorted, since the order of a directory read depends on the file system.
  const folders = candidates
    .map((app) => app.folder)
    .toSorted()
    .join(', ');
  return `Several apps under apps/ have a web entry: ${folders}. Name the app that the web journeys drive in clutch.yaml with \`journeys: { webApp: apps/<name> }\`.`;
}

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * The rules of the apps under `apps/`. Each rule is a pure function of a parsed
 * package.json, so a check, a generator and a test state it the same way. The
 * functions that read the folder use these rules for the apps of a root. A
 * client app ships to a device, a native app runs on a device through Expo or
 * React Native, a server app is tagged `platform:server`, and a web app is a
 * client app that builds for the web.
 */

/** The fields of a package.json that the app rules read. */
export type Manifest = {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly nx?: { readonly tags?: ReadonlyArray<string> };
};

/** A server app has the Nx tag `platform:server`. */
export function isServerApp(manifest: Manifest): boolean {
  return (manifest.nx?.tags ?? []).includes('platform:server');
}

/**
 * A client app ships to a device. It is no server app, and it has the Nx tag
 * `platform:native` or depends on React, React Native or Expo. The lint plugin
 * in tools/lint/determinism-policy.mjs holds a copy, because a plugin cannot
 * import this file, and tools/lint/determinism-policy.test.ts holds the two
 * to the same answers.
 */
export function isClientApp(manifest: Manifest): boolean {
  const dependencies = Object.keys(manifest.dependencies ?? {});
  return (
    !isServerApp(manifest) &&
    ((manifest.nx?.tags ?? []).includes('platform:native') ||
      dependencies.some((name) => ['react', 'react-native', 'expo'].includes(name)))
  );
}

/** A native app depends on Expo or React Native, in its dependencies or devDependencies. */
export function isNativeApp(manifest: Manifest): boolean {
  const all = { ...manifest.dependencies, ...manifest.devDependencies };
  return ['expo', 'react-native'].some((name) => name in all);
}

/** A web app is a client app with a `build:web` script, or a client app that is not native. */
export function isWebApp(manifest: Manifest): boolean {
  return (
    isClientApp(manifest) &&
    (manifest.scripts?.['build:web'] !== undefined || !isNativeApp(manifest))
  );
}

/** The manifest of the app `name` under `apps/`, or an empty manifest when it has none. */
export function manifestOf(root: string, name: string): Manifest {
  const file = path.join(root, 'apps', name, 'package.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : {};
}

/** The names of the apps under `apps/` that have a package.json, sorted. */
export function appNames(root: string): Array<string> {
  const apps = path.join(root, 'apps');
  if (!existsSync(apps)) {
    return [];
  }
  return readdirSync(apps)
    .filter((name) => existsSync(path.join(apps, name, 'package.json')))
    .toSorted();
}

/** The names of the client apps under `apps/`, sorted. */
export function clientApps(root: string): Array<string> {
  return appNames(root).filter((name) => isClientApp(manifestOf(root, name)));
}

/** The names of the native apps under `apps/`, sorted. */
export function nativeApps(root: string): Array<string> {
  return appNames(root).filter((name) => isNativeApp(manifestOf(root, name)));
}

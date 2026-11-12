import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { nativeApps } from '@tools/apps';
import { declaresAppId } from '@tools/native/build';

/**
 * The reach rule: the platforms that a change reaches, so the journeys of
 * each one must pass on it. This is the one place that states it. CI reads it
 * to start the native jobs, and the merge judge (CL-441) reads it to know
 * which platforms a PR must pass on.
 *
 * - Every change reaches web. The web journeys run on every PR.
 * - A change reaches native when it touches a native app, a native journey,
 *   the native tooling in `tools/native/`, a shared runtime package or a
 *   sensitive path. A shared runtime package is a `type:package` package
 *   under `packages/`, or a feature that a native app depends on. A sensitive
 *   path is a file whose tier in `.clutch/risk.yaml` is `one-way-door`.
 * - A push to the default branch reaches every platform.
 *
 * See docs/principles/proof-gates-code.md#proof-decides-the-rest.
 */

export type Change = { readonly path: string; readonly tier: string };

export type Reach = { web: boolean; native: boolean; why: Array<string> };

function manifest(root: string, folder: string) {
  const file = path.join(root, folder, 'package.json');
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf-8')) as {
        dependencies?: Record<string, string>;
        nx?: { tags?: Array<string> };
      })
    : undefined;
}

/** The folders that a change to reaches native: native apps, shared runtime packages, and the features a native app uses. */
export function nativeFolders(root: string): Array<string> {
  const apps = nativeApps(root);
  const packagesDir = path.join(root, 'packages');
  const packages = existsSync(packagesDir)
    ? readdirSync(packagesDir)
        .map((name) => `packages/${name}`)
        .filter((folder) => manifest(root, folder)?.nx?.tags?.includes('type:package'))
    : [];
  const features = apps.flatMap((app) =>
    Object.keys(manifest(root, `apps/${app}`)?.dependencies ?? {})
      .filter((name) => name.startsWith('@features/'))
      .map((name) => `features/${name.slice('@features/'.length)}`),
  );
  return [...apps.map((app) => `apps/${app}`), ...packages, ...features, 'tools/native'];
}

/** The platforms that the changed files reach, and why native is reached. */
export function reachOf(root: string, changes: ReadonlyArray<Change>): Reach {
  const folders = nativeFolders(root);
  const why = changes.flatMap((change) => {
    if (change.tier === 'one-way-door') {
      return [`${change.path} is a sensitive path`];
    }
    if (change.path.endsWith('.maestro.yaml') || change.path.endsWith('.journey.ts')) {
      return [`${change.path} is a native journey`];
    }
    const folder = folders.find((item) => change.path.startsWith(`${item}/`));
    return folder ? [`${change.path} is in ${folder}`] : [];
  });
  return { web: true, native: why.length > 0, why };
}

/**
 * The CI outputs. `native` is reached and a native app exists. `ios` and
 * `android` are native too, and at least one native app declares that
 * platform's app ID in its app.json, so CI starts only the lanes that run.
 */
export type Outputs = { native: boolean; ios: boolean; android: boolean };

export function outputsOf(root: string, reach: Reach): Outputs {
  const native = reach.native && nativeApps(root).length > 0;
  return {
    native,
    ios: native && declaresAppId(root, 'ios'),
    android: native && declaresAppId(root, 'android'),
  };
}

/** The changed files and their tiers, from `clutch risk`. */
async function changesOf(root: string, base: string, head: string): Promise<Array<Change>> {
  const proc = Bun.spawn(
    [process.execPath, 'tools/clutch.ts', 'risk', '--base', base, '--head', head, '--json'],
    { cwd: root, stdout: 'pipe', stderr: 'inherit' },
  );
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) {
    throw new Error(`clutch risk failed (exit ${code}). Read its output above.`);
  }
  return (JSON.parse(out) as { files: Array<Change> }).files;
}

/**
 * `bun tools/journeys/reach.ts --base <ref> --head <ref>`, or `--main` for a
 * push to the default branch. It prints the reach, and writes `native=true`
 * to `GITHUB_OUTPUT` when the change reaches native and a native app exists.
 */
async function main(args: Array<string>, root = process.cwd()) {
  const { values } = parseArgs({
    args,
    options: {
      base: { type: 'string' },
      head: { type: 'string' },
      main: { type: 'boolean' },
    },
  });
  let reach: Reach;
  if (values.main) {
    reach = {
      web: true,
      native: true,
      why: ['a push to the default branch reaches every platform'],
    };
  } else if (values.base && values.head) {
    reach = reachOf(root, await changesOf(root, values.base, values.head));
  } else {
    console.error('Usage: bun tools/journeys/reach.ts --base <ref> --head <ref> | --main');
    return 2;
  }
  const outputs = outputsOf(root, reach);
  const hasApp = nativeApps(root).length > 0;
  console.log(`Web: reached. Every PR runs the web journeys.`);
  if (!reach.native) {
    console.log(
      'Native: not reached. No changed file is native code, shared runtime code or a sensitive path.',
    );
  } else if (hasApp) {
    console.log(`Native: reached, because ${reach.why.slice(0, 5).join('; ')}.`);
    console.log(
      `Native lanes: iOS ${outputs.ios ? 'runs' : 'does not run'}, Android ${outputs.android ? 'runs' : 'does not run'}. A lane runs when a native app declares its app ID.`,
    );
  } else {
    console.log('Native: reached, but the repository has no native app, so nothing runs.');
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `native=${outputs.native}\nios=${outputs.ios}\nandroid=${outputs.android}\n`,
    );
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}

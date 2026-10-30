import path from 'node:path';

import { cliRoot } from '@/format';

/**
 * What the release build puts into the binary with `bun build --define`, in
 * tools/release/binaries.ts: Clutch's version and its capability registry. A
 * clone reads them from its own files instead.
 */
type Build = { version: string; registry: string };

export const build = (globalThis as { CLUTCH_BUILD?: Build }).CLUTCH_BUILD;

/** Clutch's version: the binary's release, or the version in the clone's package.json. */
export async function clutchVersion() {
  if (build) {
    return build.version;
  }
  const manifest = (await Bun.file(path.join(cliRoot, 'package.json')).json()) as {
    version: string;
  };
  return manifest.version;
}

import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { build } from '@/build';
import { loadClutchConfig } from '@/clutch-config/load';
import { builtInRegistry, loadRegistry } from '@/doctor/registry';
import { cliRoot, inClone } from '@/format';
import { gitOrThrow } from '@/git';

const defaultRepo = 'eggdev/clutch';

/** Where the release binary keeps its bare clones of Clutch. */
export function cacheFolder(env: Record<string, string | undefined> = process.env) {
  return path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'clutch');
}

/**
 * A bare clone of `url` at `folder`, with its branches and tags fetched now.
 * The release binary reads Clutch through git from it, as a clone reads itself.
 */
export async function cachedClone(url: string, folder: string) {
  if (await Bun.file(path.join(folder, 'HEAD')).exists()) {
    await gitOrThrow(
      folder,
      'fetch',
      '--quiet',
      '--prune',
      '--tags',
      url,
      '+refs/heads/*:refs/heads/*',
    );
  } else {
    await mkdir(path.dirname(folder), { recursive: true });
    await gitOrThrow(path.dirname(folder), 'clone', '--quiet', '--bare', url, folder);
  }
  return folder;
}

/** The Clutch repository that the project at `root` names in clutch.yaml. */
export async function projectTemplateRepo(root: string) {
  const loaded = await loadClutchConfig(root);
  return loaded.kind === 'loaded' ? loaded.config.template.repo : defaultRepo;
}

/**
 * The Clutch checkout that sync and init read: this clone, or, in the release
 * binary, a cached clone of `repo` from GitHub that is fetched on each run.
 */
export async function clutchCheckout(repo = defaultRepo) {
  if (await inClone()) {
    return cliRoot;
  }
  const folder = path.join(cacheFolder(), `${repo.replace('/', '__')}.git`);
  return cachedClone(`https://github.com/${repo}.git`, folder);
}

/** The capability registry: the one built into the binary, or the clone's with its pages checked. */
export function capabilityRegistry() {
  return build ? builtInRegistry(build.registry) : loadRegistry(cliRoot);
}

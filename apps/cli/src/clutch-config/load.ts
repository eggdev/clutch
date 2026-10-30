import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parse } from 'yaml';

import { validateClutchConfig } from '@/clutch-config/schema';
import type { ClutchConfig, ConfigError } from '@/clutch-config/schema';

const configFile = 'clutch.yaml';

export type LoadedConfig =
  | { kind: 'not-adopted' }
  | { kind: 'invalid'; errors: Array<ConfigError> }
  | { kind: 'loaded'; config: ClutchConfig };

/** Reads `clutch.yaml` at `root`. A repository without one has not adopted Clutch. */
export async function loadClutchConfig(root: string): Promise<LoadedConfig> {
  let text: string;
  try {
    text = await readFile(path.join(root, configFile), 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'not-adopted' };
    }
    throw error;
  }
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    return { kind: 'invalid', errors: [{ path: '', message: `Not valid YAML: ${String(error)}` }] };
  }
  const { config, errors } = validateClutchConfig(data);
  return config ? { kind: 'loaded', config } : { kind: 'invalid', errors };
}

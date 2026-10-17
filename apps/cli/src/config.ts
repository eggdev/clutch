import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type Config = { agent?: string };

/** The user's settings for this CLI, in the XDG config folder. */
function configFile(env: Record<string, string | undefined>) {
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'project-template', 'config.json');
}

export async function loadConfig(env: Record<string, string | undefined>): Promise<Config> {
  try {
    return JSON.parse(await readFile(configFile(env), 'utf-8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export async function saveConfig(env: Record<string, string | undefined>, config: Config) {
  const file = configFile(env);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
}
